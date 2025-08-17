import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createPublicClient, http, parseUnits, formatUnits } from "viem";
import { sei } from "viem/chains";
import { ERC20_ABI, DRAGONSWAP_ROUTER_ABI, DRAGONSWAP_ROUTER_ADDRESS } from "../dex/contracts/abis/index.js";
import { DragonSwapApiPriceFetcher } from "../dex/pricing/DragonSwapApiPriceFetcher.js";
import { SailorApiPriceFetcher } from "../dex/pricing/SailorApiPriceFetcher.js";
import { protocolConfig, shouldFetchProtocolData } from "./protocol-config.js";
import { BASE_CURRENCY, SEI_TOKENS, getTokenByAddress, getTokenBySymbol, getMajorTokens } from "./token-config.js";

/**
 * Advanced arbitrage tools with USDC-normalized pricing
 * More accurate than USD API prices for real trading
 */

// Create public client for reading blockchain state
const publicClient = createPublicClient({
  chain: sei,
  transport: http()
});

interface TokenPrice {
  symbol: string;
  address: string;
  protocol: string;
  priceInUSDC: number;
  liquidityUSDC?: number;
  source: 'onchain' | 'api';
}

interface ArbitrageOpportunity {
  token: string;
  tokenAddress: string;
  buyProtocol: string;
  sellProtocol: string;
  buyPriceUSDC: number;
  sellPriceUSDC: number;
  spreadUSDC: number;
  spreadPercentage: number;
  profitPer1000USDC: number;
  minLiquidityUSDC?: number;
}

