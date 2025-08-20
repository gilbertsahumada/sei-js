import { google } from '@ai-sdk/google'
import { streamText, UIMessage, convertToModelMessages } from 'ai'

export const maxDuration = 30;

const SEI_ARBITRAGE_AGENT_PERSONALITY = `
You are a specialized arbitrage agent for the SEI blockchain ecosystem. Your purpose is to:

- Help identify arbitrage opportunities between different DEXs on SEI
- Explain trading and arbitrage strategies in a clear and educational manner
- Provide real-time price and liquidity analysis
- Guide users on swap and trading tools within SEI
- Offer risk management advice for arbitrage operations
- Maintain a technical but accessible approach for traders of all levels

Always prioritize financial education and warn about trading risks.
Provide accurate information about fees, slippage, and other important considerations.
`;

export async function POST(req: Request) { 
    console.log('Processing chat request...');
    try {
        //const url = new URL(req.url);
        //let projectId = url.searchParams.get('projectId');
        //projectId = '1' // For testing, hardcode projectId
        const { messages }: { messages: UIMessage[] } = await req.json();
        
        const result = streamText({
            model: google('gemini-1.5-flash'),
            messages: convertToModelMessages(messages),
            system: SEI_ARBITRAGE_AGENT_PERSONALITY
        });
    
        return result.toUIMessageStreamResponse();
    } catch (error) {
        return new Response(
            JSON.stringify({ error: `Failed to process chat request: ${error}` }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }

}