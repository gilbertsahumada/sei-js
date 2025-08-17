import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getWalletClientFromProvider, getPublicClient } from "../services/clients.js";
import { parseUnits, formatUnits } from "viem";
import { ERC20_ABI, DRAGONSWAP_ROUTER_ABI, DRAGONSWAP_ROUTER_ADDRESS } from "../dex/contracts/abis/index.js";
import { protocolConfig, shouldFetchProtocolData } from "./protocol-config.js";
import { DEFAULT_NETWORK } from "../chains.js";

/**
 * Swap execution tools for DEX protocols
 * Currently supports DragonSwap (Uniswap V2 style)
 * Uses PRIVATE_KEY from environment variables for security
 */

// Use DragonSwap Router Address from ABI file
const DRAGONSWAP_ROUTER = DRAGONSWAP_ROUTER_ADDRESS;

export function registerSwapTools(server: McpServer) {

  // Execute swap on DragonSwap
  server.tool(
    "dragonswap_swap",
    "Execute a token swap on DragonSwap DEX (uses PRIVATE_KEY from environment)",
    {
      tokenIn: z.string().describe("Input token address"),
      tokenOut: z.string().describe("Output token address"),
      amountIn: z.string().describe("Amount of input token to swap"),
      minAmountOut: z.string().describe("Minimum amount of output token expected (slippage protection)"),
      deadline: z.number().optional().describe("Transaction deadline in minutes from now (default: 20)"),
      gasLimit: z.number().optional().describe("Gas limit override (default: estimated)"),
      gasPrice: z.string().optional().describe("Gas price override in wei (default: current)")
    },
    async ({ tokenIn, tokenOut, amountIn, minAmountOut, deadline = 20, gasLimit, gasPrice }) => {
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

        const publicClient = await getPublicClient(DEFAULT_NETWORK);
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

        // Get token decimals for proper amount formatting
        const [tokenInDecimals, tokenOutDecimals] = await Promise.all([
          publicClient.readContract({
            address: tokenIn as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'decimals'
          }) as Promise<number>,
          publicClient.readContract({
            address: tokenOut as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'decimals'
          }) as Promise<number>
        ]);

        // Parse amounts using proper decimals
        const amountInParsed = parseUnits(amountIn, tokenInDecimals);
        const minAmountOutParsed = parseUnits(minAmountOut, tokenOutDecimals);

        // Check if user has enough balance
        const balance = await publicClient.readContract({
          address: tokenIn as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [account.address]
        }) as bigint;

        if (balance < amountInParsed) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Insufficient balance",
                required: formatUnits(amountInParsed, tokenInDecimals),
                available: formatUnits(balance, tokenInDecimals),
                tokenAddress: tokenIn
              }, null, 2)
            }],
            isError: true
          };
        }

        // Check allowance
        const allowance = await publicClient.readContract({
          address: tokenIn as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [account.address, DRAGONSWAP_ROUTER as `0x${string}`]
        }) as bigint;

        if (allowance < amountInParsed) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Insufficient allowance",
                required: formatUnits(amountInParsed, tokenInDecimals),
                current: formatUnits(allowance, tokenInDecimals),
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

        // Determine swap path (direct or through WSEI)
        const WSEI = "0x0000000000000000000000000000000000000000"; // TODO: Get actual WSEI address
        let path: string[];
        
        // For now, assume direct swap. In production, check if pair exists
        path = [tokenIn, tokenOut];

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

        // Wait for transaction confirmation
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        // Get token info for response
        const [tokenInInfo, tokenOutInfo] = await Promise.all([
          Promise.all([
            publicClient.readContract({
              address: tokenIn as `0x${string}`,
              abi: ERC20_ABI,
              functionName: 'symbol'
            }),
            publicClient.readContract({
              address: tokenIn as `0x${string}`,
              abi: ERC20_ABI,
              functionName: 'name'
            })
          ]),
          Promise.all([
            publicClient.readContract({
              address: tokenOut as `0x${string}`,
              abi: ERC20_ABI,
              functionName: 'symbol'
            }),
            publicClient.readContract({
              address: tokenOut as `0x${string}`,
              abi: ERC20_ABI,
              functionName: 'name'
            })
          ])
        ]);

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
                  symbol: tokenInInfo[0],
                  name: tokenInInfo[1],
                  amount: amountIn
                },
                tokenOut: {
                  address: tokenOut,
                  symbol: tokenOutInfo[0],
                  name: tokenOutInfo[1],
                  minAmount: minAmountOut
                },
                path,
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
    "Get a quote for a token swap on DragonSwap (read-only)",
    {
      tokenIn: z.string().describe("Input token address"),
      tokenOut: z.string().describe("Output token address"),
      amountIn: z.string().describe("Amount of input token")
    },
    async ({ tokenIn, tokenOut, amountIn }) => {
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

        const publicClient = await getPublicClient(DEFAULT_NETWORK);
        // Get token decimals
        const [tokenInDecimals, tokenOutDecimals] = await Promise.all([
          publicClient.readContract({
            address: tokenIn as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'decimals'
          }) as Promise<number>,
          publicClient.readContract({
            address: tokenOut as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'decimals'
          }) as Promise<number>
        ]);

        // Parse input amount
        const amountInParsed = parseUnits(amountIn, tokenInDecimals);

        // Define the path for swapping
        const path = [tokenIn as `0x${string}`, tokenOut as `0x${string}`];

        try {
          // Get quote from router using getAmountsOut
          const amounts = await publicClient.readContract({
            address: DRAGONSWAP_ROUTER as `0x${string}`,
            abi: DRAGONSWAP_ROUTER_ABI,
            functionName: 'getAmountsOut',
            args: [amountInParsed, path]
          }) as bigint[];

          // amounts[0] = input amount
          // amounts[1] = output amount
          const amountOut = amounts[1];
          const formattedAmountOut = formatUnits(amountOut, tokenOutDecimals);

          // Calculate price impact (simplified)
          const inputValue = parseFloat(amountIn);
          const outputValue = parseFloat(formattedAmountOut);
          const rate = outputValue / inputValue;

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                quote: {
                  protocol: "DragonSwap",
                  inputToken: tokenIn,
                  outputToken: tokenOut,
                  inputAmount: amountIn,
                  estimatedOutput: formattedAmountOut,
                  rate: `1 input = ${rate.toFixed(6)} output`,
                  route: path,
                  router: DRAGONSWAP_ROUTER
                },
                calculation: {
                  inputAmountParsed: amountInParsed.toString(),
                  outputAmountParsed: amountOut.toString(),
                  inputDecimals: tokenInDecimals,
                  outputDecimals: tokenOutDecimals
                },
                minimumReceived: {
                  withSlippage_1pct: (parseFloat(formattedAmountOut) * 0.99).toFixed(6),
                  withSlippage_2pct: (parseFloat(formattedAmountOut) * 0.98).toFixed(6),
                  withSlippage_5pct: (parseFloat(formattedAmountOut) * 0.95).toFixed(6)
                }
              }, null, 2)
            }]
          };

        } catch (contractError) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Quote failed - likely no liquidity pool exists",
                details: contractError instanceof Error ? contractError.message : String(contractError),
                inputToken: tokenIn,
                outputToken: tokenOut,
                inputAmount: amountIn,
                suggestion: "Check if a liquidity pool exists for this token pair on DragonSwap"
              }, null, 2)
            }],
            isError: true
          };
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