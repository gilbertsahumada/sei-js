import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getWalletClientFromProvider,
  getPublicClient,
} from "../services/clients.js";
import { SwapValidationService } from "./services/SwapValidationService.js";
import { SwapApprovalService } from "./services/SwapApprovalService.js";
import { SwapGasService } from "./services/SwapGasService.js";
import { SwapExecutionService } from "./services/SwapExecutionService.js";
import { SwapResponseService } from "./services/SwapResponseService.js";
import { MulticallService } from "../services/MulticallService.js";
import * as services from "../services/index.js";
import { parseUnits } from "viem";
import {
  DRAGONSWAP_ROUTER_ABI,
  DRAGONSWAP_ROUTER_ADDRESS,
  SAILOR_ROUTER_ADDRESS,
  SAILOR_ROUTER_ABI,
} from "../dex/contracts/abis/index.js";
import { shouldFetchProtocolData } from "./protocol-config.js";
import { DEFAULT_NETWORK } from "../chains.js";
import { DragonSwapApiService } from "../dex/pricing/DragonSwapApiService.js";
import { SailorApiService } from "../dex/pricing/SailorApiService.js";

const DRAGONSWAP_ROUTER = DRAGONSWAP_ROUTER_ADDRESS;
const SAILOR_ROUTER = SAILOR_ROUTER_ADDRESS;

const swapParametersSchema = {
  tokenIn: z
    .string()
    .min(1, "Input token address is required")
    .refine((val) => /^0x[a-fA-F0-9]{40}$/.test(val), {
      message: "Input token must be a valid Ethereum address",
    }),
  tokenOut: z
    .string()
    .min(1, "Output token address is required")
    .refine((val) => /^0x[a-fA-F0-9]{40}$/.test(val), {
      message: "Output token must be a valid Ethereum address",
    }),
  amountIn: z
    .string()
    .min(1, "Amount of input token is required")
    .refine(
      (val) => {
        const num = parseFloat(val);
        return !isNaN(num) && num > 0;
      },
      { message: "Amount must be a valid positive number" }
    ),
  minAmountOut: z
    .string()
    .refine(
      (val) => {
        if (!val) return true;
        const num = parseFloat(val);
        return !isNaN(num) && num > 0;
      },
      {
        message: "Minimum amount out must be a valid positive number when provided",
      }
    )
    .optional()
    .describe("Minimum amount out (optional - calculated from quote if not provided)"),
  slippage: z
    .number()
    .min(0)
    .max(100, "Slippage must be between 0 and 100")
    .optional()
    .describe("Slippage tolerance in percentage (default: 2.0)"),
  deadline: z
    .number()
    .min(1)
    .max(1440, "Deadline must be between 1 and 1440 minutes")
    .optional()
    .describe("Transaction deadline in minutes from now (default: 20)"),
  gasLimit: z
    .number()
    .min(21000, "Gas limit must be at least 21000")
    .optional()
    .describe("Gas limit override (default: estimated)"),
  gasPrice: z
    .string()
    .optional()
    .refine((val) => val === undefined || /^\d+$/.test(val), {
      message: "Gas price must be a valid number in wei",
    })
    .describe("Gas price override in wei (default: current)"),
};

