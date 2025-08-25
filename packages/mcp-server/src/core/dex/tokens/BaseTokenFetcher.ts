import { type Address } from "viem";

export interface TokenInfo {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  chainId: number;
  logoURI?: string;
  tags?: string[];
  about?: string;
  price?: number;
  riskScore?: string;
  isVerified?: boolean;
  priceUsd?: number;
  volume24h?: number;
  liquidityUsd?: number;
}

export interface TokenList {
  protocolName: string;
  chainId: number;
  tokens: TokenInfo[];
  lastUpdated: number;
  version?: string;
}

export abstract class BaseTokenFetcher {
  protected protocolName: string;
  protected chainId: number;
  protected cacheExpiry: number; // milliseconds
  private cache: TokenList | null = null;
  private lastFetch: number = 0;

  constructor(protocolName: string, chainId: number = 1329, cacheExpiry: number = 30 * 60 * 1000) {
    this.protocolName = protocolName;
    this.chainId = chainId;
    this.cacheExpiry = cacheExpiry; // 30 minutes default
  }

  /**
   * Get tokens with caching
   */
  async getTokens(forceRefresh: boolean = false): Promise<TokenList> {
    const now = Date.now();
    
    if (!forceRefresh && this.cache && (now - this.lastFetch) < this.cacheExpiry) {
      return this.cache;
    }

    try {
      const tokens = await this.fetchTokensFromSource();
      this.cache = {
        protocolName: this.protocolName,
        chainId: this.chainId,
        tokens,
        lastUpdated: now
      };
      this.lastFetch = now;
      
      return this.cache;
    } catch (error) {
      // If fetch fails and we have cache, return it
      if (this.cache) {
        console.warn(`Failed to fetch fresh tokens for ${this.protocolName}, using cache:`, error);
        return this.cache;
      }
      throw error;
    }
  }

  /**
   * Find token by address
   */
  async findTokenByAddress(address: Address): Promise<TokenInfo | null> {
    const tokenList = await this.getTokens();
    return tokenList.tokens.find(token => 
      token.address.toLowerCase() === address.toLowerCase()
    ) || null;
  }

  /**
   * Find tokens by symbol
   */
  async findTokensBySymbol(symbol: string): Promise<TokenInfo[]> {
    const tokenList = await this.getTokens();
    return tokenList.tokens.filter(token => 
      token.symbol.toLowerCase() === symbol.toLowerCase()
    );
  }

  /**
   * Search tokens by name or symbol
   */
  async searchTokens(query: string): Promise<TokenInfo[]> {
    const tokenList = await this.getTokens();
    const lowerQuery = query.toLowerCase();
    
    return tokenList.tokens.filter(token => 
      token.name.toLowerCase().includes(lowerQuery) ||
      token.symbol.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get tokens by tags
   */
  async getTokensByTags(tags: string[]): Promise<TokenInfo[]> {
    const tokenList = await this.getTokens();
    return tokenList.tokens.filter(token => 
      token.tags && token.tags.some(tag => 
        tags.some(searchTag => tag.toLowerCase() === searchTag.toLowerCase())
      )
    );
  }

  /**
   * Get cache info
   */
  getCacheInfo(): { isCached: boolean; lastFetch: number; expiresAt: number } {
    return {
      isCached: this.cache !== null,
      lastFetch: this.lastFetch,
      expiresAt: this.lastFetch + this.cacheExpiry
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache = null;
    this.lastFetch = 0;
  }

  // Abstract method that each protocol must implement
  protected abstract fetchTokensFromSource(): Promise<TokenInfo[]>;

  // Helper method to normalize token data
  protected normalizeToken(rawToken: any): TokenInfo {
    return {
      address: rawToken.address as Address,
      name: rawToken.name || '',
      symbol: rawToken.symbol || '',
      decimals: rawToken.decimals || 18,
      chainId: rawToken.chainId || this.chainId,
      logoURI: rawToken.logoURI || rawToken.logo,
      tags: rawToken.tags,
      about: rawToken.about || rawToken.description,
      price: rawToken.price,
      riskScore: rawToken.riskScore
    };
  }

  // Helper method to validate token data
  protected validateToken(token: any): boolean {
    return (
      token.address &&
      token.symbol &&
      typeof token.decimals === 'number' &&
      token.decimals >= 0 &&
      token.decimals <= 18
    );
  }
}