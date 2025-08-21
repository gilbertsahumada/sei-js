import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ContractAddresses } from "../dex/contracts/ContractAddresses.js";

/**
 * Register contract-related tools with the MCP server
 */
export function registerContractTools(server: McpServer) {

  // Get all contract addresses for a specific chain
  server.tool(
    "get_contract_addresses",
    "Get all DEX and token contract addresses for a specific chain",
    {
      chainId: z.number().optional().describe("Chain ID (1329 for Sei mainnet, 1328 for testnet). Default: 1329")
    },
    async ({ chainId = 1329 }) => {
      try {
        const contracts = new ContractAddresses(chainId);
        
        const dexContracts = {
          DragonSwap: contracts.getDexContracts("DragonSwap"),
          Sailor: contracts.getDexContracts("Sailor"),
          Yaka: contracts.getDexContracts("Yaka"),
          Oku: contracts.getDexContracts("Oku")
        };

        const tokenContracts = contracts.getTokenContracts();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              chainId,
              dexContracts,
              tokenContracts,
              availableDexes: contracts.getAvailableDexes(),
              availableTokens: contracts.getAvailableTokens()
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching contract addresses: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Get specific DEX contract addresses
  server.tool(
    "get_dex_contracts",
    "Get contract addresses for a specific DEX",
    {
      dexName: z.enum(["DragonSwap", "Sailor", "Yaka", "Oku"]).describe("DEX name"),
      chainId: z.number().optional().describe("Chain ID (default: 1329)")
    },
    async ({ dexName, chainId = 1329 }) => {
      try {
        const contracts = new ContractAddresses(chainId);
        const dexContracts = contracts.getDexContracts(dexName);
        
        const isPlaceholder = contracts.isPlaceholderAddress(dexContracts.router);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              dexName,
              chainId,
              contracts: dexContracts,
              isPlaceholder,
              warning: isPlaceholder ? "These are placeholder addresses. Real addresses needed for actual trading." : undefined
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching DEX contracts: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Get token address by symbol
  server.tool(
    "get_token_address",
    "Get contract address for a specific token by symbol",
    {
      symbol: z.string().describe("Token symbol (e.g., WSEI, USDC, DRG, YAKA)"),
      chainId: z.number().optional().describe("Chain ID (default: 1329)")
    },
    async ({ symbol, chainId = 1329 }) => {
      try {
        const contracts = new ContractAddresses(chainId);
        const address = contracts.getTokenAddress(symbol);
        const isPlaceholder = contracts.isPlaceholderAddress(address);
        const isKnown = contracts.isKnownToken(address);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              symbol: symbol.toUpperCase(),
              address,
              chainId,
              isPlaceholder,
              isKnown,
              warning: isPlaceholder ? "This is a placeholder address. Real address needed for actual transactions." : undefined
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching token address: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Get all supported tokens
  server.tool(
    "get_supported_tokens",
    "Get list of all supported tokens with their addresses",
    {
      chainId: z.number().optional().describe("Chain ID (default: 1329)")
    },
    async ({ chainId = 1329 }) => {
      try {
        const contracts = new ContractAddresses(chainId);
        const tokenContracts = contracts.getTokenContracts();
        
        const tokens = Object.entries(tokenContracts).map(([symbol, address]) => ({
          symbol,
          address,
          isPlaceholder: contracts.isPlaceholderAddress(address)
        }));

        const placeholderCount = tokens.filter(t => t.isPlaceholder).length;
        const realCount = tokens.length - placeholderCount;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              chainId,
              totalTokens: tokens.length,
              realAddresses: realCount,
              placeholderAddresses: placeholderCount,
              tokens
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching supported tokens: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Simple DEX status check
  server.tool(
    "check_dex_status",
    "Check basic status of DEX contracts",
    {
      chainId: z.number().optional().describe("Chain ID (default: 1329)")
    },
    async ({ chainId = 1329 }) => {
      try {
        const contracts = new ContractAddresses(chainId);
        
        const dexes = ["DragonSwap", "Sailor", "Yaka", "Oku"] as const;
        const status: any = {};
        
        for (const dex of dexes) {
          try {
            const dexContracts = contracts.getDexContracts(dex);
            status[dex] = {
              hasContracts: true,
              isPlaceholder: contracts.isPlaceholderAddress(dexContracts.router),
              contracts: dexContracts
            };
          } catch (error) {
            status[dex] = {
              hasContracts: false,
              error: error instanceof Error ? error.message : String(error)
            };
          }
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              chainId,
              dexStatus: status
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error checking DEX status: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Update contract address (for when you find real addresses)
  server.tool(
    "update_dex_contracts",
    "Update DEX contract addresses (for development use)",
    {
      dexName: z.string().describe("DEX name"),
      router: z.string().describe("Router contract address"),
      factory: z.string().describe("Factory contract address"),
      quoter: z.string().optional().describe("Quoter contract address (for V3-style DEXes)"),
      positionManager: z.string().optional().describe("Position manager address"),
      multicall: z.string().optional().describe("Multicall contract address"),
      chainId: z.number().optional().describe("Chain ID (default: 1329)")
    },
    async ({ dexName, router, factory, quoter, positionManager, multicall, chainId = 1329 }) => {
      try {
        const contracts = new ContractAddresses(chainId);
        
        // Validate addresses
        if (!contracts.isValidAddress(router)) {
          throw new Error(`Invalid router address: ${router}`);
        }
        if (!contracts.isValidAddress(factory)) {
          throw new Error(`Invalid factory address: ${factory}`);
        }

        const newContracts = {
          router: router as `0x${string}`,
          factory: factory as `0x${string}`,
          ...(quoter && { quoter: quoter as `0x${string}` }),
          ...(positionManager && { positionManager: positionManager as `0x${string}` }),
          ...(multicall && { multicall: multicall as `0x${string}` })
        };

        // This is a development tool - in production you'd update the static data
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              action: "Contract addresses ready for update",
              dexName,
              chainId,
              newContracts,
              instruction: "These addresses should be manually updated in src/dex/contracts/ContractAddresses.ts",
              codeSnippet: `ContractAddresses.updateDexContracts(${chainId}, "${dexName}", ${JSON.stringify(newContracts, null, 2)})`
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error updating DEX contracts: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );


  console.log("Contract tools registered successfully");
}