export function registerSwapTools(server: McpServer) {
  
  // DragonSwap Swap Tool
  server.tool(
    "dragonswap_swap",
    "Execute a token swap on DragonSwap DEX (uses PRIVATE_KEY from environment)",
    {
      tokenIn: swapParametersSchema.tokenIn,
      tokenOut: swapParametersSchema.tokenOut,
      amountIn: swapParametersSchema.amountIn,
      minAmountOut: swapParametersSchema.minAmountOut,
      slippage: swapParametersSchema.slippage,
      deadline: swapParametersSchema.deadline,
      gasLimit: swapParametersSchema.gasLimit,
      gasPrice: swapParametersSchema.gasPrice,
    },
    async ({
      tokenIn,
      tokenOut,
      amountIn,
      minAmountOut,
      slippage = 2.0,
      deadline = 20,
      gasLimit,
      gasPrice,
    }) => {
      try {
        // Protocol validation
        if (!shouldFetchProtocolData("dragonswap")) {
          return SwapValidationService.createProtocolDisabledError("DragonSwap");
        }

        // Initialize clients and services
        const publicClient = getPublicClient(DEFAULT_NETWORK);
        const walletClient = await getWalletClientFromProvider(DEFAULT_NETWORK);
        const account = walletClient.account;

        if (!account) {
          return SwapValidationService.createWalletNotConnectedError();
        }

        const validationService = new SwapValidationService(publicClient, walletClient);
        const approvalService = new SwapApprovalService(publicClient);
        const gasService = new SwapGasService(publicClient);
        const executionService = new SwapExecutionService(publicClient, walletClient);

        // Validate swap parameters
        const validation = await validationService.validateSwapParameters({
          tokenIn,
          tokenOut,
          amountIn,
          account,
          routerAddress: DRAGONSWAP_ROUTER,
        });

        if (!validation.isValid) {
          return validation.error!;
        }

        const { swapInfo, amountInParsed } = validation;
        const deadlineTimestamp = Math.floor(Date.now() / 1000) + deadline * 60;
        
        // Warn about very small amounts for DragonSwap
        if (amountInParsed < 1000000n) { // Less than 1M wei (very small for most tokens)
          console.warn(`⚠️ Very small DragonSwap amount detected: ${amountInParsed.toString()} wei. Consider using larger amounts for better reliability.`);
        }

        // Get quote and route information
        let apiQuoteData: any = null;
        let useApiCalldata = false;
        let path: string[] = [tokenIn, tokenOut];

        try {
          const apiQuote = await DragonSwapApiService.getQuote({
            tokenIn,
            tokenOut,
            amountIn,
            tokenInDecimals: swapInfo.tokenInDecimals,
            recipient: account.address,
            slippage,
            deadline: 1200,
            timeoutMs: 10000,
          });

          apiQuoteData = apiQuote;

          if (!minAmountOut) {
            minAmountOut = DragonSwapApiService.calculateMinAmountOut(
              apiQuote.quoteDecimals,
              slippage
            );
          }

          if (apiQuote.methodParameters?.calldata && apiQuote.methodParameters?.to) {
            useApiCalldata = true;
          } else {
            path = DragonSwapApiService.extractPathFromRoute(apiQuote.route);
          }
        } catch (apiError) {
          if (apiError instanceof Error && apiError.message.includes("No trading route found")) {
            return SwapResponseService.createUnsupportedPairError(
              "DragonSwap",
              swapInfo.tokenInSymbol,
              swapInfo.tokenOutSymbol,
              tokenIn,
              tokenOut,
              apiError
            );
          }
          if (!minAmountOut) {
            throw new Error("minAmountOut is required when DragonSwap API is unavailable");
          }
        }

        const minAmountOutParsed = parseUnits(minAmountOut!, swapInfo.tokenOutDecimals);

        // Handle approval
        const spenderAddress = useApiCalldata && apiQuoteData?.methodParameters?.to
          ? apiQuoteData.methodParameters.to
          : DRAGONSWAP_ROUTER;

        let currentAllowance = swapInfo.allowance;
        if (spenderAddress !== DRAGONSWAP_ROUTER) {
          currentAllowance = await approvalService.checkAllowanceForSpender(
            tokenIn,
            account,
            spenderAddress,
            swapInfo.allowance,
            swapInfo.tokenInDecimals
          );
        }

        const approvalResult = await approvalService.handleAutoApproval({
          tokenIn,
          spenderAddress,
          amountIn,
          amountInParsed,
          currentAllowance,
          tokenInDecimals: swapInfo.tokenInDecimals,
          tokenInSymbol: swapInfo.tokenInSymbol,
          protocolName: "DragonSwap",
        });

        if (!approvalResult.success) {
          return approvalResult.error!;
        }

        // Estimate gas
        const gasParams = await gasService.estimateAndPriceGas({
          gasLimit,
          gasPrice,
          apiQuoteData,
          useApiCalldata,
          protocol: 'dragonswap',
          contractAddress: DRAGONSWAP_ROUTER,
          abi: DRAGONSWAP_ROUTER_ABI,
          functionName: "swapExactTokensForTokens",
          args: [amountInParsed, minAmountOutParsed, path, account.address],
          account,
        });

        // Execute transaction
        let executionResult;
        if (useApiCalldata && apiQuoteData?.methodParameters) {
          // Use API calldata
          executionResult = await executionService.executeRawTransaction({
            to: apiQuoteData.methodParameters.to,
            data: apiQuoteData.methodParameters.calldata,
            value: apiQuoteData.methodParameters.value || "0x0",
            gasParams,
          });
        } else {
          // Use standard router
          executionResult = await executionService.executeTransaction({
            contractAddress: DRAGONSWAP_ROUTER,
            abi: DRAGONSWAP_ROUTER_ABI,
            functionName: "swapExactTokensForTokens",
            args: [amountInParsed, minAmountOutParsed, path, account.address],
            gasParams,
          });
        }

        if (!executionResult.success) {
          return executionResult.error!;
        }

        // Return success response
        return SwapResponseService.createSuccessResponse({
          protocol: "DragonSwap",
          transactionHash: executionResult.hash!,
          receipt: executionResult.receipt!,
          tokenIn: {
            address: tokenIn,
            symbol: swapInfo.tokenInSymbol,
            name: swapInfo.tokenInName,
            amount: amountIn,
            decimals: swapInfo.tokenInDecimals,
          },
          tokenOut: {
            address: tokenOut,
            symbol: swapInfo.tokenOutSymbol,
            name: swapInfo.tokenOutName,
            minAmount: minAmountOut!,
            decimals: swapInfo.tokenOutDecimals,
          },
          route: {
            path,
            routeString: apiQuoteData?.routeString || 
              `Direct swap: ${swapInfo.tokenInSymbol} -> ${swapInfo.tokenOutSymbol}`,
            usedAPI: !!apiQuoteData,
            priceImpact: apiQuoteData?.priceImpact || "unknown",
          },
          slippage: {
            tolerance: `${slippage}%`,
            minimumReceived: minAmountOut!,
            autoCalculated: !minAmountOut,
          },
          deadline: new Date(deadlineTimestamp * 1000).toISOString(),
          wallet: account.address,
        });

      } catch (error) {
        return SwapResponseService.createErrorResponse(error, "DragonSwap");
      }
    }
  );

  // Sailor Finance Swap Tool  
  server.tool(
    "sailor_swap",
    "Execute a token swap on Sailor Finance DEX (uses PRIVATE_KEY from environment)",
    {
      tokenIn: swapParametersSchema.tokenIn,
      tokenOut: swapParametersSchema.tokenOut,
      amountIn: swapParametersSchema.amountIn,
      minAmountOut: swapParametersSchema.minAmountOut,
      slippage: swapParametersSchema.slippage,
      deadline: swapParametersSchema.deadline,
      gasLimit: swapParametersSchema.gasLimit,
      gasPrice: swapParametersSchema.gasPrice,
    },
    async ({
      tokenIn,
      tokenOut,
      amountIn,
      minAmountOut,
      slippage = 2.0,
      deadline = 20,
      gasLimit,
      gasPrice,
    }) => {
      try {
        // Protocol validation
        if (!shouldFetchProtocolData("sailor")) {
          return SwapValidationService.createProtocolDisabledError("Sailor Finance");
        }

        // Initialize clients and services
        const publicClient = getPublicClient(DEFAULT_NETWORK);
        const walletClient = await getWalletClientFromProvider(DEFAULT_NETWORK);
        const account = walletClient.account;

        if (!account) {
          return SwapValidationService.createWalletNotConnectedError();
        }

        const validationService = new SwapValidationService(publicClient, walletClient);
        const approvalService = new SwapApprovalService(publicClient);
        const gasService = new SwapGasService(publicClient);
        const executionService = new SwapExecutionService(publicClient, walletClient);

        // Validate swap parameters
        const validation = await validationService.validateSwapParameters({
          tokenIn,
          tokenOut,
          amountIn,
          account,
          routerAddress: SAILOR_ROUTER,
        });

        if (!validation.isValid) {
          return validation.error!;
        }

        const { swapInfo, amountInParsed } = validation;
        const deadlineTimestamp = Math.floor(Date.now() / 1000) + deadline * 60;

        // Get quote from Sailor API
        let apiQuoteData: any = null;
        try {
          const apiQuote = await SailorApiService.getQuote({
            tokenIn,
            tokenOut,
            amountIn,
            tokenInDecimals: swapInfo.tokenInDecimals,
            slippage,
          });

          apiQuoteData = apiQuote;

          if (!minAmountOut) {
            // Sailor API returns amounts in wei, apply slippage directly
            const totalAmountOutBigInt = BigInt(apiQuote.total_amount_out);
            const slippageBigInt = BigInt(Math.floor(slippage * 100));
            let minAmountOutBigInt = totalAmountOutBigInt * (10000n - slippageBigInt) / 10000n;
            
            // For very small amounts, be more lenient to account for fees and precision loss
            if (totalAmountOutBigInt < 10000n) { // Less than 10000 wei
              const minSlippageBigInt = slippageBigInt > 500n ? slippageBigInt : 500n; // At least 5% slippage
              minAmountOutBigInt = totalAmountOutBigInt * (10000n - minSlippageBigInt) / 10000n;
            }
            
            minAmountOut = minAmountOutBigInt.toString();
            
            // Warn about very small amounts
            if (amountInParsed < 1000000n) { // Less than 1M wei (very small for most tokens)
              console.warn(`⚠️ Very small swap amount detected: ${amountInParsed.toString()} wei. Consider using larger amounts for better reliability.`);
            }
          }
        } catch (apiError) {
          return SwapResponseService.createUnsupportedPairError(
            "Sailor Finance",
            swapInfo.tokenInSymbol,
            swapInfo.tokenOutSymbol,
            tokenIn,
            tokenOut,
            apiError
          );
        }

        // For Sailor, minAmountOut is already in wei
        const minAmountOutParsed = BigInt(minAmountOut!);

        // Handle approval
        const approvalResult = await approvalService.handleAutoApproval({
          tokenIn,
          spenderAddress: SAILOR_ROUTER,
          amountIn,
          amountInParsed,
          currentAllowance: swapInfo.allowance,
          tokenInDecimals: swapInfo.tokenInDecimals,
          tokenInSymbol: swapInfo.tokenInSymbol,
          protocolName: "Sailor Finance",
        });

        if (!approvalResult.success) {
          return approvalResult.error!;
        }

        // Determine function and parameters based on route complexity
        const isMultiHop = apiQuoteData?.route?.length > 1;
        
        let functionName: string;
        let args: any[];

        if (isMultiHop) {
          // Use exactInput for multi-hop
          functionName = "exactInput";
          if (!apiQuoteData?.route) {
            return SwapResponseService.createErrorResponse(
              new Error("Missing route data for multi-hop swap"),
              "Sailor Finance"
            );
          }
          const encodedPath = encodeV3Path(apiQuoteData.route);
          args = [{
            path: encodedPath,
            recipient: account.address,
            deadline: BigInt(deadlineTimestamp),
            amountIn: amountInParsed,
            amountOutMinimum: minAmountOutParsed
          }];
        } else {
          // Use exactInputSingle for single-hop
          functionName = "exactInputSingle";
          if (!apiQuoteData?.route?.[0]) {
            return SwapResponseService.createErrorResponse(
              new Error("Missing route data for single-hop swap"),
              "Sailor Finance"
            );
          }
          const fee = apiQuoteData.route[0].fee ? parseInt(apiQuoteData.route[0].fee) : 3000;
          args = [{
            tokenIn: tokenIn as `0x${string}`,
            tokenOut: tokenOut as `0x${string}`,
            fee: fee,
            recipient: account.address,
            deadline: BigInt(deadlineTimestamp),
            amountIn: amountInParsed,
            amountOutMinimum: minAmountOutParsed,
            sqrtPriceLimitX96: BigInt(0)
          }];
        }

        // Estimate gas
        const gasParams = await gasService.estimateAndPriceGas({
          gasLimit,
          gasPrice,
          apiQuoteData,
          isComplexRouting: isMultiHop,
          protocol: 'sailor',
          contractAddress: SAILOR_ROUTER,
          abi: SAILOR_ROUTER_ABI,
          functionName,
          args,
          account,
        });

        // Execute transaction
        const executionResult = await executionService.executeTransaction({
          contractAddress: SAILOR_ROUTER,
          abi: SAILOR_ROUTER_ABI,
          functionName,
          args,
          gasParams,
        });

        if (!executionResult.success) {
          return executionResult.error!;
        }

        // Return success response
        return SwapResponseService.createSuccessResponse({
          protocol: "Sailor Finance",
          transactionHash: executionResult.hash!,
          receipt: executionResult.receipt!,
          tokenIn: {
            address: tokenIn,
            symbol: swapInfo.tokenInSymbol,
            name: swapInfo.tokenInName,
            amount: amountIn,
            decimals: swapInfo.tokenInDecimals,
          },
          tokenOut: {
            address: tokenOut,
            symbol: swapInfo.tokenOutSymbol,
            name: swapInfo.tokenOutName,
            minAmount: minAmountOut!,
            decimals: swapInfo.tokenOutDecimals,
          },
          route: {
            type: isMultiHop ? "Complex" : "Direct",
            hops: apiQuoteData?.route.length || 1,
            routeString: apiQuoteData
              ? SailorApiService.formatRouteString(apiQuoteData.route)
              : `Direct: ${swapInfo.tokenInSymbol} -> ${swapInfo.tokenOutSymbol}`,
            usedAPI: !!apiQuoteData,
            priceImpact: apiQuoteData?.total_price_impact || "unknown",
          },
          slippage: {
            tolerance: `${slippage}%`,
            minimumReceived: minAmountOut!,
            autoCalculated: !minAmountOut,
          },
          deadline: new Date(deadlineTimestamp * 1000).toISOString(),
          wallet: account.address,
        });

      } catch (error) {
        return SwapResponseService.createErrorResponse(error, "Sailor Finance");
      }
    }
  );

  // DragonSwap Quote Tool
  server.tool(
    "dragonswap_quote",
    "Get a quote for a token swap on DragonSwap using API (read-only)",
    {
      tokenIn: swapParametersSchema.tokenIn,
      tokenOut: swapParametersSchema.tokenOut,
      amountIn: swapParametersSchema.amountIn,
      slippage: swapParametersSchema.slippage,
    },
    async ({ tokenIn, tokenOut, amountIn, slippage = 2.0 }) => {
      try {
        if (!shouldFetchProtocolData("dragonswap")) {
          return SwapValidationService.createProtocolDisabledError("DragonSwap");
        }

        const publicClient = getPublicClient(DEFAULT_NETWORK);
        const walletClient = await getWalletClientFromProvider(DEFAULT_NETWORK);
        const account = walletClient.account;

        if (!account) {
          return SwapValidationService.createWalletNotConnectedError();
        }

        const multicallService = new MulticallService(publicClient, 1329);
        const {
          tokenInDecimals,
          tokenOutDecimals,
          tokenInSymbol,
          tokenOutSymbol,
        } = await multicallService.getTokenBasicInfo(
          tokenIn as `0x${string}`,
          tokenOut as `0x${string}`
        );

        try {
          const apiQuote = await DragonSwapApiService.getQuote({
            tokenIn,
            tokenOut,
            amountIn,
            tokenInDecimals,
            recipient: account.address,
            slippage,
            deadline: 1200,
          });

          const routePath = DragonSwapApiService.extractPathFromRoute(apiQuote.route);
          const minAmountOut = DragonSwapApiService.calculateMinAmountOut(
            apiQuote.quoteDecimals,
            slippage
          );

          return SwapResponseService.createQuoteResponse({
            protocol: "DragonSwap",
            inputToken: {
              address: tokenIn,
              symbol: tokenInSymbol,
              amount: amountIn,
            },
            outputToken: {
              address: tokenOut,
              symbol: tokenOutSymbol,
              estimatedAmount: apiQuote.quoteDecimals,
            },
            route: {
              path: routePath,
              routeString: apiQuote.routeString,
              pools: apiQuote.route[0]?.length || 0,
            },
            pricing: {
              priceImpact: `${apiQuote.priceImpact}%`,
              gasEstimate: apiQuote.gasUseEstimate,
              gasEstimateUSD: apiQuote.gasUseEstimateUSD,
            },
            slippage: {
              tolerance: `${slippage}%`,
              minimumReceived: minAmountOut,
            },
            apiResponse: {
              methodParameters: apiQuote.methodParameters,
              blockNumber: apiQuote.blockNumber,
              hitsCachedRoutes: apiQuote.hitsCachedRoutes,
            },
          });
        } catch (apiError) {
          return SwapResponseService.createUnsupportedPairError(
            "DragonSwap",
            tokenInSymbol,
            tokenOutSymbol,
            tokenIn,
            tokenOut,
            apiError
          );
        }
      } catch (error) {
        return SwapResponseService.createErrorResponse(error, "DragonSwap");
      }
    }
  );

  // Sailor Quote Tool
  server.tool(
    "sailor_quote",
    "Get a quote for a token swap on Sailor Finance using API (read-only)",
    {
      tokenIn: swapParametersSchema.tokenIn,
      tokenOut: swapParametersSchema.tokenOut,
      amountIn: swapParametersSchema.amountIn,
      slippage: swapParametersSchema.slippage,
      maxDepth: z.number().min(1).max(5).optional().describe("Maximum routing depth (default: 3)"),
    },
    async ({ tokenIn, tokenOut, amountIn, slippage = 2.0, maxDepth = 3 }) => {
      try {
        if (!shouldFetchProtocolData("sailor")) {
          return SwapValidationService.createProtocolDisabledError("Sailor Finance");
        }

        const publicClient = getPublicClient(DEFAULT_NETWORK);
        const walletClient = await getWalletClientFromProvider(DEFAULT_NETWORK);
        const account = walletClient.account;

        if (!account) {
          return SwapValidationService.createWalletNotConnectedError();
        }

        const multicallService = new MulticallService(publicClient, 1329);
        const {
          tokenInDecimals,
          tokenOutDecimals,
          tokenInSymbol,
          tokenOutSymbol,
        } = await multicallService.getTokenBasicInfo(
          tokenIn as `0x${string}`,
          tokenOut as `0x${string}`
        );

        try {
          const apiQuote = await SailorApiService.getQuote({
            tokenIn,
            tokenOut,
            amountIn,
            tokenInDecimals,
            slippage,
            maxDepth,
          });

          const routePath = SailorApiService.extractPathFromRoute(apiQuote.route);
          const minAmountOut = SailorApiService.calculateMinAmountOut(
            apiQuote.total_amount_out,
            slippage
          );
          const routeString = SailorApiService.formatRouteString(apiQuote.route);

          return SwapResponseService.createQuoteResponse({
            protocol: "Sailor Finance",
            inputToken: {
              address: tokenIn,
              symbol: tokenInSymbol,
              amount: amountIn,
            },
            outputToken: {
              address: tokenOut,
              symbol: tokenOutSymbol,
              estimatedAmount: apiQuote.total_amount_out,
            },
            route: {
              path: routePath,
              routeString: routeString,
              hops: apiQuote.route.length,
            },
            pricing: {
              priceImpact: `${apiQuote.total_price_impact}%`,
              totalFee: apiQuote.total_fee,
              gasEstimate: apiQuote.estimated_gas,
            },
            slippage: {
              tolerance: `${slippage}%`,
              minimumReceived: minAmountOut,
            },
            apiResponse: {
              success: apiQuote.success,
              route: apiQuote.route,
            },
          });
        } catch (apiError) {
          return SwapResponseService.createUnsupportedPairError(
            "Sailor Finance",
            tokenInSymbol,
            tokenOutSymbol,
            tokenIn,
            tokenOut,
            apiError
          );
        }
      } catch (error) {
        return SwapResponseService.createErrorResponse(error, "Sailor Finance");
      }
    }
  );

  // Approval Tool
  server.tool(
    "approve_token_allowance",
    "Approve another address (like a DeFi protocol or exchange) to spend your ERC20 tokens",
    {
      tokenAddress: z.string().describe("The contract address of the ERC20 token to approve for spending"),
      spenderAddress: z.string().describe("The contract address being approved to spend your tokens"),
      amount: z.string().describe("The amount of tokens to approve in token units, not wei"),
      network: z.string().optional().describe("Network name (defaults to Sei mainnet)"),
    },
    async ({ tokenAddress, spenderAddress, amount, network = DEFAULT_NETWORK }) => {
      try {
        const result = await services.approveERC20(tokenAddress, spenderAddress, amount, network);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  txHash: result.txHash,
                  network,
                  tokenAddress,
                  spender: spenderAddress,
                  amount: result.amount.formatted,
                  symbol: result.token.symbol,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return SwapResponseService.createErrorResponse(error);
      }
    }
  );

  console.log("Refactored swap tools registered successfully");
}

// Helper function for V3 path encoding (moved from inline)
function encodeV3Path(route: any[]): `0x${string}` {
  if (!route || route.length === 0) {
    throw new Error("Invalid route for V3 path encoding");
  }
  
  if (!route[0] || !route[0].token_in) {
    throw new Error("Invalid route structure: missing token_in in first hop");
  }
  
  let path = route[0].token_in.toLowerCase().replace('0x', '');
  
  for (const hop of route) {
    if (!hop || !hop.token_out || !hop.fee) {
      throw new Error("Invalid route hop: missing token_out or fee");
    }
    const feeHex = parseInt(hop.fee).toString(16).padStart(6, '0');
    path += feeHex;
    path += hop.token_out.toLowerCase().replace('0x', '');
  }
  
  return `0x${path}` as `0x${string}`;
}