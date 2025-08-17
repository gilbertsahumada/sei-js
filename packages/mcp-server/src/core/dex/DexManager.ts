import { type Address, type Hex } from "viem";
import { DragonSwap } from "./DragonSwap.js";
import { SailorDex } from "./SailorDex.js";
import { YakaDex } from "./YakaDex.js";
import { OkuDex } from "./OkuDex.js";
import { type SwapParams, type SwapQuote } from "./base/BaseDex.js";

export type DexName = "DragonSwap" | "Sailor" | "Yaka" | "Oku";

export interface DexComparison {
  dexName: DexName;
  quote: SwapQuote;
  savings?: string; // Compared to others
  recommended?: boolean;
}

export interface ArbitrageOpportunity {
  tokenA: Address;
  tokenB: Address;
  buyDex: DexName;
  sellDex: DexName;
  profitPercentage: number;
  profitAmount: string;
  requiredAmount: string;
}

/**
 * DEX Manager - Orchestrates multiple DEXes for optimal trading
 * 
 * Features:
 * - Multi-DEX quote comparison
 * - Best execution routing
 * - Arbitrage opportunity detection
 * - Cross-DEX analytics
 */
export class DexManager {
  private dexes: Map<DexName, DragonSwap | SailorDex | YakaDex | OkuDex>;
  private network: string;

  constructor(network: string = "sei") {
    this.network = network;
    this.dexes = new Map();
    this.dexes.set("DragonSwap", new DragonSwap(network));
    this.dexes.set("Sailor", new SailorDex(network));
    this.dexes.set("Yaka", new YakaDex(network));
    this.dexes.set("Oku", new OkuDex(network));
  }

