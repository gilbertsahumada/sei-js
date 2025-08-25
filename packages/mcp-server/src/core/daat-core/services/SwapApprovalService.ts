import { PublicClient, formatUnits } from 'viem';
import * as services from '../../services/index.js';
import { DEFAULT_NETWORK } from '../../chains.js';

export interface ApprovalParams {
  tokenIn: string;
  spenderAddress: string;
  amountIn: string;
  amountInParsed: bigint;
  currentAllowance: bigint;
  tokenInDecimals: number;
  tokenInSymbol: string;
  protocolName: string;
}

export interface ApprovalResult {
  success: boolean;
  error?: {
    content: any[];
  };
}

export class SwapApprovalService {
  constructor(private publicClient: PublicClient) {}

  async handleAutoApproval(params: ApprovalParams): Promise<ApprovalResult> {
    const {
      tokenIn,
      spenderAddress,
      amountIn,
      amountInParsed,
      currentAllowance,
      tokenInDecimals,
      tokenInSymbol,
      protocolName,
    } = params;

    if (currentAllowance >= amountInParsed) {
      return { success: true };
    }


    try {
      const approveResult = await services.approveERC20(
        tokenIn,
        spenderAddress,
        amountIn,
        DEFAULT_NETWORK
      );

      await this.publicClient.waitForTransactionReceipt({
        hash: approveResult.txHash as `0x${string}`,
        confirmations: 2,
        timeout: 45_000
      });

      return { success: true };
      
    } catch (approveError) {
      
      return {
        success: false,
        error: {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: "Auto-approval failed",
                  message: approveError instanceof Error ? approveError.message : String(approveError),
                  required: formatUnits(amountInParsed, tokenInDecimals),
                  current: formatUnits(currentAllowance, tokenInDecimals),
                  spenderAddress,
                  contractType: `${protocolName} Router`,
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
        }
      };
    }
  }

  async checkAllowanceForSpender(
    tokenIn: string,
    account: any,
    spenderAddress: string,
    defaultAllowance: bigint,
    tokenInDecimals: number
  ): Promise<bigint> {
    try {
      const allowance = (await this.publicClient.readContract({
        address: tokenIn as `0x${string}`,
        abi: [
          {
            inputs: [
              { type: 'address', name: 'owner' },
              { type: 'address', name: 'spender' }
            ],
            name: 'allowance',
            outputs: [{ type: 'uint256' }],
            stateMutability: 'view',
            type: 'function'
          }
        ],
        functionName: "allowance",
        args: [account.address, spenderAddress as `0x${string}`],
      })) as bigint;

      return allowance;
    } catch (error) {
      return defaultAllowance;
    }
  }
}