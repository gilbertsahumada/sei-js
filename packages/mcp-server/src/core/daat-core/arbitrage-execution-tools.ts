import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getPublicClient, getWalletClientFromProvider } from "../services/clients.js";
import { DEFAULT_NETWORK } from "../chains.js";
import { MulticallService } from "../services/MulticallService.js";
import { DragonSwapApiService } from "../dex/pricing/DragonSwapApiService.js";
import { SailorApiService } from "../dex/pricing/SailorApiService.js";
import { SwapValidationService } from "./services/SwapValidationService.js";
import { SwapApprovalService } from "./services/SwapApprovalService.js";
import { SwapExecutionService } from "./services/SwapExecutionService.js";
import { SwapResponseService } from "./services/SwapResponseService.js";
import { SwapGasService } from "./services/SwapGasService.js";
import { DRAGONSWAP_ROUTER_ABI, SAILOR_ROUTER_ABI, DRAGONSWAP_ROUTER_ADDRESS, SAILOR_ROUTER_ADDRESS } from "../dex/contracts/abis/index.js";


// USDT = 0x9151434b16b9763660705744891fA906F660EcC5
// USDC = 0xe15fc38f6d8c56af07bbcbe3baf5708a2bf42392
// FXS  = 0x64445f0aecc51e94ad52d8ac56b7190e764e561a

/**
 * Auto-execute arbitrage opportunities
 */
