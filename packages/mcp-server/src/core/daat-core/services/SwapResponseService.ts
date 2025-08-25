import { TransactionReceipt } from 'viem';

export interface SwapResponseParams {
  protocol: string;
  transactionHash: string;
  receipt: TransactionReceipt;
  tokenIn: {
    address: string;
    symbol: string;
    name: string;
    amount: string;
    decimals: number;
  };
  tokenOut: {
    address: string;
    symbol: string;
    name: string;
    minAmount: string;
    decimals: number;
  };
  route: {
    path?: string[];
    routeString?: string;
    usedAPI?: boolean;
    priceImpact?: string;
    type?: string;
    hops?: number;
  };
  slippage: {
    tolerance: string;
    minimumReceived: string;
    autoCalculated: boolean;
  };
  deadline: string;
  wallet: string;
}

export class SwapResponseService {
  static createSuccessResponse(params: SwapResponseParams) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              status: "success",
              message: `Swap executed successfully on ${params.protocol}`,
              transactionHash: params.transactionHash,
              blockNumber: params.receipt.blockNumber.toString(),
              gasUsed: params.receipt.gasUsed.toString(),
              explorer: `https://seitrace.com/tx/${params.transactionHash}`,
              swap: {
                protocol: params.protocol,
                tokenIn: params.tokenIn,
                tokenOut: params.tokenOut,
                route: params.route,
                slippage: params.slippage,
                deadline: params.deadline,
              },
              wallet: params.wallet,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  static createErrorResponse(
    error: Error | unknown,
    protocol?: string
  ) {
    return {
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
                  "Try get quote first to test parameters",
                  `Check ${protocol || "DEX"} frontend for comparison`,
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

  static createQuoteResponse(params: {
    protocol: string;
    inputToken: {
      address: string;
      symbol: string;
      amount: string;
    };
    outputToken: {
      address: string;
      symbol: string;
      estimatedAmount: string;
    };
    route: {
      path?: string[];
      routeString?: string;
      pools?: number;
      hops?: number;
    };
    pricing: {
      priceImpact?: string;
      gasEstimate?: string;
      gasEstimateUSD?: string;
      totalFee?: string;
    };
    slippage: {
      tolerance: string;
      minimumReceived: string;
    };
    apiResponse?: any;
  }) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              quote: {
                protocol: params.protocol,
                inputToken: params.inputToken,
                outputToken: params.outputToken,
                route: params.route,
                pricing: params.pricing,
                slippage: params.slippage,
              },
              apiResponse: params.apiResponse,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  static createUnsupportedPairError(
    protocol: string,
    tokenInSymbol: string,
    tokenOutSymbol: string,
    tokenIn: string,
    tokenOut: string,
    apiError?: Error | unknown
  ) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: `Trading pair not supported on ${protocol}`,
              message: apiError instanceof Error ? apiError.message : String(apiError),
              tokenIn: `${tokenInSymbol} (${tokenIn})`,
              tokenOut: `${tokenOutSymbol} (${tokenOut})`,
              suggestions: [
                "Verify token addresses are correct",
                `Check if pair exists on ${protocol} frontend`,
                "Try other DEX protocols",
              ],
            },
            null,
            2
          ),
        },
      ],
    };
  }
}