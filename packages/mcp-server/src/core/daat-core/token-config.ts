/**
 * Token Configuration for SEI Network
 * 
 * Centralized configuration for important token addresses and metadata
 * Used for arbitrage calculations and trading
 */

export interface TokenConfig {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  isStablecoin?: boolean;
  isNative?: boolean;
  coingeckoId?: string;
}

export interface SEITokens {
  USDC: TokenConfig;
  USDT: TokenConfig;
  ETH: TokenConfig;
  BTC: TokenConfig;
  SEI: TokenConfig;
  WSEI: TokenConfig;
  [key: string]: TokenConfig;
}

/**
 * Official token addresses on SEI Network
 * TODO: Verify these addresses with actual SEI network deployment
 */
export const SEI_TOKENS: SEITokens = {
  USDC: {
    address: "0x3894085ef7ff0f0aedf52e2a2704928d1ec074f1",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    isStablecoin: true,
    coingeckoId: "usd-coin"
  },
  USDT: {
    address: "0x0000000000000000000000000000000000000000", // TODO: Get real address
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    isStablecoin: true,
    coingeckoId: "tether"
  },
  ETH: {
    address: "0x160345fc359604fc6e70e3c5facbde5f7a9342d8",
    symbol: "ETH",
    name: "Ethereum",
    decimals: 18,
    coingeckoId: "ethereum"
  },
  BTC: {
    address: "0x0555e30da8f98308edb960aa94c0db47230d2b9c",
    symbol: "BTC",
    name: "Bitcoin",
    decimals: 8,
    coingeckoId: "bitcoin"
  },
  SEI: {
    address: "0x0000000000000000000000000000000000000000", // Native token
    symbol: "SEI",
    name: "SEI",
    decimals: 18,
    isNative: true,
    coingeckoId: "sei-network"
  },
  WSEI: {
    address: "0x0000000000000000000000000000000000000000", // TODO: Get real wrapped SEI address
    symbol: "WSEI",
    name: "Wrapped SEI",
    decimals: 18,
    coingeckoId: "sei-network"
  }
};

/**
 * Base currency for arbitrage calculations
 */
export const BASE_CURRENCY = SEI_TOKENS.USDC;

/**
 * Get token config by address
 */
export function getTokenByAddress(address: string): TokenConfig | null {
  const normalizedAddress = address.toLowerCase();
  
  for (const token of Object.values(SEI_TOKENS)) {
    if (token.address.toLowerCase() === normalizedAddress) {
      return token;
    }
  }
  
  return null;
}

/**
 * Get token config by symbol
 */
export function getTokenBySymbol(symbol: string): TokenConfig | null {
  const normalizedSymbol = symbol.toLowerCase();
  
  for (const token of Object.values(SEI_TOKENS)) {
    if (token.symbol.toLowerCase() === normalizedSymbol) {
      return token;
    }
  }
  
  return null;
}

/**
 * Get all stablecoins
 */
export function getStablecoins(): TokenConfig[] {
  return Object.values(SEI_TOKENS).filter(token => token.isStablecoin);
}

/**
 * Get major trading pairs (for arbitrage)
 */
export function getMajorTokens(): TokenConfig[] {
  return [
    SEI_TOKENS.USDC,
    SEI_TOKENS.ETH,
    SEI_TOKENS.BTC,
    SEI_TOKENS.SEI,
    SEI_TOKENS.WSEI
  ];
}

/**
 * Check if an address is a known token
 */
export function isKnownToken(address: string): boolean {
  return getTokenByAddress(address) !== null;
}

/**
 * Get display name for token
 */
export function getTokenDisplayName(address: string): string {
  const token = getTokenByAddress(address);
  return token ? `${token.symbol} (${token.name})` : address;
}