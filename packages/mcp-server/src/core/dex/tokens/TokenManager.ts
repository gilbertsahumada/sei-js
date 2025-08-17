import { type Address } from "viem";
import { DragonSwapTokens } from "./DragonSwapTokens.js";
import { SailorTokens } from "./SailorTokens.js";
import { OkuTradeTokens } from "./OkuTradeTokens.js";
import { YakaFinanceTokens } from "./YakaFinanceTokens.js";
import { type TokenInfo, type TokenList } from "./BaseTokenFetcher.js";

export type ProtocolName = "DragonSwap" | "Sailor" | "OkuTrade" | "YakaFinance";

export interface UnifiedTokenInfo extends TokenInfo {
  sources: ProtocolName[]; // Which protocols have this token
  bestPrice?: number; // Best price across all sources
  priceVariance?: number; // Price variance between sources
  riskScores?: { [protocol: string]: string }; // Risk scores from different protocols
}

export interface TokenComparison {
  address: Address;
  symbol: string;
  name: string;
  protocols: Array<{
    protocol: ProtocolName;
    price?: number;
    riskScore?: string;
    logoURI?: string;
  }>;
  priceSpread?: {
    min: number;
    max: number;
    variance: number;
  };
}

export interface CrossProtocolStats {
  totalUniqueTokens: number;
  commonTokens: number; // Tokens available in multiple protocols
  protocolStats: {
    [K in ProtocolName]: {
      totalTokens: number;
      uniqueTokens: number; // Only in this protocol
      withPrices: number;
      avgPrice: number;
    };
  };
}

/**
 * Token Manager - Unified interface for all token protocols
 * 
 * Features:
 * - Cross-protocol token aggregation
 * - Price comparison across DEXes
 * - Unified token search and discovery
 * - Cross-protocol analytics
 */
export class TokenManager {
  private fetchers: Map<ProtocolName, DragonSwapTokens | SailorTokens | OkuTradeTokens | YakaFinanceTokens>;
  private chainId: number;

  constructor(chainId: number = 1329) {
    this.chainId = chainId;
    this.fetchers = new Map();
    this.fetchers.set("DragonSwap", new DragonSwapTokens(chainId));
    this.fetchers.set("Sailor", new SailorTokens(chainId));
    this.fetchers.set("OkuTrade", new OkuTradeTokens(chainId));
    this.fetchers.set("YakaFinance", new YakaFinanceTokens(chainId));
  }

