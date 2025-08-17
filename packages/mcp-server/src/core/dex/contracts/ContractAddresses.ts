import { type Address } from "viem";

export interface DexContracts {
  router: Address;
  factory: Address;
  quoter?: Address; // For V3-style DEXes like Oku
  positionManager?: Address; // For concentrated liquidity
  multicall?: Address;
}

export interface TokenContracts {
  // Native and wrapped tokens
  WSEI: Address;
  
  // Stablecoins
  USDC: Address;
  //USDT: Address;
  
  // DEX native tokens
  DRG: Address;   // DragonSwap token
  YAKA: Address;  // Yaka Finance token
  
  // Other popular tokens (to be filled)
  [symbol: string]: Address;
}

/**
 * Centralized contract addresses for Sei Network DEXes and tokens
 * 
 * This class provides a single source of truth for all contract addresses
 * across different DEXes and networks on Sei.
 */
export class ContractAddresses {
  private chainId: number;

  // DEX contract addresses by protocol
  private static readonly DEX_CONTRACTS: { [chainId: number]: { [dex: string]: DexContracts } } = {
    // Sei Mainnet (1329)
    1329: {
      DragonSwap: {
        router: "0x11DA6463D6Cb5a03411Dbf5ab6f6bc3997Ac7428", // SwapRouter02
        factory: "0x179D9a5592Bc77050796F7be28058c51cA575df4", // DragonswapV2Factory
        quoter: "0x38F759cf0Af1D0dcAEd723a3967A3B658738eDe9", // QuoterV2
        positionManager: "0xa7FDcBe645d6b2B98639EbacbC347e2B575f6F70", // NonfungiblePositionManager
        multicall: "0x2183BB693DFb41047f3812975b511e272883CfAA" // Multicall
      },
      Sailor: {
        router: "0xd1EFe48B71Acd98Db16FcB9E7152B086647Ef544", // Swap Router
        factory: "0xA51136931fdd3875902618bF6B3abe38Ab2D703b", // Factory
        quoter: "0x9aeB489F5bc0d3Eb7892DD7E1FAE2d2ebD02E80b", // Quoter
        positionManager: "0xe294d5Eb435807cD21017013Bef620ed1AeafbeB" // Position Manager
      },
      Yaka: {
        router: "0xEdbBc263C74865e67C6b16F47740Fa3901b95Ae1", // Yaka V3 Pair Factory (acting as router)
        factory: "0xEdbBc263C74865e67C6b16F47740Fa3901b95Ae1", // Yaka V3 Pair Factory
        quoter: "0x2222222222222222222222222222222222222222", // TODO: Find Yaka quoter
        positionManager: "0x2222222222222222222222222222222222222222", // TODO: Find Yaka position manager
        multicall: "0x2222222222222222222222222222222222222222" // TODO: Add multicall if available
      },
      Oku: {
        router: "0xdD489C75be1039ec7d843A6aC2Fd658350B067Cf", // Swap Router02
        factory: "0x75FC67473A91335B5b8F8821277262a13B38c9b3", // v3 Core Factory
        quoter: "0x807F4E281B7A3B324825C64ca53c69F0b418dE40", // Quoter V2
        positionManager: "0x8B3c541c30f9b29560f56B9E44b59718916B69EF", // Nonfungible Token Position Manager
        multicall: "0xcA11bde05977b3631167028862bE2a173976CA11" // Multicall 3
      }
    },
    
    // Sei Testnet (1328)
    1328: {
      DragonSwap: {
        router: "0x0000000000000000000000000000000000000000", 
        factory: "0x0000000000000000000000000000000000000000"
      },
      Sailor: {
        router: "0x1111111111111111111111111111111111111111",
        factory: "0x1111111111111111111111111111111111111111" 
      },
      Yaka: {
        router: "0x2222222222222222222222222222222222222222", 
        factory: "0x2222222222222222222222222222222222222222"
      },
      Oku: {
        router: "0x2222222222222222222222222222222222222222", 
        factory: "0x2222222222222222222222222222222222222222",
        quoter: "0x2222222222222222222222222222222222222222",
        positionManager: "0x2222222222222222222222222222222222222222"
      }
    }
  };

  // Token contract addresses by chain
  private static readonly TOKEN_CONTRACTS: { [chainId: number]: TokenContracts } = {
    // Sei Mainnet (1329)
    1329: {
      // Native and wrapped
      WSEI: "0xE30feDd158A2e3b13e9badaeABaFc5516e95e8C7", 
      
      // Stablecoins
      USDC: "0x4fCF1784B31630811181f670Aea7A7bEF803eaED", 
      //USDT: "0x0000000000000000000000000000000000000000", 
      
      // DEX tokens
      DRG: "0x0000000000000000000000000000000000000000",  
      YAKA: "0x51121BCAE92E302f19D06C193C95E1f7b81a444b", 
    },
    
    // Sei Testnet (1328)
    1328: {
      WSEI: "0x0000000000000000000000000000000000000000",
      USDC: "0x0000000000000000000000000000000000000000",
      //USDT: "0x0000000000000000000000000000000000000000",
      DRG: "0x0000000000000000000000000000000000000000",
      YAKA: "0x0000000000000000000000000000000000000000",
    }
  };

  constructor(chainId: number = 1329) {
    this.chainId = chainId;
  }

