import { type Address } from "viem";
import { ContractAddresses } from "./ContractAddresses.js";

/**
 * Factory contract addresses for pool discovery
 * Provides easy access to factory addresses for different DEXes
 */

// Mainnet Factory Addresses (Chain ID: 1329)
const contractAddresses = new ContractAddresses(1329);

export const DRAGONSWAP_FACTORY_ADDRESS = contractAddresses.getFactoryAddress("DragonSwap");
export const SAILOR_FACTORY_ADDRESS = contractAddresses.getFactoryAddress("Sailor");
export const YAKA_FACTORY_ADDRESS = contractAddresses.getFactoryAddress("Yaka");

/**
 * V3 fee tiers for Sailor Finance (Uniswap V3 style)
 */
export const SAILOR_FEE_TIERS = {
  LOW: 500,      // 0.05%
  MEDIUM: 3000,  // 0.30%
  HIGH: 10000    // 1.00%
} as const;

/**
 * Get all factory addresses for a given chain
 */
export function getFactoryAddresses(chainId: number = 1329): {
  dragonswap: Address;
  sailor: Address; 
  yaka: Address;
} {
  const addresses = new ContractAddresses(chainId);
  
  return {
    dragonswap: addresses.getFactoryAddress("DragonSwap"),
    sailor: addresses.getFactoryAddress("Sailor"),
    yaka: addresses.getFactoryAddress("Yaka")
  };
}

/**
 * Type for supported DEX factory types
 */
export type SupportedDEX = "DragonSwap" | "Sailor" | "Yaka";

/**
 * Get factory address for a specific DEX
 */
export function getFactoryAddress(dex: SupportedDEX, chainId: number = 1329): Address {
  const addresses = new ContractAddresses(chainId);
  return addresses.getFactoryAddress(dex);
}