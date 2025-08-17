/**
 * Protocol Configuration Manager
 * 
 * Centralized configuration for enabling/disabling protocols
 * Prevents unnecessary API calls when protocols are disabled
 */

interface ProtocolConfig {
  enabled: boolean;
  name: string;
  description: string;
  capabilities: string[];
}

export interface ProtocolsConfig {
  dragonswap: ProtocolConfig;
  yaka: ProtocolConfig;
  sailor: ProtocolConfig;
}

class ProtocolConfigManager {
  private config: ProtocolsConfig = {
    dragonswap: {
      enabled: true,
      name: "DragonSwap",
      description: "SEI DEX with swap execution capability",
      capabilities: ["pricing", "swapping", "liquidity"]
    },
    yaka: {
      enabled: false, // Disabled for testing - focus on Sailor + DragonSwap
      name: "Yaka Finance",
      description: "SEI aggregation router (complex routing)",
      capabilities: ["pricing"]
    },
    sailor: {
      enabled: true,
      name: "Sailor Finance",
      description: "SEI DEX with comprehensive token data",
      capabilities: ["pricing", "token-list"]
    }
  };

  /**
   * Get current configuration for all protocols
   */
  getConfig(): ProtocolsConfig {
    return { ...this.config };
  }

  /**
   * Get configuration for a specific protocol
   */
  getProtocolConfig(protocol: keyof ProtocolsConfig): ProtocolConfig {
    return { ...this.config[protocol] };
  }

  /**
   * Check if a protocol is enabled
   */
  isEnabled(protocol: keyof ProtocolsConfig): boolean {
    return this.config[protocol].enabled;
  }

  /**
   * Enable a protocol
   */
  enableProtocol(protocol: keyof ProtocolsConfig): void {
    this.config[protocol].enabled = true;
    console.log(`✅ Protocol ${this.config[protocol].name} enabled`);
  }

  /**
   * Disable a protocol
   */
  disableProtocol(protocol: keyof ProtocolsConfig): void {
    this.config[protocol].enabled = false;
    console.log(`❌ Protocol ${this.config[protocol].name} disabled`);
  }

  /**
   * Toggle a protocol
   */
  toggleProtocol(protocol: keyof ProtocolsConfig): boolean {
    const newState = !this.config[protocol].enabled;
    this.config[protocol].enabled = newState;
    console.log(`🔄 Protocol ${this.config[protocol].name} ${newState ? 'enabled' : 'disabled'}`);
    return newState;
  }

  /**
   * Get list of enabled protocols
   */
  getEnabledProtocols(): string[] {
    return Object.entries(this.config)
      .filter(([_, config]) => config.enabled)
      .map(([_, config]) => config.name);
  }

  /**
   * Get list of disabled protocols
   */
  getDisabledProtocols(): string[] {
    return Object.entries(this.config)
      .filter(([_, config]) => !config.enabled)
      .map(([_, config]) => config.name);
  }

  /**
   * Set configuration from object
   */
  setConfig(newConfig: Partial<ProtocolsConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Reset to default configuration
   */
  resetToDefaults(): void {
    this.config = {
      dragonswap: {
        enabled: true,
        name: "DragonSwap",
        description: "SEI DEX with swap execution capability",
        capabilities: ["pricing", "swapping", "liquidity"]
      },
      yaka: {
        enabled: false,
        name: "Yaka Finance", 
        description: "SEI aggregation router (complex routing)",
        capabilities: ["pricing"]
      },
      sailor: {
        enabled: true,
        name: "Sailor Finance",
        description: "SEI DEX with comprehensive token data",
        capabilities: ["pricing", "token-list"]
      }
    };
    console.log("🔄 Protocol configuration reset to defaults");
  }

  /**
   * Get protocols that support a specific capability
   */
  getProtocolsWithCapability(capability: string): string[] {
    return Object.entries(this.config)
      .filter(([_, config]) => config.enabled && config.capabilities.includes(capability))
      .map(([_, config]) => config.name);
  }
}

// Singleton instance
export const protocolConfig = new ProtocolConfigManager();

/**
 * Helper function to check if protocol is enabled before making API calls
 */
export function shouldFetchProtocolData(protocol: keyof ProtocolsConfig): boolean {
  const enabled = protocolConfig.isEnabled(protocol);
  if (!enabled) {
    console.log(`⏭️  Skipping ${protocolConfig.getProtocolConfig(protocol).name} - protocol disabled`);
  }
  return enabled;
}