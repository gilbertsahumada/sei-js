import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseUnits, formatUnits } from "viem";
import { sei } from "viem/chains";
import { ERC20_ABI } from "../dex/contracts/abis/index.js";
import { DEFAULT_NETWORK } from "../chains.js";
import { getPublicClient, getWalletClientFromProvider } from "../services/clients.js";


export function registerWalletTools(server: McpServer) {

  server.tool(
    "get_wallet_info",
    "Get wallet address and basic info (from PRIVATE_KEY in environment)",
    {},
    async () => {
      try {
        const walletClient = await getWalletClientFromProvider(DEFAULT_NETWORK);
        const account = walletClient.account;

        if (!account) {
          throw new Error("No wallet account found. Ensure PRIVATE_KEY is set in environment.");
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              address: account.address,
              chainId: sei.id,
              chainName: sei.name,
              nativeCurrency: sei.nativeCurrency,
              rpcUrls: sei.rpcUrls.default.http
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error getting wallet info: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Check token balance for an address
  server.tool(
    "check_token_balance",
    "Check the balance of a specific token for an address",
    {
      tokenAddress: z.string().describe("Token contract address (e.g., '0x1234...')"),
      ownerAddress: z.string().describe("Wallet address to check balance for"),
      decimals: z.number().optional().describe("Token decimals (default: 18)")
    },
    async ({ tokenAddress, ownerAddress, decimals = 18 }) => {
      const publicClient = getPublicClient(DEFAULT_NETWORK);

      try {
        // Read balance from token contract
        const balance = await publicClient.readContract({
          address: tokenAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [ownerAddress as `0x${string}`]
        });

        // Get token info
        const [symbol, name, actualDecimals] = await Promise.all([
          publicClient.readContract({
            address: tokenAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'symbol'
          }),
          publicClient.readContract({
            address: tokenAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'name'
          }),
          publicClient.readContract({
            address: tokenAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'decimals'
          })
        ]);

        const formattedBalance = formatUnits(balance as bigint, actualDecimals as number);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              token: {
                address: tokenAddress,
                symbol,
                name,
                decimals: actualDecimals
              },
              owner: ownerAddress,
              balance: {
                raw: balance.toString(),
                formatted: formattedBalance,
                display: `${formattedBalance} ${symbol}`
              }
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error checking token balance: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Check token allowance
  server.tool(
    "check_token_allowance",
    "Check how much a spender is allowed to spend of owner's tokens",
    {
      tokenAddress: z.string().describe("Token contract address"),
      ownerAddress: z.string().describe("Token owner address"),
      spenderAddress: z.string().describe("Spender address (usually DEX router)")
    },
    async ({ tokenAddress, ownerAddress, spenderAddress }) => {
      try {
        const publicClient = getPublicClient(DEFAULT_NETWORK);
        // Read current allowance
        const allowance = await publicClient.readContract({
          address: tokenAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [ownerAddress as `0x${string}`, spenderAddress as `0x${string}`]
        });

        // Get token info for formatting
        const [symbol, decimals] = await Promise.all([
          publicClient.readContract({
            address: tokenAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'symbol'
          }),
          publicClient.readContract({
            address: tokenAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'decimals'
          })
        ]);

        const formattedAllowance = formatUnits(allowance as bigint, decimals as number);
        const isUnlimited = (allowance as bigint) >= parseUnits("1000000000", decimals as number); // 1B+ tokens = unlimited

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              token: {
                address: tokenAddress,
                symbol
              },
              owner: ownerAddress,
              spender: spenderAddress,
              allowance: {
                raw: allowance.toString(),
                formatted: formattedAllowance,
                display: `${formattedAllowance} ${symbol}`,
                isUnlimited,
                needsApproval: (allowance as bigint) === 0n
              }
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error checking token allowance: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Check my wallet's token balance
  server.tool(
    "check_my_token_balance",
    "Check token balance of my wallet (from PRIVATE_KEY in environment)",
    {
      tokenAddress: z.string().describe("Token contract address")
    },
    async ({ tokenAddress }) => {
      try {

        const walletClient = await getWalletClientFromProvider(DEFAULT_NETWORK);
        const publicClient = getPublicClient(DEFAULT_NETWORK);

        const ownerAddress = walletClient.account!.address;
        
        // Read balance from token contract
        const balance = await publicClient.readContract({
          address: tokenAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [ownerAddress]
        });

        // Get token info
        const [symbol, name, decimals] = await Promise.all([
          publicClient.readContract({
            address: tokenAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'symbol'
          }),
          publicClient.readContract({
            address: tokenAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'name'
          }),
          publicClient.readContract({
            address: tokenAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'decimals'
          })
        ]);

        const formattedBalance = formatUnits(balance as bigint, decimals as number);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              wallet: ownerAddress,
              token: {
                address: tokenAddress,
                symbol,
                name,
                decimals
              },
              balance: {
                raw: balance.toString(),
                formatted: formattedBalance,
                display: `${formattedBalance} ${symbol}`
              }
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error checking my token balance: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Check SEI balance (native token)
  server.tool(
    "check_sei_balance",
    "Check SEI (native token) balance for an address",
    {
      address: z.string().describe("Wallet address to check SEI balance for")
    },
    async ({ address }) => {
      try {
        const publicClient = getPublicClient(DEFAULT_NETWORK);

        const balance = await publicClient.getBalance({
          address: address as `0x${string}`
        });

        const formattedBalance = formatUnits(balance, 18); // SEI has 18 decimals

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              address,
              balance: {
                raw: balance.toString(),
                formatted: formattedBalance,
                display: `${formattedBalance} SEI`
              }
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error checking SEI balance: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Check my wallet's SEI balance
  server.tool(
    "check_my_sei_balance",
    "Check SEI (native token) balance of my wallet (from PRIVATE_KEY in environment)",
    {},
    async () => {
      try {
        const walletClient = await getWalletClientFromProvider(DEFAULT_NETWORK);
        const publicClient = getPublicClient(DEFAULT_NETWORK);
        const account = walletClient.account;
        if (!account) {
          throw new Error("No wallet account found. Ensure PRIVATE_KEY is set in environment.");
        }
        const balance = await publicClient.getBalance({
          address: account.address
        });

        const formattedBalance = formatUnits(balance, 18); // SEI has 18 decimals

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              wallet: account.address,
              balance: {
                raw: balance.toString(),
                formatted: formattedBalance,
                display: `${formattedBalance} SEI`
              }
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error checking my SEI balance: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Approve token for spending (uses env PRIVATE_KEY)
  server.tool(
    "approve_token",
    "Approve a token for spending by a DEX router (uses PRIVATE_KEY from environment)",
    {
      tokenAddress: z.string().describe("Token contract address"),
      spenderAddress: z.string().describe("Spender address (DEX router)"),
      amount: z.string().optional().describe("Amount to approve (default: unlimited)"),
      gasLimit: z.number().optional().describe("Gas limit override (default: estimated)"),
      gasPrice: z.string().optional().describe("Gas price override in wei (default: current)")
    },
    async ({ tokenAddress, spenderAddress, amount, gasLimit, gasPrice }) => {
      try {

        const walletClient = await getWalletClientFromProvider(DEFAULT_NETWORK);
        const publicClient = await getPublicClient(DEFAULT_NETWORK);
        const account = walletClient.account!;

        if (!account) {
          throw new Error("No wallet account found. Ensure PRIVATE_KEY is set in environment.");
        }
        // Get token decimals for proper amount formatting
        const decimals = await publicClient.readContract({
          address: tokenAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'decimals'
        }) as number;

        // Use max uint256 for unlimited approval if no amount specified
        const approveAmount = amount ? parseUnits(amount, decimals) : parseUnits("115792089237316195423570985008687907853269984665640564039457", 0); // 2^256-1

        // Get current allowance to check if approval is needed
        const currentAllowance = await publicClient.readContract({
          address: tokenAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [account.address, spenderAddress as `0x${string}`]
        }) as bigint;

        if (currentAllowance >= approveAmount) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                status: "already_approved",
                message: "Token already has sufficient allowance",
                currentAllowance: formatUnits(currentAllowance, decimals),
                requestedAmount: amount || "unlimited",
                tokenAddress,
                spenderAddress,
                walletAddress: account.address
              }, null, 2)
            }]
          };
        }

        // Estimate gas if not provided
        let estimatedGas = gasLimit;
        if (!estimatedGas) {
          try {
            estimatedGas = Number(await publicClient.estimateContractGas({
              address: tokenAddress as `0x${string}`,
              abi: ERC20_ABI,
              functionName: 'approve',
              args: [spenderAddress as `0x${string}`, approveAmount],
              account: account.address
            }));
          } catch {
            estimatedGas = 60000; // Safe fallback for approve
          }
        }

        // Get current gas price if not provided
        let currentGasPrice = gasPrice ? BigInt(gasPrice) : await publicClient.getGasPrice();

        // Execute the approval transaction
        const hash = await walletClient.writeContract({
          address: tokenAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [spenderAddress as `0x${string}`, approveAmount],
          gas: BigInt(estimatedGas),
          gasPrice: currentGasPrice,
          account: account.address,
          chain: walletClient.chain
        });

        // Wait for transaction confirmation
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        // Get token info for response
        const [symbol, name] = await Promise.all([
          publicClient.readContract({
            address: tokenAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'symbol'
          }),
          publicClient.readContract({
            address: tokenAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'name'
          })
        ]);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "success",
              message: "Token approval successful",
              transactionHash: hash,
              blockNumber: receipt.blockNumber.toString(),
              gasUsed: receipt.gasUsed.toString(),
              token: {
                address: tokenAddress,
                symbol,
                name
              },
              approval: {
                spender: spenderAddress,
                amount: amount || "unlimited",
                amountRaw: approveAmount.toString()
              },
              wallet: account.address
            }, null, 2)
          }]
        };

      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error approving token: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Estimate gas for approve operation
  server.tool(
    "estimate_approve_gas",
    "Estimate gas cost for approving token spending",
    {
      tokenAddress: z.string().describe("Token contract address"),
      spenderAddress: z.string().describe("Spender address (DEX router)"),
      amount: z.string().optional().describe("Amount to approve (default: unlimited)")
    },
    async ({ tokenAddress, spenderAddress, amount }) => {
      try {
        const publicClient = getPublicClient(DEFAULT_NETWORK);
        // Use max uint256 for unlimited approval if no amount specified
        const approveAmount = amount ? parseUnits(amount, 18) : parseUnits("1000000000", 18);

        // Note: This estimates gas but doesn't actually send the transaction
        // In a real implementation, you'd need a wallet client with a private key
        const gasEstimate = await publicClient.estimateContractGas({
          address: tokenAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [spenderAddress as `0x${string}`, approveAmount],
          account: "0x0000000000000000000000000000000000000000" // Dummy account for estimation
        }).catch(() => BigInt(50000)); // Fallback estimate

        // Get current gas price
        const gasPrice = await publicClient.getGasPrice();
        const estimatedCost = gasEstimate * gasPrice;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              operation: "approve",
              token: tokenAddress,
              spender: spenderAddress,
              amount: amount || "unlimited",
              gasEstimate: {
                gas: gasEstimate.toString(),
                gasPrice: gasPrice.toString(),
                estimatedCostWei: estimatedCost.toString(),
                estimatedCostSEI: formatUnits(estimatedCost, 18)
              }
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error estimating approve gas: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  console.log("Wallet tools registered successfully");
}