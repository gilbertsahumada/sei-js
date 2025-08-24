import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getWalletClientFromProvider,
  getPublicClient,
} from "../services/clients.js";
import { parseUnits, formatUnits } from "viem";
import {
  ERC20_ABI,
  DRAGONSWAP_ROUTER_ABI,
  DRAGONSWAP_ROUTER_ADDRESS,
  SAILOR_ROUTER_ADDRESS,
  SAILOR_ROUTER_ABI,
} from "../dex/contracts/abis/index.js";
import { shouldFetchProtocolData } from "./protocol-config.js";
import { DEFAULT_NETWORK } from "../chains.js";
import { DragonSwapApiService } from "../dex/pricing/DragonSwapApiService.js";
import { SailorApiService } from "../dex/pricing/SailorApiService.js";
import { MulticallService } from "../services/MulticallService.js";
import * as services from "../services/index.js";

const DRAGONSWAP_ROUTER = DRAGONSWAP_ROUTER_ADDRESS;
const SAILOR_ROUTER = SAILOR_ROUTER_ADDRESS;

// USDT = 0x9151434b16b9763660705744891fA906F660EcC5
// USDC = 0xe15fc38f6d8c56af07bbcbe3baf5708a2bf42392
// FXS  = 0x64445f0aecc51e94ad52d8ac56b7190e764e561a

