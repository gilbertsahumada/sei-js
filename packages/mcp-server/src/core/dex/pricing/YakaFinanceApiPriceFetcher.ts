import { type Address } from "viem";

export interface YakaFinanceToken {
  name: string;
  symbol: string;
  price: number;
  decimals: number;
  chainId: number;
  address: string;
  logoURI: string;
  riskScore: string;
}

export interface YakaFinanceApiResponse {
  success: boolean;
  data: YakaFinanceToken[];
}

/**
 * Yaka Finance API Price Fetcher - SIMPLE VERSION
 * 
 * Uses Yaka Finance's /api/v1/assets endpoint directly
 */
export class YakaFinanceApiPriceFetcher {
  private static readonly API_BASE = "https://backend.yaka.finance/api/v1";
  private tokensCache: YakaFinanceToken[] | null = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_DURATION = 60000; // 1 minute
  
  constructor() {}

  /**
   * Get ALL tokens with prices (cached for 1 minute)
   */
  async getAllTokens(): Promise<YakaFinanceToken[]> {
    const now = Date.now();
    
    // Return cached data if still fresh
    if (this.tokensCache && (now - this.cacheTimestamp) < this.CACHE_DURATION) {
      return this.tokensCache;
    }
    
    try {
      console.log("Fetching all Yaka Finance tokens...");
      const url = `${YakaFinanceApiPriceFetcher.API_BASE}/assets`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      
      const data: YakaFinanceApiResponse = await response.json() as YakaFinanceApiResponse;
      
      if (!data.success || !data.data) {
        throw new Error("API returned unsuccessful response");
      }
      
      this.tokensCache = data.data;
      this.cacheTimestamp = now;
      
      console.log(`✅ Fetched ${this.tokensCache.length} Yaka Finance tokens`);
      return this.tokensCache;
      
    } catch (error) {
      console.error("Error fetching Yaka Finance tokens:", error);
      return this.tokensCache || []; // Return cache if available, empty array otherwise
    }
  }

  /**
   * Get specific token by address
   */
  async getTokenByAddress(tokenAddress: Address): Promise<YakaFinanceToken | null> {
    const tokens = await this.getAllTokens();
    return tokens.find(t => t.address.toLowerCase() === tokenAddress.toLowerCase()) || null;
  }

  /**
   * Get tokens sorted by price (highest first)
   */
  async getTokensByPrice(limit: number = 20, minPrice: number = 0): Promise<YakaFinanceToken[]> {
    const tokens = await this.getAllTokens();
    return tokens
      .filter(t => t.price >= minPrice)
      .sort((a, b) => b.price - a.price)
      .slice(0, limit);
  }

  /**
   * Get tokens sorted by risk score (lowest risk first)
   */
  async getTokensByRiskScore(limit: number = 20): Promise<YakaFinanceToken[]> {
    const tokens = await this.getAllTokens();
    return tokens
      .sort((a, b) => parseFloat(a.riskScore) - parseFloat(b.riskScore))
      .slice(0, limit);
  }

  /**
   * Get tokens with logos (verified tokens)
   */
  async getVerifiedTokens(limit: number = 20): Promise<YakaFinanceToken[]> {
    const tokens = await this.getAllTokens();
    return tokens
      .filter(t => t.logoURI && t.logoURI.trim() !== "")
      .sort((a, b) => b.price - a.price)
      .slice(0, limit);
  }

  /**
   * Search tokens by symbol or name
   */
  async searchTokens(query: string): Promise<YakaFinanceToken[]> {
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
    avgPrice: number;
    priceRange: { min: number; max: number };
    verifiedTokens: number;
    avgRiskScore: number;
    topTokens: YakaFinanceToken[];
    safestTokens: YakaFinanceToken[];
  }> {
    const tokens = await this.getAllTokens();
    const prices = tokens.map(t => t.price).filter(p => p > 0);
    const riskScores = tokens.map(t => parseFloat(t.riskScore)).filter(r => !isNaN(r));
    
    const verifiedTokens = tokens.filter(t => t.logoURI && t.logoURI.trim() !== "");
    const topTokens = tokens
      .sort((a, b) => b.price - a.price)
      .slice(0, 5);
      
    const safestTokens = tokens
      .sort((a, b) => parseFloat(a.riskScore) - parseFloat(b.riskScore))
      .slice(0, 5);
    
    return {
      totalTokens: tokens.length,
      avgPrice: prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
      priceRange: {
        min: prices.length > 0 ? Math.min(...prices) : 0,
        max: prices.length > 0 ? Math.max(...prices) : 0
      },
      verifiedTokens: verifiedTokens.length,
      avgRiskScore: riskScores.length > 0 ? riskScores.reduce((a, b) => a + b, 0) / riskScores.length : 0,
      topTokens,
      safestTokens
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