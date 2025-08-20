import { type Address } from "viem";

export interface SailorPriceToken {
  symbol: string;
  price: string;
  dailychange: string;
  id: string; // token address
}

export interface SailorTokenListItem {
  id: string; // token address
  name: string;
  symbol: string;
  url: string; // logo URL
  decimals: string;
  verified: boolean;
}

/**
 * Sailor Finance API Price Fetcher
 * 
 * Uses Sailor Finance's complete token list and price APIs
 * Token List: https://asia-southeast1-ktx-finance-2.cloudfunctions.net/sailor_poolapi/getTokenListV2
 * Prices: https://asia-southeast1-ktx-finance-2.cloudfunctions.net/sailor_poolapi/getPriceList
 */
export class SailorApiPriceFetcher {
  private static readonly API_BASE = "https://asia-southeast1-ktx-finance-2.cloudfunctions.net/sailor_poolapi";
  private tokensCache: SailorPriceToken[] | null = null;
  private tokenListCache: SailorTokenListItem[] | null = null;
  private cacheTimestamp: number = 0;
  private tokenListCacheTimestamp: number = 0;
  private readonly CACHE_DURATION = 60000; // 1 minute
  private readonly TOKEN_LIST_CACHE_DURATION = 300000; // 5 minutes (token list changes less frequently)
  
  constructor() {}