export function registerSwapTools(server: McpServer) {
  server.tool(
    "dragonswap_swap",
    "Execute a token swap on DragonSwap DEX (uses PRIVATE_KEY from environment)",
    {
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
            if (!val) return true; // Allow empty for auto-calculation
            const num = parseFloat(val);
            return !isNaN(num) && num > 0;
          },
          {
            message:
              "Minimum amount out must be a valid positive number when provided",
          }
        )
        .optional()
        .describe(
          "Minimum amount out (optional - will be calculated from quote if not provided)"
        ),
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
      console.log("🔧[TOOL_dragonswap_swap]");
      try {
        if (!shouldFetchProtocolData("dragonswap")) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "DragonSwap protocol is disabled",
                    suggestion:
                      "Use manage_protocols tool to enable DragonSwap",
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        const publicClient = getPublicClient(DEFAULT_NETWORK);
        const walletClient = await getWalletClientFromProvider(DEFAULT_NETWORK);
        const account = walletClient.account;

        if (!account) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error:
                      "No wallet account found. Please connect your wallet.",
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        const multicallService = new MulticallService(publicClient, 1329);

        const swapInfo = await multicallService.getSwapInfo(
          tokenIn as `0x${string}`,
          tokenOut as `0x${string}`,
          account.address,
          DRAGONSWAP_ROUTER as `0x${string}`
        );

        const amountInParsed = parseUnits(amountIn, swapInfo.tokenInDecimals);

        if (swapInfo.balance < amountInParsed) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "Insufficient balance",
                    required: formatUnits(
                      amountInParsed,
                      swapInfo.tokenInDecimals
                    ),
                    available: formatUnits(
                      swapInfo.balance,
                      swapInfo.tokenInDecimals
                    ),
                    tokenAddress: tokenIn,
                    tokenSymbol: swapInfo.tokenInSymbol,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const deadlineTimestamp = Math.floor(Date.now() / 1000) + deadline * 60;

        let useApiCalldata = false;
        let apiQuoteData: any = null;
        let path: string[] = [tokenIn, tokenOut]; // fallback path
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
            timeoutMs: 10000, // 10 second timeout
          });

          apiQuoteData = apiQuote;

          // Calculate minAmountOut if not provided
          if (!minAmountOut) {
            minAmountOut = DragonSwapApiService.calculateMinAmountOut(
              apiQuote.quoteDecimals,
              slippage
            );
            console.log(
              `Auto-calculated minAmountOut: ${minAmountOut} (${slippage}% slippage - increased for reliability)`
            );
          }

          // Check if API provides method parameters for direct execution
          if (
            apiQuote.methodParameters &&
            apiQuote.methodParameters.calldata &&
            apiQuote.methodParameters.to
          ) {
            console.log("Using DragonSwap API optimized calldata");
            console.log(`🎯 API Contract: ${apiQuote.methodParameters.to}`);
            console.log(
              `📝 Calldata length: ${apiQuote.methodParameters.calldata.length} chars`
            );
            console.log(`💰 Value: ${apiQuote.methodParameters.value}`);

            console.log(
              `📝 Calldata: ${apiQuote.methodParameters.calldata.substring(
                0,
                20
              )}...`
            );

            const quoteAmount = parseFloat(apiQuote.quoteDecimals);
            const inputAmount = parseFloat(amountIn);

            if (quoteAmount <= 0) {
              throw new Error("API returned zero or negative output amount");
            }

            if (quoteAmount > inputAmount * 1000) {
              // Sanity check - no token should 1000x in a swap
              console.warn(
                `⚠️ Suspicious quote: ${quoteAmount} output for ${inputAmount} input`
              );
            }

            if (apiQuote.blockNumber) {
              const currentBlock = await publicClient.getBlockNumber();
              const blockDiff =
                Number(currentBlock) - Number(apiQuote.blockNumber);
              if (blockDiff > 5) {
                // More than 5 blocks old (~30 seconds)
                console.warn(
                  `⚠️ API quote is ${blockDiff} blocks old, prices may have changed`
                );
              }
            }

            useApiCalldata = true;
          } else {
            // Extract path from API response as fallback
            path = DragonSwapApiService.extractPathFromRoute(apiQuote.route);
            console.log(
              "Using DragonSwap API route with standard router:",
              apiQuote.routeString
            );
          }
        } catch (apiError) {
          console.warn("DragonSwap API failed:", apiError);

          // Check for routing errors
          if (
            apiError instanceof Error &&
            apiError.message.includes("No trading route found")
          ) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      error: "Trading pair not supported on DragonSwap",
                      message: apiError.message,
                      tokenIn: `${swapInfo.tokenInSymbol} (${tokenIn})`,
                      tokenOut: `${swapInfo.tokenOutSymbol} (${tokenOut})`,
                      suggestions: [
                        "Verify token addresses are correct",
                        "Check if pair exists on DragonSwap frontend",
                        "Try other DEX protocols (Sailor, Yaka Finance)",
                      ],
                    },
                    null,
                    2
                  ),
                },
              ],
              isError: true,
            };
          }

          // If no minAmountOut provided and API failed, we can't continue
          if (!minAmountOut) {
            throw new Error(
              "minAmountOut is required when DragonSwap API is unavailable"
            );
          }
        }

        const minAmountOutParsed = parseUnits(
          minAmountOut!,
          swapInfo.tokenOutDecimals
        );

        const spenderAddress =
          useApiCalldata && apiQuoteData?.methodParameters?.to
            ? apiQuoteData.methodParameters.to
            : DRAGONSWAP_ROUTER;

        let currentAllowance = swapInfo.allowance; // This is for the default router

        if (spenderAddress !== DRAGONSWAP_ROUTER) {
          try {
            currentAllowance = (await publicClient.readContract({
              address: tokenIn as `0x${string}`,
              abi: ERC20_ABI,
              functionName: "allowance",
              args: [account.address, spenderAddress as `0x${string}`],
            })) as bigint;
            console.log(
              `Allowance for API contract ${spenderAddress}: ${formatUnits(
                currentAllowance,
                swapInfo.tokenInDecimals
              )}`
            );
          } catch (error) {
            console.warn(
              "Failed to check allowance for API contract, using default"
            );
          }
        }

        // Log detailed state before transaction
        console.log(`🔍 Pre-transaction state check:`, {
          userBalance: formatUnits(swapInfo.balance, swapInfo.tokenInDecimals),
          requiredAmount: formatUnits(amountInParsed, swapInfo.tokenInDecimals),
          allowance: formatUnits(currentAllowance, swapInfo.tokenInDecimals),
          spenderAddress,
          tokenInAddress: tokenIn,
          tokenOutAddress: tokenOut,
          userAddress: account.address,
        });

        // Auto-approve if allowance is insufficient
        if (currentAllowance < amountInParsed) {
          console.log(`🔐 Insufficient allowance detected, auto-approving...`);
          console.log(`Required: ${formatUnits(amountInParsed, swapInfo.tokenInDecimals)} ${swapInfo.tokenInSymbol}`);
          console.log(`Current: ${formatUnits(currentAllowance, swapInfo.tokenInDecimals)} ${swapInfo.tokenInSymbol}`);
          console.log(`Spender: ${spenderAddress}`);

          try {
            // Approve the exact amount needed (safer than max approval)
            const approveResult = await services.approveERC20(
              tokenIn,
              spenderAddress,
              amountIn,
              DEFAULT_NETWORK
            );

            console.log(`✅ DragonSwap auto-approval successful: ${approveResult.txHash}`);

            // Wait for approval confirmation with multiple confirmations
            await publicClient.waitForTransactionReceipt({
              hash: approveResult.txHash as `0x${string}`,
              confirmations: 2, // Wait for 2 block confirmations
              timeout: 45_000 // 45 seconds timeout for approval with confirmations
            });

            console.log(`✅ DragonSwap approval confirmed with 2 confirmations, proceeding with swap`);

          } catch (approveError) {
            console.error(`❌ DragonSwap auto-approval failed:`, approveError);

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      error: "Auto-approval failed",
                      message: approveError instanceof Error ? approveError.message : String(approveError),
                      required: formatUnits(
                        amountInParsed,
                        swapInfo.tokenInDecimals
                      ),
                      current: formatUnits(
                        currentAllowance,
                        swapInfo.tokenInDecimals
                      ),
                      spenderAddress,
                      contractType:
                        spenderAddress === DRAGONSWAP_ROUTER
                          ? "DragonSwap Router"
                          : "DragonSwap API Contract",
                      suggestions: [
                        "Check if you have sufficient SEI for gas fees",
                        "Try manual approval with approve_token_allowance tool",
                        "Verify token contract is not paused or blacklisted"
                      ]
                    },
                    null,
                    2
                  ),
                },
              ],
              isError: true
            };
          }
        }

        // Estimate gas if not provided
        let estimatedGas = gasLimit;
        if (!estimatedGas) {
          try {
            if (useApiCalldata && apiQuoteData?.methodParameters) {
              // Use API provided gas estimate but add buffer for multicall
              estimatedGas = apiQuoteData.gasUseEstimate
                ? Number(apiQuoteData.gasUseEstimate) + 50000
                : 300000;
              console.log(
                `Using API gas estimate with buffer: ${estimatedGas}`
              );
            } else {
              // Standard router gas estimation
              estimatedGas = Number(
                await publicClient.estimateContractGas({
                  address: DRAGONSWAP_ROUTER as `0x${string}`,
                  abi: DRAGONSWAP_ROUTER_ABI,
                  functionName: "swapExactTokensForTokens",
                  args: [
                    amountInParsed,
                    minAmountOutParsed,
                    path as `0x${string}`[],
                    account.address,
                  ],
                  account: account.address,
                })
              );
              console.log(`Estimated gas (standard router): ${estimatedGas}`);
            }
          } catch {
            estimatedGas = 400000; // NOTE: I'll keep it simple with a flat estimate for single-hop V3
            console.warn(
              `Failed to estimate gas, using fallback value of ${estimatedGas}`
            );
          }
        }

        // Get current gas price if not provided
        let currentGasPrice = gasPrice
          ? BigInt(gasPrice)
          : await publicClient.getGasPrice();

        // Simulate transaction before executing to catch reverts
        console.log(`🧪 Simulating transaction before execution...`);
        try {
          if (useApiCalldata && apiQuoteData?.methodParameters) {
            // Simulate API calldata
            await publicClient.call({
              to: apiQuoteData.methodParameters.to as `0x${string}`,
              data: apiQuoteData.methodParameters.calldata as `0x${string}`,
              value: BigInt(apiQuoteData.methodParameters.value || "0x0"),
              account: account.address,
            });
          } else {
            // Simulate standard router call
            await publicClient.simulateContract({
              address: DRAGONSWAP_ROUTER as `0x${string}`,
              abi: DRAGONSWAP_ROUTER_ABI,
              functionName: "swapExactTokensForTokens",
              args: [
                amountInParsed,
                minAmountOutParsed,
                path as `0x${string}`[],
                account.address,
              ],
              account: account.address,
            });
          }
          console.log(`✅ Simulation passed, proceeding with transaction`);
        } catch (simulationError) {
          console.error(`❌ Simulation failed:`, simulationError);

          // Try to decode the error
          let errorReason = "Unknown revert reason";
          if (simulationError instanceof Error) {
            const errorMsg = simulationError.message;
            console.error(`Simulation error message: ${errorMsg}`);
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "Transaction simulation failed",
                    reason: errorReason,
                    rawError:
                      simulationError instanceof Error
                        ? simulationError.message
                        : String(simulationError),
                    debugInfo: {
                      tokenIn: `${swapInfo.tokenInSymbol} (${tokenIn})`,
                      tokenOut: `${swapInfo.tokenOutSymbol} (${tokenOut})`,
                      amountIn: `${amountIn} ${swapInfo.tokenInSymbol}`,
                      minAmountOut: `${minAmountOut} ${swapInfo.tokenOutSymbol}`,
                      userBalance: formatUnits(
                        swapInfo.balance,
                        swapInfo.tokenInDecimals
                      ),
                      allowance: formatUnits(
                        currentAllowance,
                        swapInfo.tokenInDecimals
                      ),
                      spenderAddress,
                      slippage: `${slippage}%`,
                      deadline: new Date(
                        deadlineTimestamp * 1000
                      ).toISOString(),
                    },
                    suggestions: [
                      "Check if tokens exist and have liquidity on DragonSwap",
                      "Try with smaller amount",
                      "Increase slippage tolerance",
                      "Verify token addresses are correct",
                      "Check if pair exists on DragonSwap",
                    ],
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        let hash: string;

        if (useApiCalldata && apiQuoteData?.methodParameters) {
          console.log(
            `🎯 Using DragonSwap API - calling multicall with data[] only`
          );

          // Call multicall(data[]) instead of the API's multicall(deadline, data[])
          // We extract the inner swap calldata and call multicall directly
          const originalCalldata = apiQuoteData.methodParameters.calldata;

          // The API calldata is for multicall(deadline, data[])
          // But we need to call multicall(data[]) - the version with 1 parameter
          // For now, let's try calling with the raw calldata but using writeContract
          try {
            // Decode the multicall parameters from the API calldata
            // This is complex, so let's use a simpler approach first
            console.log(
              `📝 API Calldata: ${originalCalldata.substring(0, 50)}...`
            );

            // Parse the API calldata to extract the inner swap data
            // API format: multicall(deadline, data[])
            // We need: multicall(data[]) - extract just the swap calldata

            const cleanCalldata = originalCalldata.startsWith("0x")
              ? originalCalldata.slice(2)
              : originalCalldata;

            // Decode the multicall structure:
            // - Function selector: first 8 chars (4 bytes)
            // - Parameter 1 (deadline): chars 8-71 (32 bytes)
            // - Parameter 2 (data[] offset): chars 72-135 (32 bytes)
            // - Array length: chars 136-199 (32 bytes)
            // - First data item offset: chars 200-263 (32 bytes)
            // - Data item length: chars 264-327 (32 bytes)
            // - Actual data: starting at char 328

            // Extract the actual swap calldata (skip all the multicall wrapper)
            const dataLengthHex = cleanCalldata.substring(264, 328); // Length of the data item
            const dataLength = parseInt(dataLengthHex, 16) * 2; // Convert to hex chars
            const swapCalldata =
              "0x" + cleanCalldata.substring(328, 328 + dataLength);

            console.log(
              `📦 Extracted swap calldata: ${swapCalldata.substring(0, 50)}...`
            );
            console.log(`📦 Data length: ${dataLength / 2} bytes`);

            // Now call multicall(data[]) with just the swap calldata
            hash = await walletClient.writeContract({
              address: apiQuoteData.methodParameters.to as `0x${string}`,
              abi: DRAGONSWAP_ROUTER_ABI,
              functionName: "multicall",
              args: [[swapCalldata as `0x${string}`]],
              value: BigInt(apiQuoteData.methodParameters.value || "0x0"),
              gas: BigInt(estimatedGas),
              maxFeePerGas: currentGasPrice * 2n, // 2x current gas price
              maxPriorityFeePerGas: currentGasPrice / 10n, // 10% priority fee
              account: walletClient.account!,
              chain: walletClient.chain,
            });
          } catch (multicallError) {
            console.error(
              `❌ Multicall failed, trying original method:`,
              multicallError
            );

            // Fallback to original if multicall fails
            hash = await walletClient.sendTransaction({
              to: apiQuoteData.methodParameters.to as `0x${string}`,
              data: apiQuoteData.methodParameters.calldata as `0x${string}`,
              value: BigInt(apiQuoteData.methodParameters.value || "0x0"),
              gas: BigInt(estimatedGas),
              maxFeePerGas: currentGasPrice * 2n,
              maxPriorityFeePerGas: currentGasPrice / 10n,
              account: walletClient.account!,
              chain: walletClient.chain,
            });
          }
        } else {
          // Use standard router method
          console.log(`🔄 Using standard DragonSwap router`);

          hash = await walletClient.writeContract({
            address: DRAGONSWAP_ROUTER as `0x${string}`,
            abi: DRAGONSWAP_ROUTER_ABI,
            functionName: "swapExactTokensForTokens",
            args: [
              amountInParsed,
              minAmountOutParsed,
              path as `0x${string}`[],
              account.address,
            ],
            gas: BigInt(estimatedGas),
            maxFeePerGas: currentGasPrice * 2n,
            maxPriorityFeePerGas: currentGasPrice / 10n,
            account: walletClient.account!,
            chain: walletClient.chain,
          });
        }

        console.log(`🔍 Waiting for transaction confirmation: ${hash}`);
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: hash as `0x${string}`,
          timeout: 60_000, // 60 second timeout
        });

        // Check if transaction was successful
        if (receipt.status === "reverted") {
          console.log(`❌ Transaction failed: ${hash}`);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "failed",
                    message: "Transaction was reverted",
                    transactionHash: hash,
                    blockNumber: receipt.blockNumber.toString(),
                    gasUsed: receipt.gasUsed.toString(),
                    explorer: `https://seitrace.com/tx/${hash}`,
                    troubleshooting: {
                      possibleCauses: [
                        "Insufficient allowance - try approve_token_allowance first",
                        "Slippage too low - price moved during transaction",
                        "Insufficient balance for gas fees",
                        "Token liquidity issues",
                        "Router contract error",
                      ],
                      suggestions: [
                        "Check allowance with token info tools",
                        "Increase slippage tolerance (try 1-2%)",
                        "Verify sufficient SEI balance for gas",
                        "Try smaller amount",
                        "Check if token pair exists on DragonSwap",
                      ],
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        console.log(`✅ Transaction successful: ${hash}`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "success",
                  message: "Swap executed successfully",
                  transactionHash: hash,
                  blockNumber: receipt.blockNumber.toString(),
                  gasUsed: receipt.gasUsed.toString(),
                  explorer: `https://seitrace.com/tx/${hash}`,
                  swap: {
                    protocol: "DragonSwap",
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
                      minAmount: minAmountOut,
                      decimals: swapInfo.tokenOutDecimals,
                    },
                    route: {
                      path,
                      routeString:
                        apiQuoteData?.routeString ||
                        `Direct swap: ${swapInfo.tokenInSymbol} -> ${swapInfo.tokenOutSymbol}`,
                      usedAPI: !!apiQuoteData,
                      priceImpact: apiQuoteData?.priceImpact || "unknown",
                    },
                    slippage: {
                      tolerance: `${slippage}%`,
                      minimumReceived: minAmountOut,
                      autoCalculated: !wasMinAmountOutProvided,
                    },
                    deadline: new Date(deadlineTimestamp * 1000).toISOString(),
                  },
                  wallet: account.address,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        console.error(`❌ Swap failed:`, error);
        let errorType = "Unknown";
        let guidance: string[] = [];

        if (error instanceof Error) {
          const errorMessage = error.message.toLowerCase();
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "error",
                  errorType,
                  message:
                    error instanceof Error ? error.message : String(error),
                  guidance,
                  troubleshooting: {
                    nextSteps: [
                      "Check your wallet balance",
                      "Verify token allowances",
                      "Try get quote first to test parameters",
                      "Check DragonSwap frontend for comparison",
                    ],
                  },
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Get quote for DragonSwap swap (no transaction)
  server.tool(
    "dragonswap_quote",
    "Get a quote for a token swap on DragonSwap using API (read-only)",
    {
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
      slippage: z
        .number()
        .min(0)
        .max(100, "Slippage must be between 0 and 100")
        .optional()
        .describe("Slippage tolerance in percentage (default: 2.0)"),
    },
    async ({ tokenIn, tokenOut, amountIn, slippage = 2.0 }) => {
      console.log("🔧[TOOL_dragonswap_quote]");
      try {
        if (!shouldFetchProtocolData("dragonswap")) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "DragonSwap protocol is disabled",
                    suggestion:
                      "Use manage_protocols tool to enable DragonSwap",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const publicClient = getPublicClient(DEFAULT_NETWORK);
        const walletClient = await getWalletClientFromProvider(DEFAULT_NETWORK);
        const account = walletClient.account;

        if (!account) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error:
                      "No wallet account found. Please connect your wallet.",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Get token decimals and info using multicall3
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

        console.log(`Token info retrieved:`, {
          tokenIn: {
            address: tokenIn,
            decimals: tokenInDecimals,
            symbol: tokenInSymbol,
          },
          tokenOut: {
            address: tokenOut,
            decimals: tokenOutDecimals,
            symbol: tokenOutSymbol,
          },
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
            deadline: 1200,
          });

          // Extract route path
          const routePath = DragonSwapApiService.extractPathFromRoute(
            apiQuote.route
          );
          const minAmountOut = DragonSwapApiService.calculateMinAmountOut(
            apiQuote.quoteDecimals,
            slippage
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    quote: {
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
                    },
                    apiResponse: {
                      methodParameters: apiQuote.methodParameters,
                      blockNumber: apiQuote.blockNumber,
                      hitsCachedRoutes: apiQuote.hitsCachedRoutes,
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (apiError) {
          console.error("DragonSwap API failed:", apiError);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "Trading pair not supported on DragonSwap",
                    message: apiError,
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting quote: ${error instanceof Error ? error.message : String(error)
                }`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // BRING THIS TOOL BACK
  server.tool(
    "approve_token_allowance",
    "Approve another address (like a DeFi protocol or exchange) to spend your ERC20 tokens. This is often required before interacting with DeFi protocols.",
    {
      tokenAddress: z
        .string()
        .describe(
          "The contract address of the ERC20 token to approve for spending (e.g., '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')"
        ),
      spenderAddress: z
        .string()
        .describe(
          "The contract address being approved to spend your tokens (e.g., a DEX or lending protocol)"
        ),
      amount: z
        .string()
        .describe(
          "The amount of tokens to approve in token units, not wei (e.g., '1000' to approve spending 1000 tokens). Use a very large number for unlimited approval."
        ),
      network: z
        .string()
        .optional()
        .describe(
          "Network name (e.g., 'sei', 'sei-testnet', 'sei-devnet') or chain ID. Defaults to Sei mainnet."
        ),
    },
    async ({
      tokenAddress,
      spenderAddress,
      amount,
      network = DEFAULT_NETWORK,
    }) => {
      try {
        const result = await services.approveERC20(
          tokenAddress,
          spenderAddress,
          amount,
          network
        );

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
        return {
          content: [
            {
              type: "text",
              text: `Error approving token spending: ${error instanceof Error ? error.message : String(error)
                }`,
            },
          ],
        };
      }
    }
  );

  // Sailor Finance Quote Tool
  server.tool(
    "sailor_quote",
    "Get a quote for a token swap on Sailor Finance using API (read-only)",
    {
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
      slippage: z
        .number()
        .min(0)
        .max(100, "Slippage must be between 0 and 100")
        .optional()
        .describe("Slippage tolerance in percentage (default: 2.0)"),
      maxDepth: z
        .number()
        .min(1)
        .max(5)
        .optional()
        .describe("Maximum routing depth (default: 3)"),
    },
    async ({ tokenIn, tokenOut, amountIn, slippage = 2.0, maxDepth = 3 }) => {
      console.log("🔧[TOOL_sailor_quote]");
      try {
        if (!shouldFetchProtocolData("sailor")) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "Sailor Finance protocol is disabled",
                    suggestion:
                      "Use manage_protocols tool to enable Sailor Finance",
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        const publicClient = getPublicClient(DEFAULT_NETWORK);
        const walletClient = await getWalletClientFromProvider(DEFAULT_NETWORK);
        const account = walletClient.account;

        if (!account) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error:
                      "No wallet account found. Please connect your wallet.",
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        // Get token decimals and info using multicall3
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

        console.log(`Token info retrieved:`, {
          tokenIn: {
            address: tokenIn,
            decimals: tokenInDecimals,
            symbol: tokenInSymbol,
          },
          tokenOut: {
            address: tokenOut,
            decimals: tokenOutDecimals,
            symbol: tokenOutSymbol,
          },
        });

        try {
          // Get quote from Sailor Finance API
          const apiQuote = await SailorApiService.getQuote({
            tokenIn,
            tokenOut,
            amountIn,
            tokenInDecimals,
            slippage,
            maxDepth,
          });

          // Extract route path
          const routePath = SailorApiService.extractPathFromRoute(
            apiQuote.route
          );
          const minAmountOut = SailorApiService.calculateMinAmountOut(
            apiQuote.total_amount_out,
            slippage
          );
          const routeString = SailorApiService.formatRouteString(
            apiQuote.route
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    quote: {
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
                    },
                    apiResponse: {
                      success: apiQuote.success,
                      route: apiQuote.route,
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (apiError) {
          console.error("Sailor Finance API failed:", apiError);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "Trading pair not supported on Sailor Finance",
                    message:
                      apiError instanceof Error
                        ? apiError.message
                        : String(apiError),
                    tokenIn: `${tokenInSymbol} (${tokenIn})`,
                    tokenOut: `${tokenOutSymbol} (${tokenOut})`,
                    suggestions: [
                      "Verify token addresses are correct",
                      "Check if pair exists on Sailor Finance frontend",
                      "Try other DEX protocols (DragonSwap, Yaka Finance)",
                    ],
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting Sailor quote: ${error instanceof Error ? error.message : String(error)
                }`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Sailor Finance Swap Tool
  server.tool(
    "sailor_swap",
    "Execute a token swap on Sailor Finance DEX (uses PRIVATE_KEY from environment)",
    {
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
            if (!val) return true; // Allow empty for auto-calculation
            const num = parseFloat(val);
            return !isNaN(num) && num > 0;
          },
          {
            message:
              "Minimum amount out must be a valid positive number when provided",
          }
        )
        .optional()
        .describe(
          "Minimum amount out (optional - will be calculated from quote if not provided)"
        ),
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
        .refine((val) => val === undefined || /^\\d+$/.test(val), {
          message: "Gas price must be a valid number in wei",
        })
        .describe("Gas price override in wei (default: current)"),
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
      console.log("🔧[TOOL_sailor_swap]");
      try {
        if (!shouldFetchProtocolData("sailor")) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "Sailor Finance protocol is disabled",
                    suggestion:
                      "Use manage_protocols tool to enable Sailor Finance",
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        const publicClient = getPublicClient(DEFAULT_NETWORK);
        const walletClient = await getWalletClientFromProvider(DEFAULT_NETWORK);
        const account = walletClient.account;

        if (!account) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error:
                      "No wallet account found. Please connect your wallet.",
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        // Get all token info, balance, and allowance in one multicall
        const multicallService = new MulticallService(publicClient, 1329);

        // Get basic swap info with Sailor router
        const swapInfo = await multicallService.getSwapInfo(
          tokenIn as `0x${string}`,
          tokenOut as `0x${string}`,
          account.address,
          SAILOR_ROUTER as `0x${string}`
        );

        const amountInParsed = parseUnits(amountIn, swapInfo.tokenInDecimals);

        if (swapInfo.balance < amountInParsed) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "Insufficient balance",
                    required: formatUnits(
                      amountInParsed,
                      swapInfo.tokenInDecimals
                    ),
                    available: formatUnits(
                      swapInfo.balance,
                      swapInfo.tokenInDecimals
                    ),
                    tokenAddress: tokenIn,
                    tokenSymbol: swapInfo.tokenInSymbol,
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        const deadlineTimestamp = Math.floor(Date.now() / 1000) + deadline * 60;

        let apiQuoteData: any = null;
        let useComplexRouting = false;
        const wasMinAmountOutProvided = !!minAmountOut;

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
            // apiQuote.total_amount_out is already in wei, so we need to apply slippage directly as bigint
            const totalAmountOutBigInt = BigInt(apiQuote.total_amount_out);
            const slippageBigInt = BigInt(Math.floor(slippage * 100)); // Convert to basis points
            let minAmountOutBigInt = totalAmountOutBigInt * (10000n - slippageBigInt) / 10000n;
            
            // For very small amounts, be more lenient to account for fees and precision loss
            if (totalAmountOutBigInt < 10000n) { // Less than 10000 wei
              const minSlippageBigInt = slippageBigInt > 500n ? slippageBigInt : 500n; // At least 5% slippage
              minAmountOutBigInt = totalAmountOutBigInt * (10000n - minSlippageBigInt) / 10000n;
            }
            
            minAmountOut = minAmountOutBigInt.toString();
            console.log(
              `Auto-calculated minAmountOut: ${minAmountOut} (${slippage}% slippage) - direct from wei`
            );
            
            // Warn about very small amounts
            if (amountInParsed < 1000000n) { // Less than 1M wei (very small for most tokens)
              console.warn(`⚠️ Very small swap amount detected: ${amountInParsed.toString()} wei. Consider using larger amounts for better reliability.`);
            }
          }

          useComplexRouting = apiQuote.route.length > 1;

        } catch (apiError) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error:
                      "Route is not supported on Sailor Finance. Pool may not exist.",
                    suggestion:
                      "Pool does not exist. We prefer NOT to continue with direct swap to avoid high slippage",
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        // For Sailor, minAmountOut is already in wei after our calculation above
        const minAmountOutParsed = BigInt(minAmountOut!);

        if (swapInfo.allowance < amountInParsed) {
          try {
            const approveResult = await services.approveERC20(
              tokenIn,
              SAILOR_ROUTER,
              amountIn,
              DEFAULT_NETWORK
            );

            //console.log(`✅ Sailor auto-approval successful: ${approveResult.txHash}`);

            await publicClient.waitForTransactionReceipt({
              hash: approveResult.txHash as `0x${string}`,
              confirmations: 2, // Wait for 2 block confirmations
              timeout: 45_000 // 45 seconds timeout for approval with confirmations
            });

            console.log(`✅ Sailor approval confirmed with 2 confirmations, proceeding with swap`);

          } catch (approveError) {
            console.error(`❌ Sailor auto-approval failed:`, approveError);

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      error: "Auto-approval failed",
                      message: approveError instanceof Error ? approveError.message : String(approveError),
                      required: formatUnits(
                        amountInParsed,
                        swapInfo.tokenInDecimals
                      ),
                      current: formatUnits(
                        swapInfo.allowance,
                        swapInfo.tokenInDecimals
                      ),
                      spenderAddress: SAILOR_ROUTER,
                      contractType: "Sailor Finance Router",
                      suggestions: [
                        "Check if you have sufficient SEI for gas fees",
                        "Try manual approval with approve_token_allowance tool",
                        "Verify token contract is not paused or blacklisted"
                      ]
                    },
                    null,
                    2
                  ),
                },
              ],
              isError: true,
            };
          }
        }

        // Estimate gas if not provided
        let estimatedGas = gasLimit;
        if (!estimatedGas) {
          try {
            if (useComplexRouting && apiQuoteData) {
              estimatedGas = apiQuoteData.estimated_gas
                ? Number(apiQuoteData.estimated_gas) + 200000 // Add buffer to API estimate
                : 400000;
              console.log(
                `Using API gas estimate for complex routing: ${estimatedGas}`
              );
            } else {
              estimatedGas = 400000; // NOTE: I'll keep it simple with a flat estimate for single-hop V3
              console.log(`Using default V3 gas limit: ${estimatedGas}`);
            }
          } catch {
            estimatedGas = 400000; //NOTE:  I'll keep it simple with a flat estimate for single-hop V3
            console.warn(
              `Failed to estimate gas, using V3 fallback value of ${estimatedGas}`
            );
          }
        }

        let currentGasPrice = gasPrice
          ? BigInt(gasPrice)
          : await publicClient.getGasPrice();

        // Use API recommended gas parameters if available
        let maxPriorityFeePerGas = currentGasPrice / 10n;
        let maxFeePerGas = currentGasPrice * 2n;

        if (apiQuoteData) {
          // Check if API provided gas parameters (works for both single and multi-hop)
          const apiMaxPriorityFee = apiQuoteData.maxPriorityFeePerGas;
          const apiMaxFee = apiQuoteData.maxFeePerGas;

          if (apiMaxPriorityFee) {
            maxPriorityFeePerGas = BigInt(apiMaxPriorityFee);
            console.log(`Using API recommended maxPriorityFeePerGas: ${maxPriorityFeePerGas}`);
          }

          if (apiMaxFee) {
            maxFeePerGas = BigInt(apiMaxFee);
            console.log(`Using API recommended maxFeePerGas: ${maxFeePerGas}`);
          } else if (apiMaxPriorityFee) {
            // If we have priority fee but not max fee, calculate max fee
            maxFeePerGas = maxPriorityFeePerGas * 2n;
            console.log(`Calculated maxFeePerGas from priority fee: ${maxFeePerGas}`);
          }
        }

        // Sailor Finance is pure V3 - use exactInput for multi-hop, exactInputSingle for single hop
        const shouldUseExactInput = apiQuoteData?.route.length > 1;

        console.log(`🧪 Simulating Sailor transaction before execution...`);
        console.log(`DEBUG: useComplexRouting=${useComplexRouting}, apiQuoteData?.route.length=${apiQuoteData?.route.length}, shouldUseExactInput=${shouldUseExactInput}`);
        console.log(`Using ${shouldUseExactInput ? 'exactInput (V3 multi-hop)' : 'exactInputSingle (V3 single-hop)'} for ${apiQuoteData?.route.length || 1} hops`);

        console.log(`⚠️ Skipping simulation temporarily, proceeding directly to transaction`);

        /* SIMULATION CODE - COMMENTED OUT FOR TESTING
        try {
          if (shouldUseExactInput && apiQuoteData) {
            // Use exactInput for complex V3 routing
            const encodedPath = encodeV3Path(apiQuoteData.route);
            console.log(`🔗 Encoded V3 path: ${encodedPath}`);
            
            const exactInputParams = {
              path: encodedPath,
              recipient: account.address,
              deadline: BigInt(deadlineTimestamp),
              amountIn: amountInParsed,
              amountOutMinimum: minAmountOutParsed
            };
            
            await publicClient.simulateContract({
              address: SAILOR_ROUTER as `0x${string}`,
              abi: SAILOR_ROUTER_ABI,
              functionName: "exactInput",
              args: [exactInputParams],
              account: account.address,
            });
            console.log(`✅ Sailor V3 exactInput simulation passed, proceeding with transaction`);
          } else {
            // Use simple V2-style swap for direct pairs
            await publicClient.simulateContract({
              address: SAILOR_ROUTER as `0x${string}`,
              abi: SAILOR_ROUTER_ABI,
              functionName: "swapExactTokensForTokens",
              args: [
                amountInParsed,
                minAmountOutParsed,
                [tokenIn, tokenOut] as `0x${string}`[],
                account.address,
              ],
              account: account.address,
            });
            console.log(`✅ Sailor V2 swapExactTokensForTokens simulation passed, proceeding with transaction`);
          }
        } catch (simulationError) {
          console.error(`❌ Sailor simulation failed:`);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "Transaction simulation failed",
                    rawError:
                      simulationError instanceof Error
                        ? simulationError.message
                        : String(simulationError),
                    debugInfo: {
                      tokenIn: `${swapInfo.tokenInSymbol} (${tokenIn})`,
                      tokenOut: `${swapInfo.tokenOutSymbol} (${tokenOut})`,
                      amountIn: `${amountIn} ${swapInfo.tokenInSymbol}`,
                      minAmountOut: `${minAmountOut} ${swapInfo.tokenOutSymbol}`,
                      userBalance: formatUnits(
                        swapInfo.balance,
                        swapInfo.tokenInDecimals
                      ),
                      allowance: formatUnits(
                        swapInfo.allowance,
                        swapInfo.tokenInDecimals
                      ),
                      router: SAILOR_ROUTER,
                      slippage: `${slippage}%`,
                      deadline: new Date(
                        deadlineTimestamp * 1000
                      ).toISOString(),
                    },
                    suggestions: [
                      "Check if tokens exist and have liquidity on Sailor Finance",
                      "Try with smaller amount",
                      "Increase slippage tolerance",
                      "Verify token addresses are correct",
                    ],
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }
        END OF SIMULATION CODE COMMENT */

        let hash: string;

        // Execute the swap
        console.log(`DEBUG EXECUTION: shouldUseExactInput=${shouldUseExactInput}, apiQuoteData exists=${!!apiQuoteData}`);

        if (shouldUseExactInput && apiQuoteData) {
          // Use exactInput for complex V3 routing
          console.log(`🔄 Executing V3 exactInput swap on Sailor Finance`);
          console.log(`DEBUG: Route data:`, JSON.stringify(apiQuoteData.route, null, 2));
          const encodedPath = encodeV3Path(apiQuoteData.route);
          console.log(`DEBUG: Encoded path: ${encodedPath}`);

          const exactInputParams = {
            path: encodedPath,
            recipient: account.address,
            deadline: BigInt(deadlineTimestamp),
            amountIn: amountInParsed,
            amountOutMinimum: minAmountOutParsed
          };

          console.log(`DEBUG: exactInput parameters:`, {
            path: encodedPath,
            recipient: account.address,
            deadline: deadlineTimestamp,
            amountIn: amountInParsed.toString(),
            amountOutMinimum: minAmountOutParsed.toString()
          });

          hash = await walletClient.writeContract({
            address: SAILOR_ROUTER as `0x${string}`,
            abi: SAILOR_ROUTER_ABI,
            functionName: "exactInput",
            args: [exactInputParams],
            gas: BigInt(estimatedGas),
            maxFeePerGas: maxFeePerGas,
            maxPriorityFeePerGas: maxPriorityFeePerGas,
            account: walletClient.account!,
            chain: walletClient.chain,
          });
        } else {
          // Use exactInputSingle for single-hop V3 swaps
          console.log(`🔄 Executing V3 exactInputSingle on Sailor Finance`);

          // For exactInputSingle, we need to get the fee from the first (and only) hop
          const fee = apiQuoteData?.route[0]?.fee ? parseInt(apiQuoteData.route[0].fee) : 3000; // Default to 0.3% fee

          const exactInputSingleParams = {
            tokenIn: tokenIn as `0x${string}`,
            tokenOut: tokenOut as `0x${string}`,
            fee: fee,
            recipient: account.address,
            deadline: BigInt(deadlineTimestamp),
            amountIn: amountInParsed,
            amountOutMinimum: minAmountOutParsed,
            sqrtPriceLimitX96: BigInt(0)
          };

          console.log(`DEBUG: exactInputSingle parameters:`, {
            tokenIn,
            tokenOut,
            fee,
            recipient: account.address,
            deadline: deadlineTimestamp,
            amountIn: amountInParsed.toString(),
            amountOutMinimum: minAmountOutParsed.toString()
          });

          hash = await walletClient.writeContract({
            address: SAILOR_ROUTER as `0x${string}`,
            abi: SAILOR_ROUTER_ABI,
            functionName: "exactInputSingle",
            args: [exactInputSingleParams],
            gas: BigInt(estimatedGas),
            maxFeePerGas: maxFeePerGas,
            maxPriorityFeePerGas: maxPriorityFeePerGas,
            account: walletClient.account!,
            chain: walletClient.chain,
          });
        }

        console.log(`🔍 Waiting for Sailor transaction confirmation: ${hash}`);
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: hash as `0x${string}`,
          timeout: 60_000,
        });

        // Check if transaction was successful
        if (receipt.status === "reverted") {
          console.log(`❌ Sailor transaction failed: ${hash}`);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "failed",
                    message: "Transaction was reverted",
                    transactionHash: hash,
                    blockNumber: receipt.blockNumber.toString(),
                    gasUsed: receipt.gasUsed.toString(),
                    explorer: `https://seitrace.com/tx/${hash}`,
                    troubleshooting: {
                      possibleCauses: [
                        "Insufficient allowance - try approve_token_allowance first",
                        "Slippage too low - price moved during transaction",
                        "Insufficient balance for gas fees",
                        "Token liquidity issues on Sailor Finance",
                        "Router contract error",
                      ],
                      suggestions: [
                        "Check allowance with token info tools",
                        "Increase slippage tolerance (try 3-5%)",
                        "Verify sufficient SEI balance for gas",
                        "Try smaller amount",
                        "Check if token pair exists on Sailor Finance",
                      ],
                    },
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        console.log(`✅ Sailor transaction successful: ${hash}`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "success",
                  message: "Swap executed successfully on Sailor Finance",
                  transactionHash: hash,
                  blockNumber: receipt.blockNumber.toString(),
                  gasUsed: receipt.gasUsed.toString(),
                  explorer: `https://seitrace.com/tx/${hash}`,
                  swap: {
                    protocol: "Sailor Finance",
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
                      minAmount: minAmountOut,
                      decimals: swapInfo.tokenOutDecimals,
                    },
                    route: {
                      type: useComplexRouting ? "Complex" : "Direct",
                      hops: apiQuoteData?.route.length || 1,
                      routeString: apiQuoteData
                        ? SailorApiService.formatRouteString(apiQuoteData.route)
                        : `Direct: ${swapInfo.tokenInSymbol} -> ${swapInfo.tokenOutSymbol}`,
                      usedAPI: !!apiQuoteData,
                      priceImpact:
                        apiQuoteData?.total_price_impact || "unknown",
                    },
                    slippage: {
                      tolerance: `${slippage}%`,
                      minimumReceived: minAmountOut,
                      autoCalculated: !wasMinAmountOutProvided,
                    },
                    deadline: new Date(deadlineTimestamp * 1000).toISOString(),
                  },
                  wallet: account.address,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        console.error(`❌ Sailor swap failed:`, error);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "error",
                  message:
                    error instanceof Error ? error.message : String(error),
                  troubleshooting: {
                    nextSteps: [
                      "Check your wallet balance",
                      "Verify token allowances for Sailor router",
                      "Try get quote first to test parameters",
                      "Check Sailor Finance frontend for comparison",
                      "Ensure tokens are supported on Sailor Finance",
                    ],
                  },
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    }
  );


  // Helper function to encode V3 path from Sailor route
  function encodeV3Path(route: any[]): `0x${string}` {
    if (!route || route.length === 0) {
      throw new Error("Invalid route for V3 path encoding");
    }

    console.log('DEBUG: encodeV3Path - input route:', JSON.stringify(route, null, 2));

    let path = route[0].tokenIn.address.toLowerCase().replace('0x', '');

    for (const hop of route) {
      const feeHex = parseInt(hop.fee).toString(16).padStart(6, '0');
      path += feeHex;

      path += hop.tokenOut.address.toLowerCase().replace('0x', '');
    }

    console.log(`DEBUG: encodeV3Path - final path: 0x${path}`);
    return `0x${path}` as `0x${string}`;
  }

  console.log("Swap tools registered successfully");
}
