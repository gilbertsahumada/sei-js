import { type Address } from "viem";

export interface DragonSwapToken {
  address: string;
  name: string;
  symbol: string;
  usd_price: number;
  decimals: number;
  liquidity: number;
  description: string | null;
  change: {
    hourly: number;
    daily: number;
    weekly: number;
    monthly: number;
  };
}

/**
 * DragonSwap API Price Fetcher - SIMPLE VERSION
 * 
 * Uses DragonSwap's /tokens endpoint directly - all tokens with prices in one call!
 */
export class DragonSwapApiPriceFetcher {
  private static readonly API_BASE = "https://sei-api.dragonswap.app/api/v1";
  private tokensCache: DragonSwapToken[] | null = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_DURATION = 60000; // 1 minute
  
  constructor() {}

  /**
   * Get ALL tokens with prices (cached for 1 minute)
   */
  async getAllTokens(): Promise<DragonSwapToken[]> {
    const now = Date.now();
    
    // Return cached data if still fresh
    if (this.tokensCache && (now - this.cacheTimestamp) < this.CACHE_DURATION) {
      return this.tokensCache;
    }
    
    try {
      console.log("Fetching all DragonSwap tokens...");
      const url = `${DragonSwapApiPriceFetcher.API_BASE}/tokens`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      
      const data: any = await response.json();
      this.tokensCache = data.tokens || [];
      this.cacheTimestamp = now;
      
      console.log(`✅ Fetched ${this.tokensCache?.length || 0} DragonSwap tokens`);
      return this.tokensCache || [];
      
    } catch (error) {
      console.error("Error fetching DragonSwap tokens:", error);
      return this.tokensCache || []; // Return cache if available, empty array otherwise
    }
  }

  /**
   * Get specific token by address
   */
  async getTokenByAddress(tokenAddress: Address): Promise<DragonSwapToken | null> {
    const tokens = await this.getAllTokens();
    return tokens.find(t => t.address.toLowerCase() === tokenAddress.toLowerCase()) || null;
  }

  /**
   * Get tokens sorted by liquidity
   */
  async getTokensByLiquidity(limit: number = 20): Promise<DragonSwapToken[]> {
    const tokens = await this.getAllTokens();
    return tokens
      .filter(t => t.liquidity > 0)
      .sort((a, b) => b.liquidity - a.liquidity)
      .slice(0, limit);
  }

  /**
   * Get tokens sorted by price
   */
  async getTokensByPrice(limit: number = 20, minPrice: number = 0): Promise<DragonSwapToken[]> {
    const tokens = await this.getAllTokens();
    return tokens
      .filter(t => t.usd_price >= minPrice)
      .sort((a, b) => b.usd_price - a.usd_price)
      .slice(0, limit);
  }

  /**
   * Get tokens sorted by daily change
   */
  async getTokensByDailyChange(limit: number = 20): Promise<DragonSwapToken[]> {
    const tokens = await this.getAllTokens();
    return tokens
      .filter(t => t.change.daily !== 0)
      .sort((a, b) => b.change.daily - a.change.daily)
      .slice(0, limit);
  }

  /**
   * Search tokens by symbol or name
   */
  async searchTokens(query: string): Promise<DragonSwapToken[]> {
    const tokens = await this.getAllTokens();
    const lowerQuery = query.toLowerCase();
    
    return tokens.filter(t => 
      t.symbol.toLowerCase().includes(lowerQuery) ||
      t.name.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get market statistics
   */
  async getMarketStats(): Promise<{
    totalTokens: number;
    totalLiquidity: number;
    avgPrice: number;
    priceRange: { min: number; max: number };
    topGainers: DragonSwapToken[];
    topLosers: DragonSwapToken[];
  }> {
    const tokens = await this.getAllTokens();
    const prices = tokens.map(t => t.usd_price).filter(p => p > 0);
    const totalLiquidity = tokens.reduce((sum, t) => sum + t.liquidity, 0);
    
    const topGainers = tokens
      .filter(t => t.change.daily > 0)
      .sort((a, b) => b.change.daily - a.change.daily)
      .slice(0, 5);
      
    const topLosers = tokens
      .filter(t => t.change.daily < 0)
      .sort((a, b) => a.change.daily - b.change.daily)
      .slice(0, 5);
    
    return {
      totalTokens: tokens.length,
      totalLiquidity,
      avgPrice: prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
      priceRange: {
        min: prices.length > 0 ? Math.min(...prices) : 0,
        max: prices.length > 0 ? Math.max(...prices) : 0
      },
      topGainers,
      topLosers
    };
  }

  /**
   * Force refresh cache
   */
  refreshCache(): void {
    this.tokensCache = null;
    this.cacheTimestamp = 0;
  }
}