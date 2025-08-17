import { BaseTokenFetcher, type TokenInfo } from "./BaseTokenFetcher.js";

interface DragonSwapTokenListResponse {
  name?: string;
  version?: string;
  tokens: Array<{
    address: string;
    chainId: number;
    name: string;
    symbol: string;
    decimals: number;
    logoURI?: string;
    tags?: string[];
  }>;
}

/**
 * DragonSwap Token Fetcher - Simplified
 * 
 * Note: For pricing, use DragonSwapApiPriceFetcher instead
 */
export class DragonSwapTokens extends BaseTokenFetcher {
  constructor(chainId: number = 1329) {
    super("DragonSwap", chainId);
  }

  protected async fetchTokensFromSource(): Promise<TokenInfo[]> {
    try {
      console.log('Fetching DragonSwap token list...');
      
      const response = await fetch(
        'https://raw.githubusercontent.com/DragonSwap-defi/assets/main/generated/dragonswap-default.tokenlist.json',
        {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'SEI-MCP-Server/1.0.0'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: DragonSwapTokenListResponse = await response.json() as DragonSwapTokenListResponse;
      
      if (!data.tokens || !Array.isArray(data.tokens)) {
        throw new Error('Invalid token list format: missing tokens array');
      }

      console.log(`Found ${data.tokens.length} tokens from DragonSwap`);

      // Filter and normalize tokens for the specified chain
      const filteredTokens = data.tokens
        .filter(token => token.chainId === this.chainId)
        .filter(token => this.validateToken(token))
        .map(token => this.normalizeDragonSwapToken(token));

      console.log(`Processed ${filteredTokens.length} valid tokens for chain ${this.chainId}`);
      
      return filteredTokens;

    } catch (error) {
      console.error('Error fetching DragonSwap tokens:', error);
      throw new Error(`Failed to fetch DragonSwap tokens: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validate DragonSwap token data
   */
  protected validateToken(token: any): boolean {
    return !!(
      token.address &&
      token.symbol &&
      token.name &&
      typeof token.decimals === 'number' &&
      typeof token.chainId === 'number'
    );
  }

  /**
   * Normalize DragonSwap token to our standard format
   */
  private normalizeDragonSwapToken(token: any): TokenInfo {
    return {
      address: token.address.toLowerCase(),
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      chainId: token.chainId,
      logoURI: token.logoURI || undefined,
      tags: token.tags || []
    };
  }

  /**
   * Search for tokens by symbol or name
   */
  async searchTokens(query: string): Promise<TokenInfo[]> {
    const tokenList = await this.getTokens();
    const lowerQuery = query.toLowerCase();
    
    return tokenList.tokens.filter(token =>
      token.symbol.toLowerCase().includes(lowerQuery) ||
      token.name.toLowerCase().includes(lowerQuery)
    );
  }
}