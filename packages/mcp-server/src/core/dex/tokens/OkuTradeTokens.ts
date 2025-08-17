import { BaseTokenFetcher, type TokenInfo } from "./BaseTokenFetcher.js";
import { isAddress } from "viem";

interface OkuTokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
}

interface GitHubApiResponse {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string | null;
  type: "file" | "dir";
}

/**
 * Oku Trade Token Fetcher
 * 
 * Fetches tokens from Oku Trade's GitHub repository structure
 * URL: https://github.com/oku-trade/tokens/tree/main/chains/evm/1329
 * Each token has its own folder with an info.json file
 */
export class OkuTradeTokens extends BaseTokenFetcher {
  private static readonly GITHUB_API_BASE = "https://api.github.com/repos/oku-trade/tokens/contents";
  private static readonly RAW_BASE = "https://raw.githubusercontent.com/oku-trade/tokens/main";
  private static readonly CHAIN_PATH = "chains/evm/1329";

  constructor(chainId: number = 1329) {
    super("OkuTrade", chainId);
  }

  protected async fetchTokensFromSource(): Promise<TokenInfo[]> {
    try {
      console.log(`Fetching Oku Trade tokens from GitHub API`);
      
      // First, get the list of token directories
      const tokenDirectories = await this.getTokenDirectories();
      console.log(`Found ${tokenDirectories.length} token directories`);

      // Then, fetch info.json for each token
      const tokens: TokenInfo[] = [];
      const batchSize = 10; // Process in batches to avoid rate limiting
      
      for (let i = 0; i < tokenDirectories.length; i += batchSize) {
        const batch = tokenDirectories.slice(i, i + batchSize);
        const batchPromises = batch.map(dir => this.fetchTokenInfo(dir.name));
        
        const batchResults = await Promise.allSettled(batchPromises);
        
        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value) {
            tokens.push(result.value);
          } else {
            console.warn(`Failed to fetch token info for ${batch[index].name}:`, 
              result.status === 'rejected' ? result.reason : 'Unknown error');
          }
        });

        // Small delay between batches to be respectful to GitHub API
        if (i + batchSize < tokenDirectories.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      console.log(`Successfully processed ${tokens.length} tokens from Oku Trade`);
      return tokens;

    } catch (error) {
      console.error('Error fetching Oku Trade tokens:', error);
      throw new Error(`Failed to fetch Oku Trade tokens: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get list of token directories from GitHub API
   */
  private async getTokenDirectories(): Promise<GitHubApiResponse[]> {
    const url = `${OkuTradeTokens.GITHUB_API_BASE}/${OkuTradeTokens.CHAIN_PATH}`;
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'SEI-MCP-Server/1.0.0'
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data: GitHubApiResponse[] = await response.json() as GitHubApiResponse[];
    
    // Filter for directories only (token addresses)
    return data.filter(item => 
      item.type === 'dir' && 
      item.name.startsWith('0x') && 
      item.name.length === 42 // Ethereum address length
    );
  }

  /**
   * Fetch individual token info from info.json
   */
  private async fetchTokenInfo(tokenAddress: string): Promise<TokenInfo | null> {
    try {
      const infoUrl = `${OkuTradeTokens.RAW_BASE}/${OkuTradeTokens.CHAIN_PATH}/${tokenAddress}/info.json`;
      
      const response = await fetch(infoUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'SEI-MCP-Server/1.0.0'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch info.json for ${tokenAddress}: ${response.status}`);
      }

      const tokenInfo: OkuTokenInfo = await response.json() as OkuTokenInfo;
      
      if (!this.validateToken(tokenInfo)) {
        throw new Error(`Invalid token data for ${tokenAddress}`);
      }

      return this.normalizeOkuToken(tokenInfo);

    } catch (error) {
      console.warn(`Error fetching token info for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Normalize Oku token format to our standard format
   */
  private normalizeOkuToken(token: OkuTokenInfo): TokenInfo {
    return {
      address: token.address as `0x${string}`,
      name: token.name,
      symbol: token.symbol,
      decimals: token.decimals,
      chainId: this.chainId,
      logoURI: token.logoURI
    };
  }

  /**
   * Get token with logo URL
   */
  async getTokenLogo(address: string): Promise<string | null> {
    try {
      const logoUrl = `${OkuTradeTokens.RAW_BASE}/${OkuTradeTokens.CHAIN_PATH}/${address}/logo.png`;
      
      const response = await fetch(logoUrl, { method: 'HEAD' });
      
      return response.ok ? logoUrl : null;
    } catch (error) {
      console.warn(`Error checking logo for ${address}:`, error);
      return null;
    }
  }

  /**
   * Get detailed token metadata including logo
   */
  async getDetailedTokenInfo(address: string): Promise<TokenInfo | null> {
    const token = await this.findTokenByAddress(address as `0x${string}`);
    if (!token) return null;

    // Try to get logo if not already present
    if (!token.logoURI) {
      const logoUrl = await this.getTokenLogo(address);
      if (logoUrl) {
        token.logoURI = logoUrl;
      }
    }

    return token;
  }

  /**
   * Check if a specific token exists in Oku repository
   */
  async hasTokenInfo(address: string): Promise<boolean> {
    try {
      const infoUrl = `${OkuTradeTokens.RAW_BASE}/${OkuTradeTokens.CHAIN_PATH}/${address}/info.json`;
      const response = await fetch(infoUrl, { method: 'HEAD' });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get repository statistics
   */
  async getRepositoryStats(): Promise<{
    totalTokens: number;
    tokensWithLogos: number;
    lastUpdated: string;
  }> {
    try {
      const tokenList = await this.getTokens();
      
      // Count tokens with logos by checking if logoURI exists
      const tokensWithLogos = tokenList.tokens.filter(token => token.logoURI).length;

      // Get repository last commit info
      const repoUrl = 'https://api.github.com/repos/oku-trade/tokens/commits?per_page=1';
      const commitResponse = await fetch(repoUrl, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'SEI-MCP-Server/1.0.0'
        }
      });

      let lastUpdated = 'Unknown';
      if (commitResponse.ok) {
        const commits: any = await commitResponse.json();
        if (commits.length > 0) {
          lastUpdated = commits[0].commit.committer.date;
        }
      }

      return {
        totalTokens: tokenList.tokens.length,
        tokensWithLogos,
        lastUpdated
      };

    } catch (error) {
      console.error('Error getting repository stats:', error);
      return {
        totalTokens: 0,
        tokensWithLogos: 0,
        lastUpdated: 'Error'
      };
    }
  }

  /**
   * Get all available token addresses (useful for validation)
   */
  async getAllTokenAddresses(): Promise<string[]> {
    try {
      const directories = await this.getTokenDirectories();
      return directories
        .map(dir => dir.name)
        .filter(addr => isAddress(addr));
    } catch (error) {
      console.error('Error getting token addresses:', error);
      return [];
    }
  }
}