import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SailorTokens } from "../dex/tokens/index.js";
import { DragonSwapApiPriceFetcher } from "../dex/pricing/DragonSwapApiPriceFetcher.js";
import { SailorApiPriceFetcher } from "../dex/pricing/SailorApiPriceFetcher.js";
import { YakaFinanceApiPriceFetcher } from "../dex/pricing/YakaFinanceApiPriceFetcher.js";
import { protocolConfig, shouldFetchProtocolData } from "./protocol-config.js";

/**
 * Register token-related tools with the MCP server
 */
export function registerTokenTools(server: McpServer) {  
  console.log("🔧 Registering token tools...");
  // Get tokens with prices from DragonSwap API (SIMPLE VERSION)
  server.tool(
    "get_dragonswap_prices",
    "Get DragonSwap tokens with real-time prices from their API",
    {
      limit: z.number().optional().describe("Max number of tokens to return (default: 20)"),
      minPrice: z.number().optional().describe("Minimum price in USD (default: 0)")
    },
    async ({ limit = 20, minPrice = 0 }) => {
      try {
        if (!shouldFetchProtocolData("dragonswap")) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "DragonSwap protocol is disabled",
                suggestion: "Use manage_protocols tool to enable DragonSwap"
              }, null, 2)
            }],
            isError: true
          };
        }
        
        const fetcher = new DragonSwapApiPriceFetcher();
        
        // Get all tokens from API
        const allTokens = await fetcher.getAllTokens();
        
        // Apply filters and sorting
        const filtered = allTokens
          .filter((token: any) => token.usd_price >= minPrice)
          .sort((a: any, b: any) => b.usd_price - a.usd_price) // Sort by price descending
          .slice(0, limit);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              protocol: "DragonSwap",
              source: "Official API (/tokens endpoint)",
              totalTokens: allTokens.length,
              tokensShown: filtered.length,
              tokens: filtered.map((token: any) => ({
                symbol: token.symbol,
                name: token.name,
                address: token.address,
                decimals: token.decimals,
                priceUsd: token.usd_price,
                liquidity: token.liquidity,
                change24h: `${token.change.daily.toFixed(2)}%`,
                changeWeekly: `${token.change.weekly.toFixed(2)}%`
              }))
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching DragonSwap prices: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Search DragonSwap tokens
  server.tool(
    "search_dragonswap_tokens",
    "Search DragonSwap tokens by symbol or name",
    {
      query: z.string().describe("Search query (token symbol or name)"),
      limit: z.number().optional().describe("Max number of results (default: 10)")
    },
    async ({ query, limit = 10 }) => {
      try {
        if (!shouldFetchProtocolData("dragonswap")) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "DragonSwap protocol is disabled",
                suggestion: "Use manage_protocols tool to enable DragonSwap"
              }, null, 2)
            }],
            isError: true
          };
        }

        const fetcher = new DragonSwapApiPriceFetcher();
        const results = await fetcher.searchTokens(query);
        
        const limited = results.slice(0, limit);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              query,
              resultsFound: results.length,
              resultsShown: limited.length,
              tokens: limited.map((token: any) => ({
                symbol: token.symbol,
                name: token.name,
                address: token.address,
                priceUsd: token.usd_price,
                liquidity: token.liquidity,
                change24h: `${token.change.daily.toFixed(2)}%`
              }))
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error searching DragonSwap tokens: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Get tokens with prices from Yaka Finance API (SIMPLE VERSION)
  server.tool(
    "get_yaka_prices",
    "Get Yaka Finance tokens with real-time prices from their API",
    {
      limit: z.number().optional().describe("Max number of tokens to return (default: 20)"),
      minPrice: z.number().optional().describe("Minimum price in USD (default: 0)")
    },
    async ({ limit = 20, minPrice = 0 }) => {
      try {
        if (!shouldFetchProtocolData("yaka")) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Yaka Finance protocol is disabled",
                suggestion: "Use manage_protocols tool to enable Yaka Finance"
              }, null, 2)
            }],
            isError: true
          };
        }

        const fetcher = new YakaFinanceApiPriceFetcher();
        
        // Get all tokens from API
        const allTokens = await fetcher.getAllTokens();
        
        // Apply filters and sorting
        const filtered = allTokens
          .filter(token => token.price >= minPrice)
          .sort((a, b) => b.price - a.price) // Sort by price descending
          .slice(0, limit);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              protocol: "Yaka Finance",
              source: "Official API (/api/v1/assets)",
              totalTokens: allTokens.length,
              tokensShown: filtered.length,
              tokens: filtered.map((token: any) => ({
                symbol: token.symbol,
                name: token.name,
                address: token.address,
                decimals: token.decimals,
                priceUsd: token.price,
                riskScore: token.riskScore,
                hasLogo: !!token.logoURI,
                logoURI: token.logoURI
              }))
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching Yaka Finance prices: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Search Yaka Finance tokens
  server.tool(
    "search_yaka_tokens",
    "Search Yaka Finance tokens by symbol or name",
    {
      query: z.string().describe("Search query (token symbol or name)"),
      limit: z.number().optional().describe("Max number of results (default: 10)")
    },
    async ({ query, limit = 10 }) => {
      try {
        if (!shouldFetchProtocolData("yaka")) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Yaka Finance protocol is disabled",
                suggestion: "Use manage_protocols tool to enable Yaka Finance"
              }, null, 2)
            }],
            isError: true
          };
        }

        const fetcher = new YakaFinanceApiPriceFetcher();
        const results = await fetcher.searchTokens(query);
        
        const limited = results.slice(0, limit);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              query,
              resultsFound: results.length,
              resultsShown: limited.length,
              tokens: limited.map((token: any) => ({
                symbol: token.symbol,
                name: token.name,
                address: token.address,
                priceUsd: token.price,
                riskScore: token.riskScore,
                hasLogo: !!token.logoURI
              }))
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error searching Yaka Finance tokens: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Get Sailor tokens with prices from their API
  server.tool(
    "get_sailor_prices",
    "Get Sailor Finance tokens with real-time prices from their API",
    {
      limit: z.number().optional().describe("Max number of tokens to return (default: 20)"),
      minPrice: z.number().optional().describe("Minimum price in USD (default: 0)"),
      debug: z.boolean().optional().describe("Show debug info (default: false)")
    },
    async ({ limit = 20, minPrice = 0, debug = false }) => {
      try {
        if (!shouldFetchProtocolData("sailor")) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Sailor Finance protocol is disabled",
                suggestion: "Use manage_protocols tool to enable Sailor Finance"
              }, null, 2)
            }],
            isError: true
          };
        }

        const sailorTokens = new SailorTokens(1329);
        const tokensWithMetadata = await sailorTokens.getTokensWithMetadata();
        
        if (debug) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                debug: true,
                totalTokensFromAPI: tokensWithMetadata.tokens.length,
                metadata: tokensWithMetadata.metadata,
                sampleTokens: tokensWithMetadata.tokens.slice(0, 3).map((token: any) => ({
                  symbol: token.symbol,
                  name: token.name,
                  address: token.address,
                  priceUsd: token.priceUsd,
                  volume24h: token.volume24h,
                  liquidityUsd: token.liquidityUsd,
                  allFields: Object.keys(token)
                }))
              }, null, 2)
            }]
          };
        }
        
        // Filter and sort by price
        const filtered = tokensWithMetadata.tokens
          .filter((token: any) => token.priceUsd && token.priceUsd >= minPrice)
          .sort((a: any, b: any) => (b.priceUsd || 0) - (a.priceUsd || 0))
          .slice(0, limit);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              protocol: "Sailor",
              totalTokensWithPrices: filtered.length,
              totalTokensFromAPI: tokensWithMetadata.tokens.length,
              metadata: tokensWithMetadata.metadata,
              tokens: filtered.map((token: any) => ({
                symbol: token.symbol,
                name: token.name,
                address: token.address,
                decimals: token.decimals,
                priceUsd: token.priceUsd,
                volume24h: token.volume24h,
                liquidityUsd: token.liquidityUsd,
                isVerified: token.isVerified
              }))
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching Sailor prices: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Find tokens that exist across enabled Protocols (DragonSwap, Yaka Finance, and Sailor Finance for arbitrage)
  server.tool(
    "find_common_tokens",
    "Find tokens that exist across DragonSwap, Yaka Finance, and Sailor Finance APIs",
    {
      minPrice: z.number().optional().describe("Minimum price in USD (default: 0)"),
      limit: z.number().optional().describe("Max number of tokens to return (default: 50)")
    },
    async ({ minPrice = 0, limit = 50 }) => {
      try {

        const enabledProtocols = protocolConfig.getEnabledProtocols();
        
        if (enabledProtocols.length < 2) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Need at least 2 protocols enabled for arbitrage comparison",
                enabledProtocols,
                disabledProtocols: protocolConfig.getDisabledProtocols(),
                suggestion: "Use manage_protocols tool to enable more protocols"
              }, null, 2)
            }],
            isError: true
          };
        }

        const fetchPromises: Promise<any>[] = [];
        const protocolNames: string[] = [];

        if (shouldFetchProtocolData("dragonswap")) {
          const dragonFetcher = new DragonSwapApiPriceFetcher();
          fetchPromises.push(dragonFetcher.getAllTokens());
          protocolNames.push("dragonswap");
        }

        if (shouldFetchProtocolData("yaka")) {
          const yakaFetcher = new YakaFinanceApiPriceFetcher();
          fetchPromises.push(yakaFetcher.getAllTokens());
          protocolNames.push("yaka");
        }

        if (shouldFetchProtocolData("sailor")) {
          const sailorFetcher = new SailorApiPriceFetcher();
          fetchPromises.push(sailorFetcher.getAllTokens());
          protocolNames.push("sailor");
        }

        const results = await Promise.all(fetchPromises);
        
        // Map results to protocol names
        const protocolData: {[key: string]: any[]} = {};
        results.forEach((data, index) => {
          protocolData[protocolNames[index]] = data;
        });

        const dragonTokens = protocolData.dragonswap || [];
        const yakaTokens = protocolData.yaka || [];
        const sailorTokens = protocolData.sailor || [];

        // Find common tokens by symbol (case insensitive) across all three protocols
        const commonTokens: any[] = [];
        
        dragonTokens.forEach((dragonToken: any) => {
          const yakaToken = yakaTokens.find((yt: any) => 
            yt.symbol.toLowerCase() === dragonToken.symbol.toLowerCase()
          );
          const sailorToken = sailorTokens.find((st: any) => 
            st.symbol.toLowerCase() === dragonToken.symbol.toLowerCase()
          );
          
          // Only include if token exists in at least 2 protocols and meets price criteria
          const hasYaka = yakaToken && yakaToken.price >= minPrice;
          const hasSailor = sailorToken && parseFloat(sailorToken.price) >= minPrice;
          const hasDragon = dragonToken.usd_price >= minPrice;
          
          if (hasDragon && (hasYaka || hasSailor)) {
            const prices = [dragonToken.usd_price];
            if (hasYaka) prices.push(yakaToken.price);
            if (hasSailor) prices.push(parseFloat(sailorToken.price));
            
            const minPrice = Math.min(...prices);
            const maxPrice = Math.max(...prices);
            const priceSpread = ((maxPrice - minPrice) / minPrice * 100).toFixed(2);
            
            commonTokens.push({
              symbol: dragonToken.symbol,
              dragonSwap: {
                address: dragonToken.address,
                price: dragonToken.usd_price,
                liquidity: dragonToken.liquidity,
                name: dragonToken.name,
                change24h: dragonToken.change.daily
              },
              yakaFinance: hasYaka ? {
                address: yakaToken.address,
                price: yakaToken.price,
                riskScore: yakaToken.riskScore,
                name: yakaToken.name
              } : null,
              sailor: hasSailor ? {
                address: sailorToken.id,
                price: parseFloat(sailorToken.price),
                dailyChange: parseFloat(sailorToken.dailychange),
                symbol: sailorToken.symbol
              } : null,
              priceSpread: parseFloat(priceSpread),
              priceRange: { min: minPrice, max: maxPrice },
              availableIn: [
                'DragonSwap',
                ...(hasYaka ? ['YakaFinance'] : []),
                ...(hasSailor ? ['Sailor'] : [])
              ]
            });
          }
        });

        // Sort by price spread descending (highest arbitrage opportunity first)
        commonTokens.sort((a, b) => b.priceSpread - a.priceSpread);
        
        const limited = commonTokens.slice(0, limit);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              enabledProtocols,
              disabledProtocols: protocolConfig.getDisabledProtocols(),
              summary: {
                totalCommonTokens: commonTokens.length,
                tokensShown: limited.length,
                protocolCounts: {
                  dragonSwap: dragonTokens.length,
                  yakaFinance: yakaTokens.length,
                  sailor: sailorTokens.length
                }
              },
              commonTokens: limited.map(token => ({
                symbol: token.symbol,
                priceSpread: `${token.priceSpread.toFixed(2)}%`,
                priceRange: {
                  min: `$${token.priceRange.min.toFixed(6)}`,
                  max: `$${token.priceRange.max.toFixed(6)}`
                },
                availableIn: token.availableIn,
                protocols: {
                  dragonSwap: {
                    price: `$${token.dragonSwap.price.toFixed(6)}`,
                    liquidity: token.dragonSwap.liquidity,
                    change24h: `${token.dragonSwap.change24h.toFixed(2)}%`,
                    address: token.dragonSwap.address
                  },
                  yakaFinance: token.yakaFinance ? {
                    price: `$${token.yakaFinance.price.toFixed(6)}`,
                    riskScore: token.yakaFinance.riskScore,
                    address: token.yakaFinance.address
                  } : null,
                  sailor: token.sailor ? {
                    price: `$${token.sailor.price.toFixed(6)}`,
                    dailyChange: `${token.sailor.dailyChange.toFixed(2)}%`,
                    address: token.sailor.address
                  } : null
                }
              }))
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error finding common tokens: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Find arbitrage opportunities with minimum spread filter
  server.tool(
    "find_arbitrage_opportunities",
    "Find tokens with price differences between DragonSwap, Yaka Finance, and Sailor Finance (arbitrage opportunities)",
    {
      minSpread: z.number().optional().describe("Minimum price spread percentage (default: 2%)"),
      minPrice: z.number().optional().describe("Minimum token price in USD (default: 0.01)"),
      limit: z.number().optional().describe("Max number of opportunities to return (default: 20)")
    },
    async ({ minSpread = 2, minPrice = 0.01, limit = 20 }) => {
      try {
        // Check which protocols are enabled
        const enabledProtocols = protocolConfig.getEnabledProtocols();
        
        if (enabledProtocols.length < 2) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Need at least 2 protocols enabled for arbitrage opportunities",
                enabledProtocols,
                disabledProtocols: protocolConfig.getDisabledProtocols(),
                suggestion: "Use manage_protocols tool to enable more protocols"
              }, null, 2)
            }],
            isError: true
          };
        }

        // Fetch data only from enabled protocols
        const fetchPromises: Promise<any>[] = [];
        const protocolNames: string[] = [];

        if (shouldFetchProtocolData("dragonswap")) {
          const dragonFetcher = new DragonSwapApiPriceFetcher();
          fetchPromises.push(dragonFetcher.getAllTokens());
          protocolNames.push("dragonswap");
        }

        if (shouldFetchProtocolData("yaka")) {
          const yakaFetcher = new YakaFinanceApiPriceFetcher();
          fetchPromises.push(yakaFetcher.getAllTokens());
          protocolNames.push("yaka");
        }

        if (shouldFetchProtocolData("sailor")) {
          const sailorFetcher = new SailorApiPriceFetcher();
          fetchPromises.push(sailorFetcher.getAllTokens());
          protocolNames.push("sailor");
        }

        const results = await Promise.all(fetchPromises);
        
        // Map results to protocol names
        const protocolData: {[key: string]: any[]} = {};
        results.forEach((data, index) => {
          protocolData[protocolNames[index]] = data;
        });

        const dragonTokens = protocolData.dragonswap || [];
        const yakaTokens = protocolData.yaka || [];
        const sailorTokens = protocolData.sailor || [];

        const arbitrageOpportunities: any[] = [];
        
        dragonTokens.forEach((dragonToken: any) => {
          const yakaToken = yakaTokens.find((yt: any) => 
            yt.symbol.toLowerCase() === dragonToken.symbol.toLowerCase()
          );
          const sailorToken = sailorTokens.find((st: any) => 
            st.symbol.toLowerCase() === dragonToken.symbol.toLowerCase()
          );
          
          // Collect available prices
          const prices: Array<{protocol: string, price: number, token: any}> = [];
          
          if (dragonToken.usd_price >= minPrice) {
            prices.push({protocol: "DragonSwap", price: dragonToken.usd_price, token: dragonToken});
          }
          if (yakaToken && yakaToken.price >= minPrice) {
            prices.push({protocol: "YakaFinance", price: yakaToken.price, token: yakaToken});
          }
          if (sailorToken && parseFloat(sailorToken.price) >= minPrice) {
            prices.push({protocol: "Sailor", price: parseFloat(sailorToken.price), token: sailorToken});
          }
          
          // Need at least 2 protocols to compare
          if (prices.length >= 2) {
            // Find min and max prices
            const sortedPrices = prices.sort((a, b) => a.price - b.price);
            const cheapest = sortedPrices[0];
            const mostExpensive = sortedPrices[sortedPrices.length - 1];
            
            const priceDiff = mostExpensive.price - cheapest.price;
            const spreadPercentage = (priceDiff / cheapest.price) * 100;
            
            if (spreadPercentage >= minSpread) {
              const profitPerToken = priceDiff;
              const profitPercentage = (profitPerToken / cheapest.price) * 100;

              // Build token data object
              const tokenData: any = {};
              prices.forEach(p => {
                if (p.protocol === "DragonSwap") {
                  tokenData.dragonSwap = {
                    price: p.price.toFixed(6),
                    liquidity: p.token.liquidity,
                    address: p.token.address,
                    change24h: p.token.change?.daily
                  };
                } else if (p.protocol === "YakaFinance") {
                  tokenData.yakaFinance = {
                    price: p.price.toFixed(6),
                    riskScore: p.token.riskScore,
                    address: p.token.address
                  };
                } else if (p.protocol === "Sailor") {
                  tokenData.sailor = {
                    price: p.price.toFixed(6),
                    dailyChange: parseFloat(p.token.dailychange),
                    address: p.token.id
                  };
                }
              });

              arbitrageOpportunities.push({
                symbol: dragonToken.symbol,
                spreadPercentage: spreadPercentage.toFixed(2),
                profitPerToken: profitPerToken.toFixed(6),
                profitPercentage: profitPercentage.toFixed(2),
                strategy: {
                  buyOn: cheapest.protocol,
                  sellOn: mostExpensive.protocol,
                  buyPrice: cheapest.price.toFixed(6),
                  sellPrice: mostExpensive.price.toFixed(6)
                },
                availableProtocols: prices.map(p => p.protocol),
                tokenData
              });
            }
          }
        });

        // Sort by profit percentage descending
        arbitrageOpportunities.sort((a, b) => parseFloat(b.profitPercentage) - parseFloat(a.profitPercentage));
        
        const limited = arbitrageOpportunities.slice(0, limit);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              enabledProtocols,
              disabledProtocols: protocolConfig.getDisabledProtocols(),
              protocols: enabledProtocols,
              filters: {
                minSpread: `${minSpread}%`,
                minPrice: `$${minPrice}`,
                limit
              },
              summary: {
                tokensAnalyzed: {
                  dragonSwap: dragonTokens.length,
                  yakaFinance: yakaTokens.length,
                  sailor: sailorTokens.length
                },
                opportunitiesFound: arbitrageOpportunities.length,
                opportunitiesShown: limited.length
              },
              totalPotentialProfit: limited.length > 0 ? 
                `${limited.reduce((sum, opp) => sum + parseFloat(opp.profitPercentage), 0).toFixed(2)}% combined` : "0%",
              opportunities: limited.map(opp => ({
                ...opp,
                availableProtocols: opp.availableProtocols,
                protocolCount: opp.availableProtocols.length
              }))
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error finding arbitrage opportunities: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Get tokens with prices from Sailor Finance API
  server.tool(
    "get_sailor_api_prices",
    "Get token prices from Sailor Finance API with daily changes",
    {
      tokenAddresses: z.array(z.string()).optional().describe("Specific token addresses to get prices for"),
      limit: z.number().optional().describe("Max number of tokens to return (default: 20)")
    },
    async ({ tokenAddresses, limit = 20 }) => {
      try {
        if (!shouldFetchProtocolData("sailor")) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Sailor Finance protocol is disabled",
                suggestion: "Use manage_protocols tool to enable Sailor Finance"
              }, null, 2)
            }],
            isError: true
          };
        }
        
        const fetcher = new SailorApiPriceFetcher();
        
        let tokens;
        if (tokenAddresses && tokenAddresses.length > 0) {
          //console.log(`Fetching prices for ${tokenAddresses.length} specific tokens...`);
          tokens = await fetcher.getTokenPrices(tokenAddresses);
        } else {
          //console.log(`Fetching prices for all tokens (limit: ${limit})...`);
          tokens = await fetcher.getAllTokens();
        }
        
        // Sort by price descending and limit
        const sortedTokens = tokens
          .sort((a: any, b: any) => parseFloat(b.price) - parseFloat(a.price))
          .slice(0, limit);

        // Get market stats
        const stats = await fetcher.getMarketStats();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              protocol: "Sailor Finance",
              source: "Official Price API",
              tokensShown: sortedTokens.length,
              totalTokens: tokens.length,
              marketStats: {
                totalTokens: stats.totalTokens,
                avgPrice: `$${stats.avgPrice.toFixed(6)}`,
                priceRange: `$${stats.priceRange.min.toFixed(6)} - $${stats.priceRange.max.toFixed(2)}`,
                avgDailyChange: `${stats.avgDailyChange.toFixed(2)}%`,
                topGainer: stats.topGainers[0] ? `${stats.topGainers[0].symbol} (+${stats.topGainers[0].dailychange}%)` : "N/A",
                topLoser: stats.topLosers[0] ? `${stats.topLosers[0].symbol} (${stats.topLosers[0].dailychange}%)` : "N/A"
              },
              tokens: sortedTokens.map((token: any) => ({
                symbol: token.symbol,
                price: `$${parseFloat(token.price).toFixed(6)}`,
                dailyChange: `${parseFloat(token.dailychange).toFixed(2)}%`,
                address: token.id,
                priceNumeric: parseFloat(token.price),
                dailyChangeNumeric: parseFloat(token.dailychange)
              }))
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching Sailor prices: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  console.log("Token tools registered successfully");
}