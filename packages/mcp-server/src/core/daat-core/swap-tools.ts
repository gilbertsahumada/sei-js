import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getWalletClientFromProvider, getPublicClient } from "../services/clients.js";
import { parseUnits, formatUnits } from "viem";
import { ERC20_ABI, DRAGONSWAP_ROUTER_ABI, DRAGONSWAP_ROUTER_ADDRESS } from "../dex/contracts/abis/index.js";
import { protocolConfig, shouldFetchProtocolData } from "./protocol-config.js";
import { DEFAULT_NETWORK } from "../chains.js";
import { DragonSwapApiService } from "../dex/pricing/DragonSwapApiService.js";
import { MulticallService } from "../services/MulticallService.js";

const DRAGONSWAP_ROUTER = DRAGONSWAP_ROUTER_ADDRESS;
// USDT = 0x9151434b16b9763660705744891fA906F660EcC5
// USDC = 0xe15fc38f6d8c56af07bbcbe3baf5708a2bf42392
// FXS = 0x64445f0aecc51e94ad52d8ac56b7190e764e561a

export function registerSwapTools(server: McpServer) {
  server.tool(
    "dragonswap_swap",
    "Execute a token swap on DragonSwap DEX (uses PRIVATE_KEY from environment)",
    {
      tokenIn: z.string().min(1, "Input token address is required").refine(
        (val) => /^0x[a-fA-F0-9]{40}$/.test(val),
        { message: "Input token must be a valid Ethereum address" }
      ),
      tokenOut: z.string().min(1, "Output token address is required").refine(
        (val) => /^0x[a-fA-F0-9]{40}$/.test(val),
        { message: "Output token must be a valid Ethereum address" }
      ),
      amountIn: z.string().min(1, "Amount of input token is required").refine(
        (val) => {
          const num = parseFloat(val);
          return !isNaN(num) && num > 0;
        },
        { message: "Amount must be a valid positive number" }
      ),
      minAmountOut: z.string().refine(
        (val) => {
          if (!val) return true; // Allow empty for auto-calculation
          const num = parseFloat(val);
          return !isNaN(num) && num > 0;
        },
        { message: "Minimum amount out must be a valid positive number when provided" }
      ).optional().describe("Minimum amount out (optional - will be calculated from quote if not provided)"),
      slippage: z.number().min(0).max(100, "Slippage must be between 0 and 100").optional().describe("Slippage tolerance in percentage (default: 0.5)"),
      deadline: z.number().min(1).max(1440, "Deadline must be between 1 and 1440 minutes").optional().describe("Transaction deadline in minutes from now (default: 20)"),
      gasLimit: z.number().min(21000, "Gas limit must be at least 21000").optional().describe("Gas limit override (default: estimated)"),
      gasPrice: z.string().optional().refine(
        (val) => val === undefined || /^\d+$/.test(val),
        { message: "Gas price must be a valid number in wei" }
      ).describe("Gas price override in wei (default: current)")
    },
    async ({ tokenIn, tokenOut, amountIn, minAmountOut, slippage = 0.5, deadline = 20, gasLimit, gasPrice }) => {
      console.log("🔧[TOOL_dragonswap_swap]");
      try {
        if (!shouldFetchProtocolData("dragonswap")) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "DragonSwap protocol is disabled",
                suggestion: "Use manage_protocols tool to enable DragonSwap"
              }, null, 2)
            }],
            isError: true
          };
        }

        const publicClient = getPublicClient(DEFAULT_NETWORK);
        const walletClient = await getWalletClientFromProvider(DEFAULT_NETWORK);
        const account = walletClient.account;

        if (!account) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "No wallet account found. Please connect your wallet."
              }, null, 2)
            }],
            isError: true
          };
        }

        // Get all token info, balance, and allowance in one multicall
        const multicallService = new MulticallService(publicClient, 1329);
        const swapInfo = await multicallService.getSwapInfo(
          tokenIn as `0x${string}`,
          tokenOut as `0x${string}`,
          account.address,
          DRAGONSWAP_ROUTER as `0x${string}`
        );

        console.log(`Swap info retrieved:`, {
          tokenIn: { 
            address: tokenIn, 
            decimals: swapInfo.tokenInDecimals, 
            symbol: swapInfo.tokenInSymbol,
            balance: formatUnits(swapInfo.balance, swapInfo.tokenInDecimals),
            allowance: formatUnits(swapInfo.allowance, swapInfo.tokenInDecimals)
          },
          tokenOut: { 
            address: tokenOut, 
            decimals: swapInfo.tokenOutDecimals, 
            symbol: swapInfo.tokenOutSymbol 
          }
        });

        // Parse amounts using proper decimals
        const amountInParsed = parseUnits(amountIn, swapInfo.tokenInDecimals);

        // Check if user has enough balance
        if (swapInfo.balance < amountInParsed) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Insufficient balance",
                required: formatUnits(amountInParsed, swapInfo.tokenInDecimals),
                available: formatUnits(swapInfo.balance, swapInfo.tokenInDecimals),
                tokenAddress: tokenIn,
                tokenSymbol: swapInfo.tokenInSymbol
              }, null, 2)
            }],
            isError: true
          };
        }

        // Check allowance
        if (swapInfo.allowance < amountInParsed) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Insufficient allowance",
                required: formatUnits(amountInParsed, swapInfo.tokenInDecimals),
                current: formatUnits(swapInfo.allowance, swapInfo.tokenInDecimals),
                suggestion: "Use approve_token tool first",
                approveCommand: {
                  tool: "approve_token",
                  params: {
                    tokenAddress: tokenIn,
                    spenderAddress: DRAGONSWAP_ROUTER,
                    amount: amountIn
                  }
                }
              }, null, 2)
            }],
            isError: true
          };
        }

        // Calculate deadline timestamp
        const deadlineTimestamp = Math.floor(Date.now() / 1000) + (deadline * 60);

        // Try to get optimal route from DragonSwap API
        let path: string[];
        let apiQuoteData: any = null;
        const wasMinAmountOutProvided = !!minAmountOut;
        
        try {
          const apiQuote = await DragonSwapApiService.getQuote({
            tokenIn,
            tokenOut,
            amountIn,
            tokenInDecimals: swapInfo.tokenInDecimals,
            recipient: account.address,
            slippage,
            deadline: 1200,
            timeoutMs: 10000 // 10 second timeout
          });
          
          // Extract path from API response
          path = DragonSwapApiService.extractPathFromRoute(apiQuote.route);
          apiQuoteData = apiQuote;
          
          // Calculate minAmountOut if not provided
          if (!minAmountOut) {
            minAmountOut = DragonSwapApiService.calculateMinAmountOut(apiQuote.quoteDecimals, slippage);
            console.log(`Auto-calculated minAmountOut: ${minAmountOut} (${slippage}% slippage)`);
          }
          
          console.log("Using DragonSwap API route:", apiQuote.routeString);
        } catch (apiError) {
          console.warn("DragonSwap API failed, using direct route:", apiError);
          // Fallback to direct swap
          path = [tokenIn, tokenOut];
          
          // If no minAmountOut provided and API failed, we can't continue
          if (!minAmountOut) {
            throw new Error("minAmountOut is required when DragonSwap API is unavailable");
          }
        }

        // Parse minAmountOut now that we have it (either provided or calculated)
        const minAmountOutParsed = parseUnits(minAmountOut!, swapInfo.tokenOutDecimals);

        // Estimate gas if not provided
        let estimatedGas = gasLimit;
        if (!estimatedGas) {
          try {
            estimatedGas = Number(await publicClient.estimateContractGas({
              address: DRAGONSWAP_ROUTER as `0x${string}`,
              abi: DRAGONSWAP_ROUTER_ABI,
              functionName: 'swapExactTokensForTokens',
              args: [
                amountInParsed,
                minAmountOutParsed,
                path as `0x${string}`[],
                account.address,
                BigInt(deadlineTimestamp)
              ],
              account: account.address
            }));
          } catch {
            estimatedGas = 200000; // Safe fallback for swap
          }
        }

        // Get current gas price if not provided
        let currentGasPrice = gasPrice ? BigInt(gasPrice) : await publicClient.getGasPrice();

        // Execute the swap transaction
        const hash = await walletClient.writeContract({
          address: DRAGONSWAP_ROUTER as `0x${string}`,
          abi: DRAGONSWAP_ROUTER_ABI,
          functionName: 'swapExactTokensForTokens',
          args: [
            amountInParsed,
            minAmountOutParsed,
            path as `0x${string}`[],
            account.address,
            BigInt(deadlineTimestamp)
          ],
          gas: BigInt(estimatedGas),
          gasPrice: currentGasPrice,
          account: walletClient.account!,
          chain: walletClient.chain
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "success",
              message: "Swap executed successfully",
              transactionHash: hash,
              blockNumber: receipt.blockNumber.toString(),
              gasUsed: receipt.gasUsed.toString(),
              swap: {
                protocol: "DragonSwap",
                tokenIn: {
                  address: tokenIn,
                  symbol: swapInfo.tokenInSymbol,
                  name: swapInfo.tokenInName,
                  amount: amountIn,
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
                  path,
                  routeString: apiQuoteData?.routeString || `Direct swap: ${swapInfo.tokenInSymbol} -> ${swapInfo.tokenOutSymbol}`,
                  usedAPI: !!apiQuoteData,
                  priceImpact: apiQuoteData?.priceImpact || "unknown"
                },
                slippage: {
                  tolerance: `${slippage}%`,
                  minimumReceived: minAmountOut,
                  autoCalculated: !wasMinAmountOutProvided
                },
                deadline: new Date(deadlineTimestamp * 1000).toISOString()
              },
              wallet: account.address
            }, null, 2)
          }]
        };

      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error executing swap: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Get quote for DragonSwap swap (no transaction)
  server.tool(
    "dragonswap_quote",
    "Get a quote for a token swap on DragonSwap using API (read-only)",
    {
      tokenIn: z.string().min(1, "Input token address is required").refine(
        (val) => /^0x[a-fA-F0-9]{40}$/.test(val),
        { message: "Input token must be a valid Ethereum address" }
      ),
      tokenOut: z.string().min(1, "Output token address is required").refine(
        (val) => /^0x[a-fA-F0-9]{40}$/.test(val),
        { message: "Output token must be a valid Ethereum address" }
      ),
      amountIn: z.string().min(1, "Amount of input token is required").refine(
        (val) => {
          const num = parseFloat(val);
          return !isNaN(num) && num > 0;
        },
        { message: "Amount must be a valid positive number" }
      ),
      slippage: z.number().min(0).max(100, "Slippage must be between 0 and 100").optional().describe("Slippage tolerance in percentage (default: 0.5)")
    },
    async ({ tokenIn, tokenOut, amountIn, slippage = 0.5 }) => {
      console.log("🔧[TOOL_dragonswap_quote]");
      try {
        if (!shouldFetchProtocolData("dragonswap")) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "DragonSwap protocol is disabled",
                suggestion: "Use manage_protocols tool to enable DragonSwap"
              }, null, 2)
            }],
            isError: true
          };
        }

        const publicClient = getPublicClient(DEFAULT_NETWORK);
        const walletClient = await getWalletClientFromProvider(DEFAULT_NETWORK);
        const account = walletClient.account;

        if (!account) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "No wallet account found. Please connect your wallet."
              }, null, 2)
            }],
            isError: true
          };
        }

        // Get token decimals and info using multicall3
        const multicallService = new MulticallService(publicClient, 1329);
        const { tokenInDecimals, tokenOutDecimals, tokenInSymbol, tokenOutSymbol } = await multicallService.getTokenBasicInfo(
          tokenIn as `0x${string}`,
          tokenOut as `0x${string}`
        );

        console.log(`Token info retrieved:`, {
          tokenIn: { address: tokenIn, decimals: tokenInDecimals, symbol: tokenInSymbol },
          tokenOut: { address: tokenOut, decimals: tokenOutDecimals, symbol: tokenOutSymbol }
        });

        try {
          // Get quote from DragonSwap API
          const apiQuote = await DragonSwapApiService.getQuote({
            tokenIn,
            tokenOut,
            amountIn,
            tokenInDecimals,
            recipient: account.address,
            slippage,
            deadline: 1200
          });

          // Extract route path
          const routePath = DragonSwapApiService.extractPathFromRoute(apiQuote.route);
          const minAmountOut = DragonSwapApiService.calculateMinAmountOut(apiQuote.quoteDecimals, slippage);

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                quote: {
                  protocol: "DragonSwap",
                  inputToken: {
                    address: tokenIn,
                    symbol: tokenInSymbol,
                    amount: amountIn
                  },
                  outputToken: {
                    address: tokenOut,
                    symbol: tokenOutSymbol,
                    estimatedAmount: apiQuote.quoteDecimals
                  },
                  route: {
                    path: routePath,
                    routeString: apiQuote.routeString,
                    pools: apiQuote.route[0]?.length || 0
                  },
                  pricing: {
                    priceImpact: `${apiQuote.priceImpact}%`,
                    gasEstimate: apiQuote.gasUseEstimate,
                    gasEstimateUSD: apiQuote.gasUseEstimateUSD
                  },
                  slippage: {
                    tolerance: `${slippage}%`,
                    minimumReceived: minAmountOut
                  }
                },
                apiResponse: {
                  methodParameters: apiQuote.methodParameters,
                  blockNumber: apiQuote.blockNumber,
                  hitsCachedRoutes: apiQuote.hitsCachedRoutes
                }
              }, null, 2)
            }]
          };

        } catch (apiError) {
          console.error("DragonSwap API failed:", apiError);
          throw new Error(`DragonSwap API failed: ${apiError instanceof Error ? apiError.message : String(apiError)}`);
        }

      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error getting quote: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  console.log("Swap tools registered successfully");
}