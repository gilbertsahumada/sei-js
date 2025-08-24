import { PublicClient, WalletClient, formatUnits, parseUnits } from 'viem';
import { MulticallService } from '../../services/MulticallService.js';

export interface SwapValidationParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  account: any;
  routerAddress: string;
}

export interface SwapValidationResult {
  swapInfo: {
    tokenInDecimals: number;
    tokenOutDecimals: number;
    tokenInSymbol: string;
    tokenOutSymbol: string;
    tokenInName: string;
    tokenOutName: string;
    balance: bigint;
    allowance: bigint;
  };
  amountInParsed: bigint;
  isValid: boolean;
  error?: {
    type: 'insufficient_balance' | 'validation_error';
    content: any[];
  };
}

export class SwapValidationService {
  constructor(
    private publicClient: PublicClient,
    private walletClient: WalletClient
  ) {}

  async validateSwapParameters(params: SwapValidationParams): Promise<SwapValidationResult> {
    const { tokenIn, tokenOut, amountIn, account, routerAddress } = params;

    try {
      const multicallService = new MulticallService(this.publicClient, 1329);
      const swapInfo = await multicallService.getSwapInfo(
        tokenIn as `0x${string}`,
        tokenOut as `0x${string}`,
        account.address,
        routerAddress as `0x${string}`
      );

      const amountInParsed = parseUnits(amountIn, swapInfo.tokenInDecimals);

      if (swapInfo.balance < amountInParsed) {
        return {
          swapInfo,
          amountInParsed,
          isValid: false,
          error: {
            type: 'insufficient_balance',
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    error: "Insufficient balance",
                    required: formatUnits(amountInParsed, swapInfo.tokenInDecimals),
                    available: formatUnits(swapInfo.balance, swapInfo.tokenInDecimals),
                    tokenAddress: tokenIn,
                    tokenSymbol: swapInfo.tokenInSymbol,
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
        swapInfo,
        amountInParsed,
        isValid: true,
      };
    } catch (error) {
      return {
        swapInfo: {} as any,
        amountInParsed: 0n,
        isValid: false,
        error: {
          type: 'validation_error',
          content: [
            {
              type: "text" as const,
              text: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        },
      };
    }
  }

  static createProtocolDisabledError(protocolName: string) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: `${protocolName} protocol is disabled`,
              suggestion: `Use manage_protocols tool to enable ${protocolName}`,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  static createWalletNotConnectedError() {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: "No wallet account found. Please connect your wallet.",
            },
            null,
            2
          ),
        },
      ],
    };
  }
}