  /**
   * Get unified token list from all protocols
   */
  async getUnifiedTokenList(forceRefresh: boolean = false): Promise<UnifiedTokenInfo[]> {
    const allTokenLists = await Promise.allSettled([
      this.fetchers.get("DragonSwap")!.getTokens(forceRefresh),
      this.fetchers.get("OkuTrade")!.getTokens(forceRefresh),
      this.fetchers.get("YakaFinance")!.getTokens(forceRefresh)
    ]);

    const tokenMap = new Map<string, UnifiedTokenInfo>();

    // Process each protocol's tokens
    allTokenLists.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const protocolName = Array.from(this.fetchers.keys())[index];
        const tokenList = result.value;

        tokenList.tokens.forEach(token => {
          const key = token.address.toLowerCase();
          
          if (tokenMap.has(key)) {
            // Merge with existing token
            const existing = tokenMap.get(key)!;
            existing.sources.push(protocolName);
            
            // Update best price
            if (token.price && (!existing.bestPrice || token.price > existing.bestPrice)) {
              existing.bestPrice = token.price;
            }
            
            // Collect risk scores
            if (token.riskScore) {
              existing.riskScores = existing.riskScores || {};
              existing.riskScores[protocolName] = token.riskScore;
            }
            
            // Prefer logo from protocols that have it
            if (token.logoURI && !existing.logoURI) {
              existing.logoURI = token.logoURI;
            }
          } else {
            // Create new unified token
            const unified: UnifiedTokenInfo = {
              ...token,
              sources: [protocolName],
              bestPrice: token.price,
              riskScores: token.riskScore ? { [protocolName]: token.riskScore } : undefined
            };
            tokenMap.set(key, unified);
          }
        });
      }
    });

    // Calculate price variance for tokens with multiple prices
    const tokens = Array.from(tokenMap.values());
    for (const token of tokens) {
      if (token.sources.length > 1) {
        await this.calculatePriceVariance(token);
      }
    }

    return tokens.sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  /**
   * Find token across all protocols
   */
  async findTokenEverywhere(address: Address): Promise<TokenComparison | null> {
    const results = await Promise.allSettled([
      this.fetchers.get("DragonSwap")!.findTokenByAddress(address),
      this.fetchers.get("OkuTrade")!.findTokenByAddress(address),
      this.fetchers.get("YakaFinance")!.findTokenByAddress(address)
    ]);

    const protocols: TokenComparison['protocols'] = [];
    let tokenSymbol = '';
    let tokenName = '';

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        const protocolName = Array.from(this.fetchers.keys())[index];
        const token = result.value;
        
        if (!tokenSymbol) {
          tokenSymbol = token.symbol;
          tokenName = token.name;
        }

        protocols.push({
          protocol: protocolName,
          price: token.price,
          riskScore: token.riskScore,
          logoURI: token.logoURI
        });
      }
    });

    if (protocols.length === 0) return null;

    // Calculate price spread
    const prices = protocols.map(p => p.price).filter(p => p !== undefined) as number[];
    let priceSpread: TokenComparison['priceSpread'];
    
    if (prices.length > 1) {
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      priceSpread = {
        min,
        max,
        variance: ((max - min) / min) * 100
      };
    }

    return {
      address,
      symbol: tokenSymbol,
      name: tokenName,
      protocols,
      priceSpread
    };
  }

  /**
   * Search tokens across all protocols
   */
  async searchTokensAcrossProtocols(query: string): Promise<UnifiedTokenInfo[]> {
    const unified = await this.getUnifiedTokenList();
    const lowerQuery = query.toLowerCase();

    return unified.filter(token =>
      token.name.toLowerCase().includes(lowerQuery) ||
      token.symbol.toLowerCase().includes(lowerQuery) ||
      token.address.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get tokens available in multiple protocols
   */
  async getCommonTokens(): Promise<UnifiedTokenInfo[]> {
    const unified = await this.getUnifiedTokenList();
    return unified.filter(token => token.sources.length > 1);
  }

  /**
   * Get best prices for tokens
   */
  async getBestPrices(limit: number = 50): Promise<UnifiedTokenInfo[]> {
    const unified = await this.getUnifiedTokenList();
    return unified
      .filter(token => token.bestPrice !== undefined)
      .sort((a, b) => (b.bestPrice || 0) - (a.bestPrice || 0))
      .slice(0, limit);
  }

  /**
   * Get arbitrage opportunities (price differences between protocols)
   */
  async getArbitrageOpportunities(minSpread: number = 5): Promise<TokenComparison[]> {
    const unified = await this.getUnifiedTokenList();
    const opportunities: TokenComparison[] = [];

    for (const token of unified) {
      if (token.sources.length > 1) {
        const comparison = await this.findTokenEverywhere(token.address);
        if (comparison?.priceSpread && comparison.priceSpread.variance >= minSpread) {
          opportunities.push(comparison);
        }
      }
    }

    return opportunities.sort((a, b) => (b.priceSpread?.variance || 0) - (a.priceSpread?.variance || 0));
  }

  /**
   * Get cross-protocol statistics
   */
  async getCrossProtocolStats(): Promise<CrossProtocolStats> {
    const unified = await this.getUnifiedTokenList();
    const protocolStats: CrossProtocolStats['protocolStats'] = {
      DragonSwap: { totalTokens: 0, uniqueTokens: 0, withPrices: 0, avgPrice: 0 },
      Sailor: { totalTokens: 0, uniqueTokens: 0, withPrices: 0, avgPrice: 0 },
      OkuTrade: { totalTokens: 0, uniqueTokens: 0, withPrices: 0, avgPrice: 0 },
      YakaFinance: { totalTokens: 0, uniqueTokens: 0, withPrices: 0, avgPrice: 0 }
    };

    // Calculate stats for each protocol
    for (const [protocolName, fetcher] of this.fetchers) {
      const tokenList = await fetcher.getTokens();
      const tokensWithPrices = tokenList.tokens.filter(t => t.price !== undefined);
      const totalPrice = tokensWithPrices.reduce((sum, t) => sum + (t.price || 0), 0);

      protocolStats[protocolName] = {
        totalTokens: tokenList.tokens.length,
        uniqueTokens: 0, // Will calculate below
        withPrices: tokensWithPrices.length,
        avgPrice: tokensWithPrices.length > 0 ? totalPrice / tokensWithPrices.length : 0
      };
    }

    // Calculate unique tokens (only in one protocol)
    for (const token of unified) {
      if (token.sources.length === 1) {
        const protocol = token.sources[0];
        protocolStats[protocol].uniqueTokens++;
      }
    }

    return {
      totalUniqueTokens: unified.length,
      commonTokens: unified.filter(t => t.sources.length > 1).length,
      protocolStats
    };
  }

  /**
   * Get protocol-specific token fetcher
   */
  getProtocolFetcher(protocol: ProtocolName): DragonSwapTokens | SailorTokens | OkuTradeTokens | YakaFinanceTokens | undefined {
    return this.fetchers.get(protocol);
  }

  /**
   * Get cache status for all protocols
   */
  getAllCacheStatus(): { [K in ProtocolName]: ReturnType<DragonSwapTokens['getCacheInfo']> } {
    return {
      DragonSwap: this.fetchers.get("DragonSwap")!.getCacheInfo(),
      Sailor: this.fetchers.get("Sailor")!.getCacheInfo(),
      OkuTrade: this.fetchers.get("OkuTrade")!.getCacheInfo(),
      YakaFinance: this.fetchers.get("YakaFinance")!.getCacheInfo()
    };
  }

  /**
   * Clear all caches
   */
  clearAllCaches(): void {
    this.fetchers.forEach(fetcher => fetcher.clearCache());
  }

  /**
   * Refresh all token lists
   */
  async refreshAllTokens(): Promise<void> {
    await Promise.all([
      this.fetchers.get("DragonSwap")!.getTokens(true),
      this.fetchers.get("OkuTrade")!.getTokens(true),
      this.fetchers.get("YakaFinance")!.getTokens(true)
    ]);
  }

  // Private helper methods

  private async calculatePriceVariance(token: UnifiedTokenInfo): Promise<void> {
    const prices: number[] = [];
    
    for (const source of token.sources) {
      const fetcher = this.fetchers.get(source);
      if (fetcher) {
        const sourceToken = await fetcher.findTokenByAddress(token.address);
        if (sourceToken?.price) {
          prices.push(sourceToken.price);
        }
      }
    }

    if (prices.length > 1) {
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      token.priceVariance = ((max - min) / min) * 100;
    }
  }

  /**
   * Get health status of all protocol APIs
   */
  async getProtocolHealthStatus(): Promise<{
    [K in ProtocolName]: {
      status: 'healthy' | 'unhealthy' | 'unknown';
      lastCheck: number;
      error?: string;
    };
  }> {
    const results = await Promise.allSettled([
      this.checkProtocolHealth("DragonSwap"),
      this.checkProtocolHealth("Sailor"),
      this.checkProtocolHealth("OkuTrade"),
      this.checkProtocolHealth("YakaFinance")
    ]);

    return {
      DragonSwap: results[0].status === 'fulfilled' ? results[0].value : { status: 'unhealthy', lastCheck: Date.now(), error: 'Check failed' },
      Sailor: results[1].status === 'fulfilled' ? results[1].value : { status: 'unhealthy', lastCheck: Date.now(), error: 'Check failed' },
      OkuTrade: results[2].status === 'fulfilled' ? results[2].value : { status: 'unhealthy', lastCheck: Date.now(), error: 'Check failed' },
      YakaFinance: results[3].status === 'fulfilled' ? results[3].value : { status: 'unhealthy', lastCheck: Date.now(), error: 'Check failed' }
    };
  }

  private async checkProtocolHealth(protocol: ProtocolName): Promise<{
    status: 'healthy' | 'unhealthy';
    lastCheck: number;
    error?: string;
  }> {
    try {
      const fetcher = this.fetchers.get(protocol);
      if (!fetcher) {
        return { status: 'unhealthy', lastCheck: Date.now(), error: 'Fetcher not found' };
      }

      // Try to get a small token list to check if the protocol is working
      await fetcher.getTokens();
      return { status: 'healthy', lastCheck: Date.now() };

    } catch (error) {
      return { 
        status: 'unhealthy', 
        lastCheck: Date.now(), 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }
}