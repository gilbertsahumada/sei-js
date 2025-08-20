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

IMPORTANT: You have access to powerful tools for blockchain interactions. When users ask about:
- Token prices → use get_token_price or get_dragonswap_prices
- Account balances → use get_token_balance or get_balance
- DEX quotes → use dragonswap_quote
- Swap execution → use dragonswap_swap
- Documentation → use search_docs or search_sei_js_docs

ALWAYS use the available tools when users ask questions that require real-time blockchain data.
Do not provide generic responses when you can fetch actual data using the tools.

Always prioritize financial education and warn about trading risks.
Provide accurate information about fees, slippage, and other important considerations.
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

        console.log(tools)

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
