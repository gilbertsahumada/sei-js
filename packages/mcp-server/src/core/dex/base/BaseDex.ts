import { type Address, type Hex } from "viem";

export interface SwapParams {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  slippage: number; // percentage (e.g., 0.5 for 0.5%)
  recipient?: Address;
  deadline?: number;
}

export interface SwapQuote {
  amountOut: string;
  priceImpact: number;
  gasEstimate: bigint;
  route: Address[];
  dexName: string;
}

export interface LiquidityPool {
  address: Address;
  token0: Address;
  token1: Address;
  reserve0: string;
  reserve1: string;
  fee: number;
}

export abstract class BaseDex {
  protected name: string;
  protected routerAddress: Address;
  protected factoryAddress: Address;
  protected network: string;

  constructor(
    name: string,
    routerAddress: Address,
    factoryAddress: Address,
    network: string
  ) {
    this.name = name;
    this.routerAddress = routerAddress;
    this.factoryAddress = factoryAddress;
    this.network = network;
  }

  // Abstract methods that each DEX must implement
  abstract getQuote(params: SwapParams): Promise<SwapQuote>;
  abstract executeSwap(params: SwapParams): Promise<Hex>;
  abstract getPool(tokenA: Address, tokenB: Address): Promise<LiquidityPool | null>;
  abstract getAllPools(): Promise<LiquidityPool[]>;
  abstract getTokenPrice(tokenAddress: Address): Promise<string>;


  getName(): string {
    return this.name;
  }

  getRouterAddress(): Address {
    return this.routerAddress;
  }

  getFactoryAddress(): Address {
    return this.factoryAddress;
  }

  getNetwork(): string {
    return this.network;
  }

  // Calculate price impact
  protected calculatePriceImpact(
    amountIn: string,
    amountOut: string,
    reserves: { reserve0: string; reserve1: string }
  ): number {
    // Basic price impact calculation
    // This is a simplified version - each DEX might have its own formula
    const amountInBig = BigInt(amountIn);
    const reserveInBig = BigInt(reserves.reserve0);
    
    if (reserveInBig === 0n) return 0;
    
    const impact = Number(amountInBig * 10000n / reserveInBig) / 100;
    return Math.min(impact, 100); // Cap at 100%
  }

  protected validateSwapParams(params: SwapParams): void {
    if (!params.tokenIn || !params.tokenOut) {
      throw new Error("Token addresses are required");
    }
    if (params.tokenIn === params.tokenOut) {
      throw new Error("Cannot swap same token");
    }
    if (!params.amountIn || params.amountIn === "0") {
      throw new Error("Amount must be greater than 0");
    }
    if (params.slippage < 0 || params.slippage > 50) {
      throw new Error("Slippage must be between 0 and 50%");
    }
  }
}