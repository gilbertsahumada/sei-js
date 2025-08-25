import { PublicClient } from 'viem';

export interface GasEstimationParams {
  gasLimit?: number;
  gasPrice?: string;
  apiQuoteData?: any;
  useApiCalldata?: boolean;
  isComplexRouting?: boolean;
  protocol: 'dragonswap' | 'sailor';
  contractAddress: string;
  abi: readonly any[];
  functionName: string;
  args: any[];
  account: any;
}

export interface GasResult {
  estimatedGas: number;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export class SwapGasService {
  constructor(private publicClient: PublicClient) {}

  async estimateAndPriceGas(params: GasEstimationParams): Promise<GasResult> {
    const {
      gasLimit,
      gasPrice,
      apiQuoteData,
      useApiCalldata,
      isComplexRouting,
      protocol,
      contractAddress,
      abi,
      functionName,
      args,
      account,
    } = params;

    let estimatedGas = gasLimit;
    if (!estimatedGas) {
      estimatedGas = await this.estimateGas({
        useApiCalldata,
        apiQuoteData,
        isComplexRouting,
        protocol,
        contractAddress,
        abi,
        functionName,
        args,
        account,
      });
    }

    let currentGasPrice = gasPrice
      ? BigInt(gasPrice)
      : await this.publicClient.getGasPrice();

    const gasParams = this.calculateGasParameters(
      currentGasPrice,
      apiQuoteData
    );

    return {
      estimatedGas,
      maxFeePerGas: gasParams.maxFeePerGas,
      maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
    };
  }

  private async estimateGas(params: {
    useApiCalldata?: boolean;
    apiQuoteData?: any;
    isComplexRouting?: boolean;
    protocol: string;
    contractAddress: string;
    abi:readonly any[];
    functionName: string;
    args: any[];
    account: any;
  }): Promise<number> {
    const {
      useApiCalldata,
      apiQuoteData,
      isComplexRouting,
      protocol,
      contractAddress,
      abi,
      functionName,
      args,
      account,
    } = params;

    try {
      if (useApiCalldata && apiQuoteData?.gasUseEstimate) {
        const apiGas = Number(apiQuoteData.gasUseEstimate) + 50000;
        return apiGas;
      }

      if (protocol === 'sailor') {
        if (isComplexRouting && apiQuoteData?.estimated_gas) {
          const apiGas = Number(apiQuoteData.estimated_gas) + 200000;
          return apiGas;
        }
        const v3Gas = isComplexRouting ? 400000 : 350000;
        return v3Gas;
      }

      const gas = Number(
        await this.publicClient.estimateContractGas({
          address: contractAddress as `0x${string}`,
          abi,
          functionName,
          args,
          account: account.address,
        })
      );
      return gas;
    } catch {
      const fallbackGas = protocol === 'sailor' ? 400000 : 300000;
      return fallbackGas;
    }
  }

  private calculateGasParameters(
    currentGasPrice: bigint,
    apiQuoteData?: any
  ): {
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  } {
    let maxPriorityFeePerGas = currentGasPrice / 10n;
    let maxFeePerGas = currentGasPrice * 2n;

    if (apiQuoteData) {
      const apiMaxPriorityFee = apiQuoteData.maxPriorityFeePerGas;
      const apiMaxFee = apiQuoteData.maxFeePerGas;
      
      if (apiMaxPriorityFee) {
        maxPriorityFeePerGas = BigInt(apiMaxPriorityFee);
      }
      
      if (apiMaxFee) {
        maxFeePerGas = BigInt(apiMaxFee);
      } else if (apiMaxPriorityFee) {
        maxFeePerGas = maxPriorityFeePerGas * 2n;
      }
    }

    return {
      maxFeePerGas,
      maxPriorityFeePerGas,
    };
  }
}