  /**
   * Get quotes from all DEXes and compare
   */
  async compareQuotes(params: SwapParams): Promise<DexComparison[]> {
    const quotes = await Promise.allSettled([
      this.getDexQuote("DragonSwap", params),
      this.getDexQuote("Sailor", params),
      this.getDexQuote("Yaka", params),
      this.getDexQuote("Oku", params)
    ]);

    const validQuotes: DexComparison[] = [];
    
    quotes.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value) {
        const dexName = Array.from(this.dexes.keys())[index];
        validQuotes.push({
          dexName,
          quote: result.value
        });
      }
    });

    // Sort by best amount out
    validQuotes.sort((a, b) => 
      BigInt(b.quote.amountOut) > BigInt(a.quote.amountOut) ? 1 : -1
    );

    // Calculate savings and mark recommended
    if (validQuotes.length > 1) {
      const bestQuote = validQuotes[0];
      bestQuote.recommended = true;

      validQuotes.forEach((comparison, index) => {
        if (index > 0) {
          const savings = BigInt(bestQuote.quote.amountOut) - BigInt(comparison.quote.amountOut);
          const savingsPercentage = Number(savings * 100n / BigInt(comparison.quote.amountOut));
          comparison.savings = `${savingsPercentage.toFixed(2)}%`;
        }
      });
    }

    return validQuotes;
  }

  /**
   * Execute swap on the best DEX
   */
  async executeBestSwap(params: SwapParams): Promise<{
    txHash: Hex;
    dexUsed: DexName;
    amountOut: string;
    savings?: string;
  }> {
    const comparisons = await this.compareQuotes(params);
    
    if (comparisons.length === 0) {
      throw new Error("No valid quotes found from any DEX");
    }

    const bestDex = comparisons[0];
    const dex = this.dexes.get(bestDex.dexName)!;
    
    const txHash = await dex.executeSwap(params);
    
    return {
      txHash,
      dexUsed: bestDex.dexName,
      amountOut: bestDex.quote.amountOut,
      savings: bestDex.savings
    };
  }

  /**
   * Find arbitrage opportunities between DEXes
   */
  async findArbitrageOpportunities(
    tokens: Address[],
    minProfitPercentage: number = 1.0
  ): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];

    // Check all token pairs across all DEX combinations
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const tokenA = tokens[i];
        const tokenB = tokens[j];

        try {
          const arbitrageOp = await this.checkArbitragePair(tokenA, tokenB, minProfitPercentage);
          if (arbitrageOp) {
            opportunities.push(arbitrageOp);
          }
        } catch (error) {
          console.warn(`Error checking arbitrage for ${tokenA}-${tokenB}: ${error}`);
        }
      }
    }

    return opportunities.sort((a, b) => b.profitPercentage - a.profitPercentage);
  }

  /**
   * Get aggregated liquidity across all DEXes
   */
  async getAggregatedLiquidity(tokenA: Address, tokenB: Address): Promise<{
    totalLiquidity: string;
    dexBreakdown: Array<{
      dexName: DexName;
      liquidity: string;
      percentage: number;
    }>;
  }> {
    const pools = await Promise.allSettled([
      this.dexes.get("DragonSwap")!.getPool(tokenA, tokenB),
      this.dexes.get("Sailor")!.getPool(tokenA, tokenB),
      this.dexes.get("Oku")!.getPool(tokenA, tokenB)
    ]);

    let totalLiquidity = 0n;
    const dexBreakdown: Array<{ dexName: DexName; liquidity: string; percentage: number }> = [];

    pools.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value) {
        const pool = result.value;
        const liquidity = BigInt(pool.reserve0) + BigInt(pool.reserve1);
        totalLiquidity += liquidity;
        
        const dexName = Array.from(this.dexes.keys())[index];
        dexBreakdown.push({
          dexName,
          liquidity: liquidity.toString(),
          percentage: 0 // Will calculate after total is known
        });
      }
    });

    // Calculate percentages
    dexBreakdown.forEach(item => {
      if (totalLiquidity > 0n) {
        item.percentage = Number(BigInt(item.liquidity) * 100n / totalLiquidity);
      }
    });

    return {
      totalLiquidity: totalLiquidity.toString(),
      dexBreakdown
    };
  }

  /**
   * Get comprehensive market data across all DEXes
   */
  async getMarketOverview(): Promise<{
    totalTvl: string;
    totalVolume24h: string;
    dexStats: Array<{
      dexName: DexName;
      tvl: string;
      volume24h: string;
      poolCount: number;
    }>;
  }> {
    // TODO: Implement comprehensive market data aggregation
    return {
      totalTvl: "0",
      totalVolume24h: "0",
      dexStats: []
    };
  }

  // Private helper methods

  private async getDexQuote(dexName: DexName, params: SwapParams): Promise<SwapQuote | null> {
    try {
      const dex = this.dexes.get(dexName);
      if (!dex) return null;
      
      return await dex.getQuote(params);
    } catch (error) {
      console.warn(`${dexName} quote failed: ${error}`);
      return null;
    }
  }

  private async checkArbitragePair(
    tokenA: Address,
    tokenB: Address,
    minProfitPercentage: number
  ): Promise<ArbitrageOpportunity | null> {
    const testAmount = "1000000000000000000"; // 1 token for testing

    // Get quotes for A->B on all DEXes
    const quotesAtoB = await Promise.allSettled([
      this.getDexQuote("DragonSwap", { tokenIn: tokenA, tokenOut: tokenB, amountIn: testAmount, slippage: 0.5 }),
      this.getDexQuote("Sailor", { tokenIn: tokenA, tokenOut: tokenB, amountIn: testAmount, slippage: 0.5 }),
      this.getDexQuote("Yaka", { tokenIn: tokenA, tokenOut: tokenB, amountIn: testAmount, slippage: 0.5 }),
      this.getDexQuote("Oku", { tokenIn: tokenA, tokenOut: tokenB, amountIn: testAmount, slippage: 0.5 })
    ]);

    // Get quotes for B->A on all DEXes
    const quotesBtoA = await Promise.allSettled([
      this.getDexQuote("DragonSwap", { tokenIn: tokenB, tokenOut: tokenA, amountIn: testAmount, slippage: 0.5 }),
      this.getDexQuote("Sailor", { tokenIn: tokenB, tokenOut: tokenA, amountIn: testAmount, slippage: 0.5 }),
      this.getDexQuote("Yaka", { tokenIn: tokenB, tokenOut: tokenA, amountIn: testAmount, slippage: 0.5 }),
      this.getDexQuote("Oku", { tokenIn: tokenB, tokenOut: tokenA, amountIn: testAmount, slippage: 0.5 })
    ]);

    // Find best arbitrage opportunity
    const dexNames: DexName[] = ["DragonSwap", "Sailor", "Oku"];
    let bestOpportunity: ArbitrageOpportunity | null = null;
    let maxProfit = 0;

    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (i === j) continue;

        const quoteAtoB = quotesAtoB[i];
        const quoteBtoA = quotesBtoA[j];

        if (quoteAtoB.status === "fulfilled" && quoteBtoA.status === "fulfilled" &&
            quoteAtoB.value && quoteBtoA.value) {
          
          // Calculate potential profit
          const amountABack = BigInt(quoteBtoA.value.amountOut);
          const originalA = BigInt(testAmount);

          if (amountABack > originalA) {
            const profit = amountABack - originalA;
            const profitPercentage = Number(profit * 100n / originalA) / 100;

            if (profitPercentage >= minProfitPercentage && profitPercentage > maxProfit) {
              maxProfit = profitPercentage;
              bestOpportunity = {
                tokenA,
                tokenB,
                buyDex: dexNames[i],
                sellDex: dexNames[j],
                profitPercentage,
                profitAmount: profit.toString(),
                requiredAmount: testAmount
              };
            }
          }
        }
      }
    }

    return bestOpportunity;
  }

  /**
   * Get a specific DEX instance
   */
  getDex(dexName: DexName): DragonSwap | SailorDex | YakaDex | OkuDex | undefined {
    return this.dexes.get(dexName);
  }

  /**
   * Get all available DEX names
   */
  getAvailableDexes(): DexName[] {
    return Array.from(this.dexes.keys());
  }
}