export function registerArbitrageExecutionTools(server: McpServer) {

  server.tool(
    "execute_arbitrage_opportunity",
    "Find and automatically execute profitable arbitrage opportunities between DragonSwap and Sailor Finance",
    {
      tokenIn: z
        .string()
        .min(1, "Input token address is required")
        .refine((val) => /^0x[a-fA-F0-9]{40}$/.test(val), {
          message: "Input token must be a valid address",
        }),
      tokenOut: z
        .string()
        .min(1, "Output token address is required")
        .refine((val) => /^0x[a-fA-F0-9]{40}$/.test(val), {
          message: "Output token must be a valid address",
        }),
      amount: z
        .string()
        .min(1, "Amount is required")
        .refine((val) => {
          const num = parseFloat(val);
          return !isNaN(num) && num > 0;
        }, { message: "Amount must be a positive number" }),
      minProfitPercent: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe("Minimum profit percentage required to execute (default: 1.0%)"),
      slippage: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe("Slippage tolerance in percentage (default: 2.0%)"),
      gasLimit: z
        .number()
        .optional()
        .describe("Gas limit override (default: estimated)"),
      dryRun: z
        .boolean()
        .optional()
        .describe("If true, only analyze opportunity without executing (default: false)")
    },
    async ({ tokenIn, tokenOut, amount, minProfitPercent = 1.0, slippage = 2.0, gasLimit, dryRun = false }) => {
      try {
        const publicClient = getPublicClient(DEFAULT_NETWORK);
        const walletClient = await getWalletClientFromProvider(DEFAULT_NETWORK);
        const account = walletClient.account;

        if (!account) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                error: "No wallet account found. Please connect your wallet."
              }, null, 2)
            }]
          };
        }

        // Step 1: Get token info using multicall
        console.log("📊 Getting token information...");
        const multicallService = new MulticallService(publicClient, 1329);
        const { tokenInDecimals, tokenOutDecimals, tokenInSymbol, tokenOutSymbol } = 
          await multicallService.getTokenBasicInfo(
            tokenIn as `0x${string}`,
            tokenOut as `0x${string}`
          );

        // Step 2: Get quotes from both DEXes in parallel
        console.log("💰 Comparing prices between DragonSwap and Sailor...");
        console.log(`Quote params: ${tokenInSymbol}(${tokenIn}) -> ${tokenOutSymbol}(${tokenOut}), amount: ${amount}`);
        
        const results = await Promise.allSettled([
          DragonSwapApiService.getQuote({
            tokenIn, tokenOut, amountIn: amount, tokenInDecimals,
            recipient: account.address, slippage, deadline: 1200
          }),
          SailorApiService.getQuote({
            tokenIn, tokenOut, amountIn: amount, tokenInDecimals, slippage
          })
        ]);

        const dragonResult = results[0];
        const sailorResult = results[1];
        
        console.log(`DragonSwap result: ${dragonResult.status}`);
        if (dragonResult.status === 'rejected') {
          console.error(`DragonSwap error details:`, dragonResult.reason);
        }
        
        console.log(`Sailor result: ${sailorResult.status}`);
        if (sailorResult.status === 'rejected') {
          console.error(`Sailor error details:`, sailorResult.reason);
        }

        // Check if both quotes succeeded
        if (dragonResult.status === 'rejected' && sailorResult.status === 'rejected') {
          const dragonError = dragonResult.reason instanceof Error ? dragonResult.reason.message : String(dragonResult.reason);
          const sailorError = sailorResult.reason instanceof Error ? sailorResult.reason.message : String(sailorResult.reason);
          
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                error: "No quotes available from either DEX",
                tokenPair: `${tokenInSymbol}/${tokenOutSymbol}`,
                amount: `${amount} ${tokenInSymbol}`,
                dragonswapError: dragonError,
                sailorError: sailorError,
                troubleshooting: [
                  "Check if token addresses are correct and checksummed",
                  "Verify this token pair has liquidity on both DEXes", 
                  "Try with a different amount or more common token pairs",
                  "Check if tokens are supported on Sei network (chain ID 1329)"
                ]
              }, null, 2)
            }]
          };
        }

        if (dragonResult.status === 'rejected' || sailorResult.status === 'rejected') {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                error: "Only one DEX available - no arbitrage opportunity",
                available: dragonResult.status === 'fulfilled' ? 'DragonSwap' : 'Sailor',
                unavailable: dragonResult.status === 'rejected' ? 'DragonSwap' : 'Sailor'
              }, null, 2)
            }]
          };
        }

        // Step 3: Analyze arbitrage opportunity
        const dragonQuote = dragonResult.value;
        const sailorQuote = sailorResult.value;

        const dragonOutput = parseFloat(dragonQuote.quoteDecimals);
        const sailorOutputWei = BigInt(sailorQuote.total_amount_out);
        const sailorOutput = parseFloat(sailorOutputWei.toString()) / Math.pow(10, tokenOutDecimals);

        // Determine which DEX gives better output (higher = better)
        const betterDex = dragonOutput > sailorOutput ? 'DragonSwap' : 'Sailor';
        const betterOutput = dragonOutput > sailorOutput ? dragonOutput : sailorOutput;
        const worseOutput = dragonOutput > sailorOutput ? sailorOutput : dragonOutput;
        
        const profitAmount = betterOutput - worseOutput;
        const profitPercent = (profitAmount / worseOutput) * 100;

        const analysis = {
          tokenPair: `${tokenInSymbol}/${tokenOutSymbol}`,
          inputAmount: `${amount} ${tokenInSymbol}`,
          prices: {
            dragonswap: `${dragonOutput.toFixed(6)} ${tokenOutSymbol}`,
            sailor: `${sailorOutput.toFixed(6)} ${tokenOutSymbol}`,
            betterDex: betterDex,
            priceDifference: `${profitAmount.toFixed(6)} ${tokenOutSymbol}`,
            priceDifferencePercent: `${profitPercent.toFixed(2)}%`
          },
          profitAnalysis: {
            grossProfit: `${profitAmount.toFixed(6)} ${tokenOutSymbol}`,
            grossProfitPercent: `${profitPercent.toFixed(2)}%`,
            isProfitable: profitPercent >= minProfitPercent,
            minThreshold: `${minProfitPercent}%`
          }
        };

        // If not profitable enough, return analysis
        if (profitPercent < minProfitPercent) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                ...analysis,
                decision: "NOT EXECUTED - Profit below minimum threshold",
                recommendation: "Try with a different token pair or lower minimum profit threshold"
              }, null, 2)
            }]
          };
        }

        // If dry run, return analysis without executing
        if (dryRun) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                ...analysis,
                decision: "DRY RUN - Would execute arbitrage",
                strategy: `Buy on ${betterDex === 'DragonSwap' ? 'Sailor' : 'DragonSwap'} (cheaper), sell on ${betterDex} (more expensive)`
              }, null, 2)
            }]
          };
        }

        // Step 4: Execute the arbitrage
        console.log("⚡ Executing arbitrage opportunity...");
        
        // Use the DEX with worse price (buy there first)
        const executeDex = betterDex === 'DragonSwap' ? 'Sailor' : 'DragonSwap';
        const routerAddress = executeDex === 'DragonSwap' ? DRAGONSWAP_ROUTER_ADDRESS : SAILOR_ROUTER_ADDRESS;
        const routerAbi = executeDex === 'DragonSwap' ? DRAGONSWAP_ROUTER_ABI : SAILOR_ROUTER_ABI;

        // Initialize services
        const validationService = new SwapValidationService(publicClient, walletClient);
        const approvalService = new SwapApprovalService(publicClient);
        const gasService = new SwapGasService(publicClient);
        const executionService = new SwapExecutionService(publicClient, walletClient);

        // Validate swap parameters
        const validation = await validationService.validateSwapParameters({
          tokenIn, tokenOut, amountIn: amount, account, routerAddress
        });

        if (!validation.isValid) {
          return validation.error!;
        }

        const { swapInfo, amountInParsed } = validation;

        // Handle approval
        const approvalResult = await approvalService.handleAutoApproval({
          tokenIn, spenderAddress: routerAddress, amountIn: amount,
          amountInParsed, currentAllowance: swapInfo.allowance,
          tokenInDecimals: swapInfo.tokenInDecimals,
          tokenInSymbol: swapInfo.tokenInSymbol,
          protocolName: executeDex
        });

        if (!approvalResult.success) {
          return approvalResult.error!;
        }

        // Calculate minAmountOut with slippage
        const targetOutput = executeDex === 'DragonSwap' ? dragonOutput : sailorOutput;
        const minAmountOut = (targetOutput * (100 - slippage) / 100).toString();

        // Estimate gas
        const gasEstimate = gasLimit || (executeDex === 'DragonSwap' ? 300000 : 400000);
        const gasParams = await gasService.estimateAndPriceGas({
          protocol: executeDex === 'DragonSwap' ? 'dragonswap' : 'sailor',
          contractAddress: routerAddress,
          abi: routerAbi,
          functionName: executeDex === 'DragonSwap' ? 'swapExactTokensForTokens' : 'exactInputSingle',
          args: [], // Simplified for now
          account, gasLimit: gasEstimate
        });

        // Execute the trade on the cheaper DEX
        let transactionParams: {
          contractAddress: string;
          abi: readonly any[];
          functionName: string;
          args: any[];
          gasParams: any;
        };
        if (executeDex === 'DragonSwap') {
          // DragonSwap execution
          const path = [tokenIn, tokenOut];
          const deadlineTimestamp = Math.floor(Date.now() / 1000) + 1200;
          
          transactionParams = {
            contractAddress: routerAddress,
            abi: routerAbi,
            functionName: 'swapExactTokensForTokens',
            args: [amountInParsed, BigInt(Math.floor(parseFloat(minAmountOut) * Math.pow(10, tokenOutDecimals))), path, account.address, BigInt(deadlineTimestamp)],
            gasParams
          };
        } else {
          // Sailor execution (simplified - would need proper V3 path encoding)
          const deadlineTimestamp = Math.floor(Date.now() / 1000) + 1200;
          
          transactionParams = {
            contractAddress: routerAddress,
            abi: routerAbi,
            functionName: 'exactInputSingle',
            args: [{
              tokenIn: tokenIn as `0x${string}`,
              tokenOut: tokenOut as `0x${string}`,
              fee: 3000, // 0.3% fee
              recipient: account.address,
              deadline: BigInt(deadlineTimestamp),
              amountIn: amountInParsed,
              amountOutMinimum: BigInt(Math.floor(parseFloat(minAmountOut) * Math.pow(10, tokenOutDecimals))),
              sqrtPriceLimitX96: BigInt(0)
            }],
            gasParams
          };
        }

        const executionResult = await executionService.executeTransaction(transactionParams);

        if (!executionResult.success) {
          return executionResult.error!;
        }

        // Return success response with arbitrage details
        return SwapResponseService.createSuccessResponse({
          protocol: `Arbitrage (${executeDex})`,
          transactionHash: executionResult.hash!,
          receipt: executionResult.receipt!,
          tokenIn: {
            address: tokenIn,
            symbol: swapInfo.tokenInSymbol,
            name: swapInfo.tokenInName,
            amount: amount,
            decimals: swapInfo.tokenInDecimals
          },
          tokenOut: {
            address: tokenOut,
            symbol: swapInfo.tokenOutSymbol,
            name: swapInfo.tokenOutName,
            minAmount: minAmountOut,
            decimals: swapInfo.tokenOutDecimals
          },
          route: {
            path: [tokenIn, tokenOut],
            routeString: `Arbitrage: Execute on ${executeDex} (${profitPercent.toFixed(2)}% opportunity)`,
            usedAPI: true,
            priceImpact: profitPercent.toFixed(2),
            type: "arbitrage",
            hops: 1
          },
          slippage: {
            tolerance: `${slippage}%`,
            minimumReceived: minAmountOut,
            autoCalculated: true
          },
          deadline: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
          wallet: account.address
        });

      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              error: "Arbitrage execution failed",
              message: error instanceof Error ? error.message : String(error),
              troubleshooting: [
                "Check token addresses are correct",
                "Verify sufficient balance and allowances",
                "Try with lower minimum profit threshold",
                "Check if both DEXes have liquidity for this pair"
              ]
            }, null, 2)
          }]
        };
      }
    }
  );

  console.log("Arbitrage execution tools registered successfully");
}