import { BaseTokenFetcher, type TokenInfo } from "./BaseTokenFetcher.js";

interface YakaAssetResponse {
  data: Array<{
    name: string;
    symbol: string;
    price: number;
    decimals: number;
    chainId: number;
    address: string;
    logoURI: string;
    riskScore: string;
  }>;
  success?: boolean;
  message?: string;
}

/**
 * Yaka Finance Token Fetcher
 * 
 * Fetches tokens from Yaka Finance's public API
 * URL: https://backend.yaka.finance/api/v1/assets
 * Includes price data and risk scores
 */
export class YakaFinanceTokens extends BaseTokenFetcher {
  private static readonly API_URL = "https://backend.yaka.finance/api/v1/assets";
  private static readonly TIMEOUT = 10000; // 10 seconds

  constructor(chainId: number = 1329) {
    super("YakaFinance", chainId);
  }

  protected async fetchTokensFromSource(): Promise<TokenInfo[]> {
    try {
      console.log(`Fetching Yaka Finance tokens from API: ${YakaFinanceTokens.API_URL}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), YakaFinanceTokens.TIMEOUT);

      const response = await fetch(YakaFinanceTokens.API_URL, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'SEI-MCP-Server/1.0.0',
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: YakaAssetResponse = await response.json() as YakaAssetResponse;
      
      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid API response format: missing data array');
      }

      console.log(`Found ${data.data.length} assets from Yaka Finance`);

      // Filter and normalize tokens for the specified chain
      const filteredTokens = data.data
        .filter(asset => asset.chainId === this.chainId)
        .filter(asset => this.validateToken(asset))
        .map(asset => this.normalizeYakaToken(asset));

      console.log(`Processed ${filteredTokens.length} valid tokens for chain ${this.chainId}`);
      
      return filteredTokens;

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout: Yaka Finance API took too long to respond');
      }
      
      console.error('Error fetching Yaka Finance tokens:', error);
      throw new Error(`Failed to fetch Yaka Finance tokens: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Normalize Yaka Finance token format to our standard format
   */
  private normalizeYakaToken(asset: YakaAssetResponse['data'][0]): TokenInfo {
    return {
      address: asset.address as `0x${string}`,
      name: asset.name,
      symbol: asset.symbol,
      decimals: asset.decimals,
      chainId: asset.chainId,
      logoURI: asset.logoURI,
      price: asset.price,
      riskScore: asset.riskScore
    };
  }

  /**
   * Get tokens with current price data
   */
  async getTokensWithPrices(): Promise<TokenInfo[]> {
    const tokenList = await this.getTokens();
    return tokenList.tokens.filter(token => token.price !== undefined && token.price > 0);
  }

  /**
   * Get token by symbol with price
   */
  async getTokenWithPrice(symbol: string): Promise<TokenInfo | null> {
    const tokens = await this.findTokensBySymbol(symbol);
    return tokens.find(token => token.price !== undefined) || tokens[0] || null;
  }

  /**
   * Get YAKA native token
   */
  async getYakaToken(): Promise<TokenInfo | null> {
    const tokens = await this.findTokensBySymbol('YAKA');
    return tokens[0] || null;
  }

  /**
   * Get tokens by risk score range
   */
  async getTokensByRiskScore(maxRisk: number = 0.1): Promise<TokenInfo[]> {
    const tokenList = await this.getTokens();
    return tokenList.tokens.filter(token => {
      if (!token.riskScore) return false;
      const risk = parseFloat(token.riskScore);
      return !isNaN(risk) && risk <= maxRisk;
    });
  }

  /**
   * Get high-value tokens (by price)
   */
  async getHighValueTokens(minPrice: number = 1.0): Promise<TokenInfo[]> {
    const tokenList = await this.getTokens();
    return tokenList.tokens
      .filter(token => token.price !== undefined && token.price >= minPrice)
      .sort((a, b) => (b.price || 0) - (a.price || 0));
  }

  /**
   * Get market statistics
   */
  async getMarketStatistics(): Promise<{
    totalTokens: number;
    tokensWithPrices: number;
    averagePrice: number;
    totalMarketValue: number;
    riskDistribution: {
      low: number;    // < 0.1
      medium: number; // 0.1 - 0.5
      high: number;   // > 0.5
    };
  }> {
    try {
      const tokenList = await this.getTokens();
      const tokensWithPrices = tokenList.tokens.filter(t => t.price !== undefined && t.price > 0);
      
      const totalMarketValue = tokensWithPrices.reduce((sum, token) => sum + (token.price || 0), 0);
      const averagePrice = tokensWithPrices.length > 0 ? totalMarketValue / tokensWithPrices.length : 0;

      // Risk distribution
      const riskDistribution = { low: 0, medium: 0, high: 0 };
      tokenList.tokens.forEach(token => {
        if (token.riskScore) {
          const risk = parseFloat(token.riskScore);
          if (!isNaN(risk)) {
            if (risk < 0.1) riskDistribution.low++;
            else if (risk <= 0.5) riskDistribution.medium++;
            else riskDistribution.high++;
          }
        }
      });

      return {
        totalTokens: tokenList.tokens.length,
        tokensWithPrices: tokensWithPrices.length,
        averagePrice,
        totalMarketValue,
        riskDistribution
      };

    } catch (error) {
      console.error('Error calculating market statistics:', error);
      return {
        totalTokens: 0,
        tokensWithPrices: 0,
        averagePrice: 0,
        totalMarketValue: 0,
        riskDistribution: { low: 0, medium: 0, high: 0 }
      };
    }
  }

  /**
   * Search tokens with advanced filters
   */
  async searchTokensAdvanced(params: {
    query?: string;
    minPrice?: number;
    maxPrice?: number;
    maxRiskScore?: number;
    sortBy?: 'price' | 'riskScore' | 'name';
    sortOrder?: 'asc' | 'desc';
    limit?: number;
  }): Promise<TokenInfo[]> {
    let tokens = await this.getTokens();
    let results = tokens.tokens;

    // Apply text search
    if (params.query) {
      const query = params.query.toLowerCase();
      results = results.filter(token => 
        token.name.toLowerCase().includes(query) ||
        token.symbol.toLowerCase().includes(query)
      );
    }

    // Apply price filters
    if (params.minPrice !== undefined) {
      results = results.filter(token => token.price !== undefined && token.price >= params.minPrice!);
    }
    if (params.maxPrice !== undefined) {
      results = results.filter(token => token.price !== undefined && token.price <= params.maxPrice!);
    }

    // Apply risk score filter
    if (params.maxRiskScore !== undefined) {
      results = results.filter(token => {
        if (!token.riskScore) return false;
        const risk = parseFloat(token.riskScore);
        return !isNaN(risk) && risk <= params.maxRiskScore!;
      });
    }

    // Apply sorting
    if (params.sortBy) {
      results.sort((a, b) => {
        let aVal: number | string = 0;
        let bVal: number | string = 0;

        switch (params.sortBy) {
          case 'price':
            aVal = a.price || 0;
            bVal = b.price || 0;
            break;
          case 'riskScore':
            aVal = parseFloat(a.riskScore || '0');
            bVal = parseFloat(b.riskScore || '0');
            break;
          case 'name':
            aVal = a.name;
            bVal = b.name;
            break;
        }

        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return params.sortOrder === 'desc' ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
        } else {
          const numA = Number(aVal);
          const numB = Number(bVal);
          return params.sortOrder === 'desc' ? numB - numA : numA - numB;
        }
      });
    }

    // Apply limit
    if (params.limit && params.limit > 0) {
      results = results.slice(0, params.limit);
    }

    return results;
  }

  /**
   * Get API health status
   */
  async getApiHealth(): Promise<{
    status: 'healthy' | 'unhealthy';
    responseTime: number;
    lastUpdated: number;
  }> {
    const start = Date.now();
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout for health check

      await fetch(YakaFinanceTokens.API_URL, {
        method: 'HEAD',
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      
      return {
        status: 'healthy',
        responseTime: Date.now() - start,
        lastUpdated: Date.now()
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: Date.now() - start,
        lastUpdated: Date.now()
      };
    }
  }
}