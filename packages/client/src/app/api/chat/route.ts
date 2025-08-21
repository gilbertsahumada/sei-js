import { google } from "@ai-sdk/google";
import { anthropic } from "@ai-sdk/anthropic";
import { streamText, UIMessage, convertToModelMessages, stepCountIs } from "ai";
import {
    experimental_createMCPClient,
    experimental_MCPClient as MCPClient,
} from "ai";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

export const maxDuration = 30;

const SEI_ARBITRAGE_AGENT_PERSONALITY = `
You are a specialized arbitrage agent for the SEI blockchain ecosystem. Your purpose is to:

- Help identify arbitrage opportunities between different DEXs on SEI
- Explain trading and arbitrage strategies in a clear and educational manner
- Provide real-time price and liquidity analysis
- Guide users on swap and trading tools within SEI
- Offer risk management advice for arbitrage operations
- Maintain a technical but accessible approach for traders of all levels

CRITICAL TOOL USAGE RULES:
When users ask about ARBITRAGE OPPORTUNITIES specifically:
→ ALWAYS use find_arbitrage_opportunities tool FIRST and ONLY
→ DO NOT call individual price tools (get_dragonswap_prices, get_sailor_prices, get_yaka_prices)
→ The arbitrage tool already fetches all necessary prices and compares them

When users ask about INDIVIDUAL TOKEN PRICES or MARKET DATA:
→ Then use specific price tools: get_dragonswap_prices, get_sailor_prices, get_yaka_prices
→ Use get_token_balance or get_balance for account balances
→ Use dragonswap_quote for specific swap quotes

When users ask about ARBITRAGE, OPPORTUNITIES, SPREADS, or PRICE DIFFERENCES:
→ Use find_arbitrage_opportunities with appropriate minSpread (e.g., 1 for 1%, 2 for 2%)
→ This tool is optimized for arbitrage analysis and contains all necessary data

CRITICAL OUTPUT REQUIREMENTS FOR ARBITRAGE:
When showing arbitrage opportunities, you MUST ALWAYS include:
- Contract addresses for each protocol (dragonSwap.address, yakaFinance.address, sailor.address)
- Token symbols and prices on each DEX
- Spread percentages and profit calculations
- Clear buy/sell strategy with specific DEX names
- DO NOT summarize or omit contract addresses - users need them for trading

ALWAYS use the available tools when users ask questions that require real-time blockchain data.
Do not provide generic responses when you can fetch actual data using the tools.

Always prioritize financial education and warn about trading risks.
Provide accurate information about fees, slippage, and other important considerations.

FINAL REMINDER: When you call find_arbitrage_opportunities, you MUST include ALL contract addresses from the tool response in your answer. Users cannot trade without these addresses. Show them in a clear, organized format.
`;

export async function POST(req: Request) {
    console.log("Processing chat request...");
    try {
        let tools = {};
        let mcpClient: MCPClient;
        let mcpInitialized = false;

        try {
            console.log(">>> Creating MCP client <<<");
            const url = new URL("http://localhost:8080/mcp");

            mcpClient = await experimental_createMCPClient({
                transport: new StreamableHTTPClientTransport(url, {
                    sessionId: "session_123",
                }),
            });

            tools = await mcpClient.tools();
            mcpInitialized = true;
        } catch (error) {
            console.log("Failed to create MCP client:", error);
        }

        console.log(">>> MCP client created successfully <<<");

        const { messages }: { messages: UIMessage[] } = await req.json();

        const result = streamText({
            model: anthropic("claude-3-5-haiku-latest"),
            messages: convertToModelMessages(messages),
            system: SEI_ARBITRAGE_AGENT_PERSONALITY,
            tools: mcpInitialized ? tools : {},
            stopWhen: stepCountIs(5),
            maxRetries: 3,
        });

        console.log("Chat request processed successfully");

        return result.toUIMessageStreamResponse();
    } catch (error) {
        console.error("Error processing chat request:", error);
        return new Response(
            JSON.stringify({ error: `Failed to process chat request: ${error}` }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}