  getDexContracts(dexName: "DragonSwap" | "Sailor" | "Yaka" | "Oku"): DexContracts {
    const contracts = ContractAddresses.DEX_CONTRACTS[this.chainId]?.[dexName];
    if (!contracts) {
      throw new Error(`No contracts found for ${dexName} on chain ${this.chainId}`);
    }
    return contracts;
  }

  getRouterAddress(dexName: "DragonSwap" | "Sailor" | "Yaka" | "Oku"): Address {
    return this.getDexContracts(dexName).router;
  }

  /**
   * Get factory address for a specific DEX
   */
  getFactoryAddress(dexName: "DragonSwap" | "Sailor" | "Yaka" | "Oku"): Address {
    return this.getDexContracts(dexName).factory;
  }

  /**
   * Get quoter address for V3-style DEXes (DragonSwap, Sailor and Oku)
   */
  getQuoterAddress(dexName: "DragonSwap" | "Sailor" | "Yaka" | "Oku"): Address {
    const contracts = this.getDexContracts(dexName);
    if (!contracts.quoter) {
      throw new Error(`No quoter address available for ${dexName}`);
    }
    return contracts.quoter;
  }

  /**
   * Get position manager address for concentrated liquidity DEXes
   */
  getPositionManagerAddress(dexName: "DragonSwap" | "Sailor" | "Yaka" | "Oku"): Address {
    const contracts = this.getDexContracts(dexName);
    if (!contracts.positionManager) {
      throw new Error(`No position manager address available for ${dexName}`);
    }
    return contracts.positionManager;
  }

  /**
   * Get multicall address for a DEX (if available)
   */
  getMulticallAddress(dexName: "DragonSwap" | "Sailor" | "Yaka" | "Oku"): Address | null {
    const contracts = this.getDexContracts(dexName);
    return contracts.multicall || null;
  }

  // Token Contract Getters

  /**
   * Get all token contracts for current chain
   */
  getTokenContracts(): TokenContracts {
    const contracts = ContractAddresses.TOKEN_CONTRACTS[this.chainId];
    if (!contracts) {
      throw new Error(`No token contracts found for chain ${this.chainId}`);
    }
    return contracts;
  }

  /**
   * Get specific token address by symbol
   */
  getTokenAddress(symbol: string): Address {
    const contracts = this.getTokenContracts();
    const address = contracts[symbol.toUpperCase()];
    if (!address) {
      throw new Error(`No address found for token ${symbol} on chain ${this.chainId}`);
    }
    return address;
  }

  /**
   * Get WSEI (Wrapped SEI) address
   */
  getWSEIAddress(): Address {
    return this.getTokenAddress("WSEI");
  }

  /**
   * Get USDC address
   */
  getUSDCAddress(): Address {
    return this.getTokenAddress("USDC");
  }

  /**
   * Get USDT address
   */
  getUSDTAddress(): Address {
    return this.getTokenAddress("USDT");
  }

  /**
   * Get DragonSwap token address
   */
  getDRGAddress(): Address {
    return this.getTokenAddress("DRG");
  }

  /**
   * Get Yaka Finance token address
   */
  getYAKAAddress(): Address {
    return this.getTokenAddress("YAKA");
  }

  // Utility Methods

  /**
   * Check if a token address is known
   */
  isKnownToken(address: Address): boolean {
    const contracts = this.getTokenContracts();
    return Object.values(contracts).includes(address);
  }

  /**
   * Get token symbol by address (if known)
   */
  getTokenSymbol(address: Address): string | null {
    const contracts = this.getTokenContracts();
    for (const [symbol, contractAddress] of Object.entries(contracts)) {
      if (contractAddress.toLowerCase() === address.toLowerCase()) {
        return symbol;
      }
    }
    return null;
  }

  /**
   * Get all available DEX names for current chain
   */
  getAvailableDexes(): string[] {
    const dexContracts = ContractAddresses.DEX_CONTRACTS[this.chainId];
    return dexContracts ? Object.keys(dexContracts) : [];
  }

  /**
   * Get all available token symbols for current chain
   */
  getAvailableTokens(): string[] {
    const tokenContracts = this.getTokenContracts();
    return Object.keys(tokenContracts);
  }

  /**
   * Validate if address looks like a valid contract address
   */
  isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  /**
   * Check if address is a placeholder (all zeros, ones, or twos)
   */
  isPlaceholderAddress(address: Address): boolean {
    return (
      address === "0x0000000000000000000000000000000000000000" ||
      address === "0x1111111111111111111111111111111111111111" ||
      address === "0x2222222222222222222222222222222222222222"
    );
  }

  /**
   * Get current chain ID
   */
  getChainId(): number {
    return this.chainId;
  }

  /**
   * Switch to different chain
   */
  switchChain(chainId: number): void {
    this.chainId = chainId;
  }

  // Static methods for quick access

  /**
   * Quick access to mainnet contracts
   */
  static mainnet(): ContractAddresses {
    return new ContractAddresses(1329);
  }

  /**
   * Quick access to testnet contracts
   */
  static testnet(): ContractAddresses {
    return new ContractAddresses(1328);
  }

  /**
   * Get all supported chain IDs
   */
  static getSupportedChains(): number[] {
    return Object.keys(ContractAddresses.DEX_CONTRACTS).map(Number);
  }

}