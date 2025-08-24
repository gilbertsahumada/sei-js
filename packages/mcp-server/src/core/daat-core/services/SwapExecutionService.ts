import { PublicClient, WalletClient, TransactionReceipt } from 'viem';
import { GasResult } from './SwapGasService.js';

export interface TransactionParams {
  contractAddress: string;
  abi: readonly any[];
  functionName: string;
  args: any[];
  gasParams: GasResult;
  value?: bigint;
}

export interface TransactionResult {
  success: boolean;
  hash?: string;
  receipt?: TransactionReceipt;
  error?: {
    type: 'simulation_failed' | 'execution_failed' | 'transaction_reverted';
    content: any[];
  };
}

export class SwapExecutionService {
  constructor(
    private publicClient: PublicClient,
    private walletClient: WalletClient
  ) {}

  async executeTransaction(params: TransactionParams): Promise<TransactionResult> {
    const { contractAddress, abi, functionName, args, gasParams, value = 0n } = params;

    try {
      const hash = await this.walletClient.writeContract({
        address: contractAddress as `0x${string}`,
        abi,
        functionName,
        args,
        gas: BigInt(gasParams.estimatedGas),
        maxFeePerGas: gasParams.maxFeePerGas,
        maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
        value,
        account: this.walletClient.account!,
        chain: this.walletClient.chain,
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: hash as `0x${string}`,
        timeout: 60_000,
      });

      if (receipt.status === "reverted") {
        return {
          success: false,
          hash,
          receipt,
          error: {
            type: 'transaction_reverted',
            content: [
              {
                type: "text" as const,
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
                        "Check if token pair exists on DEX",
                      ],
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          },
        };
      }

      return {
        success: true,
        hash,
        receipt,
      };
    } catch (error) {
      
      return {
        success: false,
        error: {
          type: 'execution_failed',
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "error",
                  message: error instanceof Error ? error.message : String(error),
                  troubleshooting: {
                    nextSteps: [
                      "Check your wallet balance",
                      "Verify token allowances",
                      "Try with smaller amount",
                      "Increase gas limit",
                    ],
                  },
                },
                null,
                2
              ),
            },
          ],
        },
      };
    }
  }

  async simulateTransaction(params: Omit<TransactionParams, 'gasParams'>) {
    const { contractAddress, abi, functionName, args, value = 0n } = params;

    try {
      await this.publicClient.simulateContract({
        address: contractAddress as `0x${string}`,
        abi,
        functionName,
        args,
        value,
        account: this.walletClient.account!.address,
      });
      
      return { success: true };
    } catch (simulationError) {
      
      return {
        success: false,
        error: {
          type: 'simulation_failed' as const,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: "Transaction simulation failed",
                  rawError: simulationError instanceof Error 
                    ? simulationError.message 
                    : String(simulationError),
                  suggestions: [
                    "Check if tokens exist and have liquidity on DEX",
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
        },
      };
    }
  }

  async executeRawTransaction(params: {
    to: string;
    data: string;
    value?: string;
    gasParams: GasResult;
  }): Promise<TransactionResult> {
    const { to, data, value = "0x0", gasParams } = params;

    try {
      const hash = await this.walletClient.sendTransaction({
        to: to as `0x${string}`,
        data: data as `0x${string}`,
        value: BigInt(value),
        gas: BigInt(gasParams.estimatedGas),
        maxFeePerGas: gasParams.maxFeePerGas,
        maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
        account: this.walletClient.account!,
        chain: this.walletClient.chain,
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: hash as `0x${string}`,
        timeout: 60_000,
      });

      if (receipt.status === "reverted") {
        return {
          success: false,
          hash,
          receipt,
          error: {
            type: 'transaction_reverted',
            content: [{
              type: "text" as const,
              text: JSON.stringify({ 
                status: "failed", 
                message: "Raw transaction was reverted",
                transactionHash: hash,
                explorer: `https://seitrace.com/tx/${hash}`,
              }, null, 2),
            }],
          },
        };
      }

      return {
        success: true,
        hash,
        receipt,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'execution_failed',
          content: [{
            type: "text" as const,
            text: `Raw transaction execution failed: ${error instanceof Error ? error.message : String(error)}`,
          }],
        },
      };
    }
  }
}