  /**
   * Get complete token list from Sailor Finance API
   */
  async getTokenList(): Promise<SailorTokenListItem[]> {
    const now = Date.now();
    
    // Return cached data if still fresh
    if (this.tokenListCache && (now - this.tokenListCacheTimestamp) < this.TOKEN_LIST_CACHE_DURATION) {
      return this.tokenListCache;
    }
    
    try {
      console.log("Fetching complete token list from Sailor Finance...");
      
      const url = `${SailorApiPriceFetcher.API_BASE}/getTokenListV2`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'SEI-MCP-Server/1.0.0'
        }
      });

      if (!response.ok) {
        throw new Error(`Sailor Token List API returned ${response.status}: ${response.statusText}`);
      }

      const tokens: SailorTokenListItem[] = await response.json() as SailorTokenListItem[];
      
      if (!Array.isArray(tokens)) {
        throw new Error("Invalid response format from Sailor Token List API");
      }

      console.log(`✅ Fetched ${tokens.length} tokens from Sailor token list`);
      
      this.tokenListCache = tokens;
      this.tokenListCacheTimestamp = now;
      
      return tokens;
      
    } catch (error) {
      console.error("Error fetching Sailor token list:", error);
      
      // Return cached data if available, otherwise empty array
      return this.tokenListCache || [];
    }
  }

  /**
   * Get prices for specific token addresses
   */
  async getTokenPrices(tokenAddresses: string[]): Promise<SailorPriceToken[]> {
    try {
      console.log(`Fetching Sailor prices for ${tokenAddresses.length} tokens...`);
      
      const tokensParam = tokenAddresses.join(",");
      const url = `${SailorApiPriceFetcher.API_BASE}/getPriceList?tokens=${tokensParam}`;

      console.log(`Requesting Sailor prices from: ${url}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'SEI-MCP-Server/1.0.0'
        }
      });

      if (!response.ok) {
        throw new Error(`Sailor API returned ${response.status}: ${response.statusText}`);
      }

      const data: SailorPriceToken[] = await response.json() as SailorPriceToken[];
      
      console.log(`✅ Fetched ${data.length} token prices from Sailor`);
      return data;
      
    } catch (error) {
      console.error("Error fetching Sailor token prices:", error);
      return [];
    }
  }

  /**
   * Get ALL tokens with prices (using complete token list from API)
   */
  async getAllTokens(): Promise<SailorPriceToken[]> {
    const now = Date.now();
    
    if (this.tokensCache && (now - this.cacheTimestamp) < this.CACHE_DURATION) {
      return this.tokensCache;
    }
    
    try {
      const tokenList = await this.getTokenList();
      
      if (tokenList.length === 0) {
        console.warn("No tokens found in Sailor token list, using fallback");
        return this.tokensCache || [];
      }
      
      const tokenAddresses = tokenList.map(token => token.id);
      
      const prices = await this.getTokenPrices(tokenAddresses);
      
      this.tokensCache = prices;
      this.cacheTimestamp = now;
      
      return prices;
      
    } catch (error) {
      console.error("Error fetching all Sailor tokens:", error);
      return this.tokensCache || [];
    }
  }

  /**
   * Get specific token by address
   */
  async getTokenByAddress(tokenAddress: Address): Promise<SailorPriceToken | null> {
    const prices = await this.getTokenPrices([tokenAddress]);
    return prices.find(t => t.id.toLowerCase() === tokenAddress.toLowerCase()) || null;
  }

  /**
   * Get specific token by symbol
   */
  async getTokenBySymbol(symbol: string): Promise<SailorPriceToken | null> {
    const tokens = await this.getAllTokens();
    return tokens.find(t => t.symbol.toLowerCase() === symbol.toLowerCase()) || null;
  }

  /**
   * Search tokens by symbol
   */
  async searchTokens(query: string): Promise<SailorPriceToken[]> {
    const tokens = await this.getAllTokens();
    const lowerQuery = query.toLowerCase();
    
    return tokens.filter(t => 
      t.symbol.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get tokens sorted by price
   */
  async getTokensByPrice(limit: number = 20, minPrice: number = 0): Promise<SailorPriceToken[]> {
    const tokens = await this.getAllTokens();
    return tokens
      .filter(t => parseFloat(t.price) >= minPrice)
      .sort((a, b) => parseFloat(b.price) - parseFloat(a.price))
      .slice(0, limit);
  }

  /**
   * Get tokens sorted by daily change (gainers/losers)
   */
  async getTokensByDailyChange(limit: number = 20, gainersFirst: boolean = true): Promise<SailorPriceToken[]> {
    const tokens = await this.getAllTokens();
    
    const sorted = tokens.sort((a, b) => {
      const changeA = parseFloat(a.dailychange);
      const changeB = parseFloat(b.dailychange);
      return gainersFirst ? changeB - changeA : changeA - changeB;
    });
    
    return sorted.slice(0, limit);
  }

  /**
   * Get market statistics
   */
  async getMarketStats(): Promise<{
    totalTokens: number;
    avgPrice: number;
    priceRange: { min: number; max: number };
    avgDailyChange: number;
    topGainers: SailorPriceToken[];
    topLosers: SailorPriceToken[];
  }> {
    const tokens = await this.getAllTokens();
    const prices = tokens.map(t => parseFloat(t.price)).filter(p => p > 0);
    const changes = tokens.map(t => parseFloat(t.dailychange));
    
    const topGainers = tokens
      .filter(t => parseFloat(t.dailychange) > 0)
      .sort((a, b) => parseFloat(b.dailychange) - parseFloat(a.dailychange))
      .slice(0, 3);
      
    const topLosers = tokens
      .filter(t => parseFloat(t.dailychange) < 0)
      .sort((a, b) => parseFloat(a.dailychange) - parseFloat(b.dailychange))
      .slice(0, 3);
    
    return {
      totalTokens: tokens.length,
      avgPrice: prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
      priceRange: {
        min: prices.length > 0 ? Math.min(...prices) : 0,
        max: prices.length > 0 ? Math.max(...prices) : 0
      },
      avgDailyChange: changes.length > 0 ? changes.reduce((a, b) => a + b, 0) / changes.length : 0,
      topGainers,
      topLosers
    };
  }

  /**
   * Force refresh price cache
   */
  refreshCache(): void {
    this.tokensCache = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Force refresh token list cache
   */
  refreshTokenListCache(): void {
    this.tokenListCache = null;
    this.tokenListCacheTimestamp = 0;
  }

  /**
   * Force refresh all caches
   */
  refreshAllCaches(): void {
    this.refreshCache();
    this.refreshTokenListCache();
  }
}