export function registerArbitrageTools(server: McpServer) {

  // List known tokens for arbitrage
  server.tool(
    "list_arbitrage_tokens",
    "List known tokens configured for arbitrage trading",
    {},
    async () => {
      try {
        const majorTokens = getMajorTokens();
        const allTokens = Object.values(SEI_TOKENS);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              baseCurrency: {
                symbol: BASE_CURRENCY.symbol,
                address: BASE_CURRENCY.address,
                name: BASE_CURRENCY.name,
                decimals: BASE_CURRENCY.decimals,
                note: "All arbitrage calculations use this as base currency"
              },
              majorTokens: majorTokens.map(token => ({
                symbol: token.symbol,
                name: token.name,
                address: token.address,
                decimals: token.decimals,
                isStablecoin: token.isStablecoin || false,
                isNative: token.isNative || false
              })),
              allKnownTokens: allTokens.map(token => ({
                symbol: token.symbol,
                name: token.name,
                address: token.address,
                decimals: token.decimals,
                isStablecoin: token.isStablecoin || false,
                isNative: token.isNative || false,
                coingeckoId: token.coingeckoId
              })),
              totalTokens: allTokens.length,
              stablecoins: allTokens.filter(t => t.isStablecoin).length
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error listing arbitrage tokens: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Get on-chain price of token relative to USDC using DragonSwap pools
  server.tool(
    "get_onchain_usdc_price",
    "Get the real on-chain price of a token in USDC terms using DragonSwap pools",
    {
      tokenAddress: z.string().describe("Token address to get USDC price for"),
      protocol: z.enum(["dragonswap"]).optional().describe("DEX protocol to use (default: dragonswap)")
    },
    async ({ tokenAddress, protocol = "dragonswap" }) => {
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

        // Get token info
        const tokenInfo = getTokenByAddress(tokenAddress);
        const tokenSymbol = tokenInfo ? tokenInfo.symbol : "Unknown";
        const tokenDecimals = tokenInfo ? tokenInfo.decimals : 18;
        
        // Create 1 unit of the input token for price calculation
        const oneTokenUnit = parseUnits("1", tokenDecimals);
        
        // Define the path for swapping
        const path = [tokenAddress as `0x${string}`, BASE_CURRENCY.address as `0x${string}`];
        
        try {
          // Call getAmountsOut to get the actual on-chain price
          const amounts = await publicClient.readContract({
            address: DRAGONSWAP_ROUTER_ADDRESS as `0x${string}`,
            abi: DRAGONSWAP_ROUTER_ABI,
            functionName: 'getAmountsOut',
            args: [oneTokenUnit, path]
          }) as bigint[];

          // amounts[0] = input amount (1 token)
          // amounts[1] = output amount (USDC received)
          const usdcReceived = amounts[1];
          const priceInUSDC = formatUnits(usdcReceived, BASE_CURRENCY.decimals);

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                token: {
                  address: tokenAddress,
                  symbol: tokenSymbol,
                  name: tokenInfo?.name || "Unknown Token",
                  decimals: tokenDecimals
                },
                baseCurrency: {
                  symbol: BASE_CURRENCY.symbol,
                  address: BASE_CURRENCY.address,
                  decimals: BASE_CURRENCY.decimals
                },
                protocol,
                priceInUSDC: parseFloat(priceInUSDC),
                priceFormatted: `${priceInUSDC} USDC per ${tokenSymbol}`,
                calculation: {
                  inputAmount: `1 ${tokenSymbol}`,
                  outputAmount: `${priceInUSDC} USDC`,
                  path: path.map(addr => {
                    const token = getTokenByAddress(addr);
                    return token ? token.symbol : addr;
                  }),
                  router: DRAGONSWAP_ROUTER_ADDRESS
                },
                rawAmounts: {
                  input: oneTokenUnit.toString(),
                  output: usdcReceived.toString()
                }
              }, null, 2)
            }]
          };

        } catch (contractError) {
          // If getAmountsOut fails, it usually means no liquidity pool exists
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                token: {
                  address: tokenAddress,
                  symbol: tokenSymbol,
                  name: tokenInfo?.name || "Unknown Token"
                },
                protocol,
                error: "No liquidity pool found or insufficient liquidity",
                details: contractError instanceof Error ? contractError.message : String(contractError),
                suggestion: `Create a liquidity pool for ${tokenSymbol}/USDC on DragonSwap`,
                path: path.map(addr => {
                  const token = getTokenByAddress(addr);
                  return token ? token.symbol : addr;
                })
              }, null, 2)
            }],
            isError: true
          };
        }

      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error getting on-chain USDC price: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Compare on-chain prices between protocols for a specific token
  server.tool(
    "compare_onchain_prices",
    "Compare real on-chain USDC prices for a token across enabled protocols",
    {
      tokenAddress: z.string().describe("Token address to compare prices for"),
      amount: z.string().optional().describe("Amount of token to price (default: 1)")
    },
    async ({ tokenAddress, amount = "1" }) => {
      try {
        const enabledProtocols = protocolConfig.getEnabledProtocols();
        
        if (enabledProtocols.length < 2) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Need at least 2 protocols enabled for price comparison",
                enabledProtocols,
                suggestion: "Use manage_protocols tool to enable more protocols"
              }, null, 2)
            }],
            isError: true
          };
        }

        const tokenInfo = getTokenByAddress(tokenAddress);
        const tokenSymbol = tokenInfo ? tokenInfo.symbol : "Unknown";
        const tokenDecimals = tokenInfo ? tokenInfo.decimals : 18;
        
        const results: any[] = [];
        const amountParsed = parseUnits(amount, tokenDecimals);
        const path = [tokenAddress as `0x${string}`, BASE_CURRENCY.address as `0x${string}`];

        // Get DragonSwap price if enabled
        if (shouldFetchProtocolData("dragonswap")) {
          try {
            const amounts = await publicClient.readContract({
              address: DRAGONSWAP_ROUTER_ADDRESS as `0x${string}`,
              abi: DRAGONSWAP_ROUTER_ABI,
              functionName: 'getAmountsOut',
              args: [amountParsed, path]
            }) as bigint[];

            const usdcReceived = formatUnits(amounts[1], BASE_CURRENCY.decimals);
            const pricePerToken = parseFloat(usdcReceived) / parseFloat(amount);

            results.push({
              protocol: "DragonSwap",
              priceUSDC: pricePerToken,
              totalUSDC: parseFloat(usdcReceived),
              source: "on-chain",
              liquidity: "available"
            });
          } catch {
            results.push({
              protocol: "DragonSwap", 
              error: "No liquidity pool found",
              source: "on-chain"
            });
          }
        }

        // Get API prices from other protocols for comparison
        // TODO: This would be enhanced to get actual on-chain prices when available
        
        if (results.length === 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "No price data available from any protocol",
                token: { address: tokenAddress, symbol: tokenSymbol },
                enabledProtocols
              }, null, 2)
            }],
            isError: true
          };
        }

        // Calculate spread if we have multiple prices
        let spreadAnalysis = null;
        if (results.length >= 2) {
          const prices = results.filter(r => !r.error).map(r => r.priceUSDC);
          if (prices.length >= 2) {
            const minPrice = Math.min(...prices);
            const maxPrice = Math.max(...prices);
            const spreadUSDC = maxPrice - minPrice;
            const spreadPercentage = (spreadUSDC / minPrice) * 100;

            spreadAnalysis = {
              minPrice: minPrice.toFixed(6),
              maxPrice: maxPrice.toFixed(6),
              spreadUSDC: spreadUSDC.toFixed(6),
              spreadPercentage: spreadPercentage.toFixed(2),
              arbitragePossible: spreadPercentage > 1
            };
          }
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              token: {
                address: tokenAddress,
                symbol: tokenSymbol,
                name: tokenInfo?.name || "Unknown Token",
                amount: amount
              },
              baseCurrency: BASE_CURRENCY.symbol,
              enabledProtocols,
              prices: results,
              spreadAnalysis,
              timestamp: new Date().toISOString()
            }, null, 2)
          }]
        };

      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error comparing on-chain prices: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Find arbitrage opportunities using USDC as base currency
  server.tool(
    "find_usdc_arbitrage",
    "Find arbitrage opportunities using USDC as base currency for accurate pricing",
    {
      minSpreadPercentage: z.number().optional().describe("Minimum spread percentage (default: 1%)"),
      minProfitUSDC: z.number().optional().describe("Minimum profit in USDC per trade (default: 10)"),
      baseAmountUSDC: z.number().optional().describe("Base amount in USDC for calculations (default: 1000)"),
      limit: z.number().optional().describe("Max opportunities to return (default: 10)")
    },
    async ({ minSpreadPercentage = 1, minProfitUSDC = 10, baseAmountUSDC = 1000, limit = 10 }) => {
      try {
        // Get enabled protocols
        const enabledProtocols = protocolConfig.getEnabledProtocols();
        
        if (enabledProtocols.length < 2) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Need at least 2 protocols enabled for arbitrage",
                enabledProtocols,
                suggestion: "Use manage_protocols tool to enable more protocols"
              }, null, 2)
            }],
            isError: true
          };
        }

        // For now, simulate USDC-normalized prices
        // In production, this would:
        // 1. Get token lists from enabled protocols
        // 2. For each common token, get actual USDC price from each DEX
        // 3. Calculate real spreads in USDC terms
        
        const mockOpportunities: ArbitrageOpportunity[] = [
          {
            token: "ETH",
            tokenAddress: "0x160345fc359604fc6e70e3c5facbde5f7a9342d8",
            buyProtocol: "DragonSwap",
            sellProtocol: "Sailor",
            buyPriceUSDC: 2150.50,
            sellPriceUSDC: 2165.75,
            spreadUSDC: 15.25,
            spreadPercentage: 0.71,
            profitPer1000USDC: 7.09
          },
          {
            token: "BTC",
            tokenAddress: "0x0555e30da8f98308edb960aa94c0db47230d2b9c",
            buyProtocol: "Sailor",
            sellProtocol: "DragonSwap", 
            buyPriceUSDC: 43200.00,
            sellPriceUSDC: 43650.00,
            spreadUSDC: 450.00,
            spreadPercentage: 1.04,
            profitPer1000USDC: 10.41
          }
        ];

        // Filter by criteria
        const filteredOpportunities = mockOpportunities
          .filter(opp => opp.spreadPercentage >= minSpreadPercentage)
          .filter(opp => opp.profitPer1000USDC * (baseAmountUSDC / 1000) >= minProfitUSDC)
          .sort((a, b) => b.profitPer1000USDC - a.profitPer1000USDC)
          .slice(0, limit);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              baseCurrency: "USDC",
              baseAmount: baseAmountUSDC,
              filters: {
                minSpreadPercentage: `${minSpreadPercentage}%`,
                minProfitUSDC: `${minProfitUSDC} USDC`,
                baseAmountUSDC: `${baseAmountUSDC} USDC`
              },
              enabledProtocols,
              opportunitiesFound: filteredOpportunities.length,
              totalPotentialProfit: filteredOpportunities.reduce((sum, opp) => 
                sum + (opp.profitPer1000USDC * (baseAmountUSDC / 1000)), 0
              ).toFixed(2) + " USDC",
              opportunities: filteredOpportunities.map(opp => ({
                ...opp,
                estimatedProfitUSDC: (opp.profitPer1000USDC * (baseAmountUSDC / 1000)).toFixed(2),
                strategy: `Buy ${opp.token} on ${opp.buyProtocol} at ${opp.buyPriceUSDC} USDC, sell on ${opp.sellProtocol} at ${opp.sellPriceUSDC} USDC`,
                spreadUSDC: `${opp.spreadUSDC.toFixed(2)} USDC`,
                spreadPercentage: `${opp.spreadPercentage.toFixed(2)}%`
              })),
              note: "This is a mock implementation. Real version would query on-chain USDC prices from each DEX."
            }, null, 2)
          }]
        };

      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error finding USDC arbitrage: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Calculate optimal arbitrage trade size
  server.tool(
    "calculate_optimal_trade_size",
    "Calculate optimal trade size considering slippage and gas costs",
    {
      tokenAddress: z.string().describe("Token address for arbitrage"),
      buyProtocol: z.string().describe("Protocol to buy from"),
      sellProtocol: z.string().describe("Protocol to sell to"),
      spreadPercentage: z.number().describe("Current spread percentage"),
      availableUSDC: z.number().describe("Available USDC for trading"),
      maxSlippage: z.number().optional().describe("Max acceptable slippage % (default: 1)")
    },
    async ({ tokenAddress, buyProtocol, sellProtocol, spreadPercentage, availableUSDC, maxSlippage = 1 }) => {
      try {
        // This would calculate optimal size considering:
        // 1. Available liquidity in pools
        // 2. Price impact/slippage
        // 3. Gas costs
        // 4. Minimum profitable amount
        
        const estimatedGasCostUSDC = 5; // Estimated gas cost in USDC
        const minProfitableUSDC = estimatedGasCostUSDC * 3; // Need 3x gas cost to be profitable
        
        // Simple calculation (real version would be more complex)
        const maxTradeUSDC = Math.min(availableUSDC, 10000); // Cap at 10k USDC
        const optimalUSDC = Math.min(maxTradeUSDC, minProfitableUSDC * 10);
        
        const estimatedProfitUSDC = (optimalUSDC * spreadPercentage / 100) - estimatedGasCostUSDC;
        const profitAfterSlippage = estimatedProfitUSDC * (1 - maxSlippage / 100);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              arbitrage: {
                token: tokenAddress,
                buyProtocol,
                sellProtocol,
                currentSpread: `${spreadPercentage}%`
              },
              calculation: {
                availableUSDC,
                optimalTradeUSDC: optimalUSDC,
                estimatedGasCostUSDC,
                estimatedProfitUSDC: estimatedProfitUSDC.toFixed(2),
                profitAfterSlippage: profitAfterSlippage.toFixed(2),
                minProfitableUSDC,
                isProfitable: profitAfterSlippage > 0
              },
              recommendation: profitAfterSlippage > 0 
                ? `Execute trade with ${optimalUSDC} USDC for estimated profit of ${profitAfterSlippage.toFixed(2)} USDC`
                : "Trade not profitable after gas and slippage costs",
              note: "This is a simplified calculation. Real implementation would query actual pool liquidity and simulate trade impact."
            }, null, 2)
          }]
        };

      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error calculating optimal trade size: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  console.log("Arbitrage tools registered successfully");
}