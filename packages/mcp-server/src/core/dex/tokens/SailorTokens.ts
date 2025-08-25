import { BaseTokenFetcher, type TokenInfo, type TokenList } from "./BaseTokenFetcher.js";
import { SailorApiPriceFetcher, type SailorTokenListItem } from "../pricing/SailorApiPriceFetcher.js";

// Sailor Finance price response interface (for backward compatibility)
interface SailorPriceResponse {
  [tokenAddress: string]: {
    price: number;
    volume24h?: number;
    liquidity?: number;
  };
}

/**
 * Sailor Finance Token Fetcher
 * 
 * Fetches token data from Sailor Finance API endpoints
 * Reuses SailorApiPriceFetcher for prices to avoid duplication
 * Token List: https://asia-southeast1-ktx-finance-2.cloudfunctions.net/sailor_poolapi/getTokenListV2
 * Prices: https://asia-southeast1-ktx-finance-2.cloudfunctions.net/sailor_poolapi/getPriceList?tokens=
 */
export class SailorTokens extends BaseTokenFetcher {
  private priceFetcher: SailorApiPriceFetcher;
  
  constructor(chainId: number = 1329) {
    super("Sailor", chainId);
    this.priceFetcher = new SailorApiPriceFetcher();
  }

  protected async fetchTokensFromSource(): Promise<TokenInfo[]> {
    try {
      // Use SailorApiPriceFetcher to get token list (reuse logic)
      const tokens: SailorTokenListItem[] = await this.priceFetcher.getTokenList();

      if (!Array.isArray(tokens) || tokens.length === 0) {
        console.warn("No tokens returned from SailorApiPriceFetcher");
        return [];
      }

      // Convert to TokenInfo format
      return tokens.map(token => ({
        address: token.id as `0x${string}`, // id is the token address
        symbol: token.symbol,
        name: token.name,
        decimals: parseInt(token.decimals), // Convert string to number
        logoURI: token.url,
        chainId: this.chainId, // Assume all tokens are for current chain
        isVerified: token.verified
      }));

    } catch (error) {
      console.error("Error fetching tokens from Sailor API:", error);
      
      // Return empty array if API fails
      return [];
    }
  }

  /**
   * Get prices for specific tokens using SailorApiPriceFetcher
   */
  async getTokenPrices(tokenAddresses: string[]): Promise<SailorPriceResponse> {
    try {
      // Use SailorApiPriceFetcher to get prices (reuse logic)
      const priceTokens = await this.priceFetcher.getTokenPrices(tokenAddresses);
      
      // Convert to backward-compatible format
      const priceResponse: SailorPriceResponse = {};
      
      priceTokens.forEach(token => {
        priceResponse[token.id] = {
          price: parseFloat(token.price),
          volume24h: undefined, // Not available in price API
          liquidity: undefined  // Not available in price API
        };
      });
      
      return priceResponse;
    } catch (error) {
      console.error("Error fetching prices from Sailor API:", error);
      return {};
    }
  }

  /**
   * Get token list with enhanced Sailor data including prices
   */
  async getTokensWithMetadata(forceRefresh: boolean = false): Promise<TokenList & {
    metadata: {
      verifiedTokens: number;
      totalTokens: number;
      tokensWithPrices: number;
      apiTimestamp: string;
    }
  }> {
    const tokenList = await this.getTokens(forceRefresh);
    const tokens = tokenList.tokens;
    
    // Get prices for all tokens
    const addresses = tokens.map(token => token.address);
    const prices = await this.getTokenPrices(addresses);
    
    // Add price data to tokens
    const tokensWithPrices = tokens.map(token => ({
      ...token,
      priceUsd: prices[token.address]?.price,
      volume24h: prices[token.address]?.volume24h,
      liquidityUsd: prices[token.address]?.liquidity
    }));

    const verifiedTokens = tokens.filter(token => token.isVerified).length;
    const tokensWithPricesCount = Object.keys(prices).length;

    return {
      ...tokenList,
      tokens: tokensWithPrices,
      metadata: {
        verifiedTokens,
        totalTokens: tokens.length,
        tokensWithPrices: tokensWithPricesCount,
        apiTimestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Get high liquidity tokens (for trading recommendations)
   */
  async getHighLiquidityTokens(minLiquidityUsd: number = 10000): Promise<TokenInfo[]> {
    const tokensWithMetadata = await this.getTokensWithMetadata();
    
    return tokensWithMetadata.tokens
      .filter(token => (token.liquidityUsd || 0) >= minLiquidityUsd)
      .sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0));
  }

  /**
   * Get most traded tokens (by 24h volume)
   */
  async getMostTradedTokens(limit: number = 10): Promise<TokenInfo[]> {
    const tokensWithMetadata = await this.getTokensWithMetadata();
    
    return tokensWithMetadata.tokens
      .filter(token => token.volume24h && token.volume24h > 0)
      .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
      .slice(0, limit);
  }

  /**
   * Search tokens by symbol or name
   */
  async searchTokens(query: string): Promise<TokenInfo[]> {
    const tokens = await this.fetchTokensFromSource();
    const lowerQuery = query.toLowerCase();
    
    return tokens.filter(token => 
      token.symbol.toLowerCase().includes(lowerQuery) ||
      token.name.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get verified tokens only
   */
  async getVerifiedTokens(): Promise<TokenInfo[]> {
    const tokens = await this.fetchTokensFromSource();
    return tokens.filter(token => token.isVerified);
  }

  /**
   * Get token by address
   */
  async getTokenByAddress(address: string): Promise<TokenInfo | null> {
    const tokens = await this.fetchTokensFromSource();
    return tokens.find(token => 
      token.address.toLowerCase() === address.toLowerCase()
    ) || null;
  }

  /**
   * Get access to the underlying SailorApiPriceFetcher
   */
  getPriceFetcher(): SailorApiPriceFetcher {
    return this.priceFetcher;
  }

  /**
   * Force refresh all caches (both token list and prices)
   */
  refreshAllCaches(): void {
    this.priceFetcher.refreshAllCaches();
    // Also clear base class cache
    this.clearCache();
  }
}