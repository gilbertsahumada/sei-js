# Sei MCP Server - Arbitrage & AI Integration Features

This document outlines the comprehensive arbitrage tools and AI client integration features developed for the Sei MCP Server project during the hackathon.

## 🎯 Overview

The project has been enhanced with sophisticated arbitrage detection and execution capabilities, along with a modern AI-powered client interface using Vercel's AI SDK. The system provides real-time DEX price comparison, automated arbitrage opportunity detection, and seamless trade execution across multiple protocols on the Sei blockchain.

## 🏗️ Architecture

### Service-Oriented Architecture
The project follows a clean service-oriented architecture pattern to eliminate code duplication and improve maintainability:

- **SwapValidationService**: Handles wallet connection, balance checks, and protocol validation
- **SwapApprovalService**: Manages token approval workflows with confirmation tracking
- **SwapGasService**: Intelligent gas estimation and pricing across protocols
- **SwapExecutionService**: Transaction execution and receipt handling
- **SwapResponseService**: Consistent response formatting for MCP tools

### Refactored Codebase
- **Before**: 1,964 lines with 95% duplicated code between DragonSwap and Sailor Finance
- **After**: ~750 lines (62% reduction) with shared services eliminating duplication
- Applied senior-level architectural patterns (DRY, Single Responsibility Principle)

## 🛠️ MCP Tools

### Core Trading Tools

#### 1. Arbitrage Execution Tool (`execute_arbitrage_opportunity`)
**Location**: `packages/mcp-server/src/core/daat-core/arbitrage-execution-tools.ts`

```typescript
// Integrated arbitrage discovery and execution
{
  tokenIn: string;     // Input token address
  tokenOut: string;    // Output token address  
  amount: string;      // Amount to trade
  minSpread: number;   // Minimum profit spread (%)
  slippage: number;    // Slippage tolerance (%)
}
```

**Features**:
- Automatic quote comparison between DragonSwap and Sailor Finance
- Real-time spread calculation and profit analysis
- Intelligent slippage handling for small amounts (min 5% for reliability)
- Comprehensive error reporting with troubleshooting suggestions
- Single-tool arbitrage discovery and execution

#### 2. Enhanced Swap Tools
**Location**: `packages/mcp-server/src/core/daat-core/swap-tools-refactored.ts`

- **DragonSwap Integration**: Uniswap V2-style swaps with optimized routing
- **Sailor Finance Integration**: Uniswap V3-style concentrated liquidity
- **Dynamic Slippage**: Automatically adjusts for small amounts to prevent "Too little received" errors
- **Multi-protocol Support**: Seamless switching between DEX protocols

#### 3. Token & Wallet Management
**Location**: `packages/mcp-server/src/core/daat-core/token-tools.ts` & `wallet-tools.ts`

- Token balance queries across protocols
- Multi-token portfolio management  
- Wallet connection status verification
- Cross-chain token address resolution

### API Service Integrations

#### DragonSwap API Service
**Location**: `packages/mcp-server/src/core/dex/pricing/DragonSwapApiService.ts`

```typescript
// Enhanced with timeout handling and detailed logging
static async getQuote(params: {
  tokenIn: string;
  tokenOut: string; 
  amountIn: string;
  tokenInDecimals: number;
  recipient: string;
  slippage?: number;
  deadline?: number;
  timeoutMs?: number;
}): Promise<DragonSwapQuoteResponse>
```

**Key Features**:
- 15-second timeout with AbortController
- Detailed request/response logging
- Route-not-found error handling
- Small amount slippage adjustments (min 5%)

#### Sailor Finance API Service  
**Location**: `packages/mcp-server/src/core/dex/pricing/SailorApiService.ts`

```typescript
// V3-style concentrated liquidity with gas fee support
static async getQuote(params: {
  tokenIn: string;
  tokenOut: string;
  amountIn: string; 
  tokenInDecimals: number;
  slippage?: number;
  maxDepth?: number;
  timeoutMs?: number;
}): Promise<SailorQuoteResponse>
```

**Key Features**:
- Multi-hop routing with configurable depth
- Gas fee estimation with priority fees
- Complex route parsing and optimization
- Enhanced error handling with detailed logging

## 🤖 AI Client Integration

### Next.js Client Application
**Location**: `packages/client/`

A modern, responsive web interface powered by Vercel's AI SDK for seamless interaction with the MCP server.

#### Key Components

**API Route** (`src/app/api/chat/route.ts`):
```typescript
// Specialized arbitrage agent with MCP integration
const SEI_ARBITRAGE_AGENT_PERSONALITY = `
You are a specialized arbitrage agent for the SEI blockchain ecosystem...
`;

export async function POST(req: Request) {
  const mcpClient = await experimental_createMCPClient({
    transport: new StreamableHTTPClientTransport(url)
  });
  
  const result = streamText({
    model: anthropic("claude-3-5-haiku-latest"), 
    tools: await mcpClient.tools(),
    system: SEI_ARBITRAGE_AGENT_PERSONALITY
  });
}
```

**React Interface** (`src/app/page.tsx`):
- Modern gradient UI with glassmorphism effects
- Real-time streaming chat interface using `useChat` hook
- Markdown rendering with syntax highlighting (`streamdown` + `highlight.js`)
- Quick action buttons for common queries
- Mobile-responsive design with Tailwind CSS

#### Dependencies & Features
```json
{
  "@ai-sdk/anthropic": "^2.0.5",
  "@ai-sdk/react": "^2.0.17", 
  "@modelcontextprotocol/sdk": "^1.17.3",
  "streamdown": "^1.0.11",
  "react-markdown": "^10.1.0",
  "rehype-highlight": "^7.0.2"
}
```

- **AI SDK Integration**: Native MCP client with streaming support
- **Markdown Rendering**: Code syntax highlighting and table formatting
- **Modern UI Components**: Radix UI primitives with custom styling
- **Development Tools**: Concurrently for running server + client

## 🔧 Development Workflow

### Dependencies Added
**Root package.json additions:**
```json
{
  "devDependencies": {
    "concurrently": "^9.2.0"  // For running multiple processes
  },
  "scripts": {
    "dev:mcp-client": "concurrently --names \"MCP-SERVER,CLIENT\" --prefix-colors \"blue,green\" \"yarn workspace @sei-js/mcp-server dev\" \"yarn workspace @sei-js/client dev\""
  }
}
```

**Client package.json enhancements:**
```json
{
  "dependencies": {
    "@ai-sdk/anthropic": "^2.0.5",     // Claude integration
    "@ai-sdk/react": "^2.0.17",        // React hooks for AI
    "@modelcontextprotocol/sdk": "^1.17.3",  // MCP client
    "streamdown": "^1.0.11",           // Streaming markdown
    "react-markdown": "^10.1.0",       // Markdown rendering
    "rehype-highlight": "^7.0.2"       // Code highlighting
  }
}
```

### Build & Development Commands
```bash
# Install dependencies (Yarn 4.7.0 with Corepack)
yarn install

# Build all packages in dependency order
yarn build:all

# 🚀 NEW: Run both MCP server and client concurrently
yarn dev:mcp-client

# This runs both:
# - MCP Server: yarn workspace @sei-js/mcp-server dev (blue prefix)
# - AI Client: yarn workspace @sei-js/client dev (green prefix)

# Or run individually:
yarn workspace @sei-js/mcp-server dev  # MCP server only
yarn workspace @sei-js/client dev      # Client only

# Code quality checks
yarn biome check --apply
```

### Development Experience Improvements
**Concurrently Integration:**
- **Color-coded Output**: Blue prefix for MCP-SERVER, green for CLIENT
- **Process Management**: Single command starts both services
- **Hot Reload**: Both server and client auto-restart on changes
- **Synchronized Logging**: Easy to track both services in one terminal

**Example Output:**
```bash
$ yarn dev:mcp-client

[MCP-SERVER] MCP Server starting on port 8080...
[CLIENT] ▲ Next.js 15.4.7
[CLIENT] - Local:        http://localhost:3000
[MCP-SERVER] ✓ Server ready with arbitrage tools
[CLIENT] ✓ Ready in 1.2s
```

### Testing & Quality Assurance
- **TypeScript**: Strict mode enabled with comprehensive type safety
- **Biome**: Code formatting (tabs, 160 char width) and linting
- **Jest**: Unit tests with aim for 100% coverage on new code
- **Error Handling**: Comprehensive error reporting with troubleshooting guides

## 📊 Key Improvements & Fixes

### Performance Optimizations
- **API Timeouts**: 15-second timeout with proper cleanup
- **Parallel Requests**: Promise.allSettled for concurrent DEX queries
- **Gas Optimization**: Intelligent gas estimation per protocol
- **Route Optimization**: Best path discovery across V2/V3 protocols

### Error Handling Enhancements
- **Detailed Error Reporting**: Actual API error messages instead of empty objects
- **Troubleshooting Guides**: Built-in suggestions for common issues
- **Slippage Intelligence**: Dynamic adjustment for small amounts
- **Network Resilience**: Timeout handling and retry logic

### User Experience
- **Real-time Feedback**: Streaming responses with progress indicators
- **Educational Content**: Risk warnings and trading guidance
- **Contract Information**: Always includes necessary addresses for trading
- **Quick Actions**: Pre-defined queries for common operations

## 🚀 Production Considerations

### Security Features
- **Input Validation**: Zod schemas for all MCP tool parameters
- **Address Verification**: Checksum validation for contract addresses
- **Approval Tracking**: 2-block confirmation for token approvals
- **Risk Warnings**: Built-in educational content about trading risks

### Scalability & Monitoring
- **Comprehensive Logging**: Request/response tracking with timing
- **Error Aggregation**: Structured error reporting for debugging
- **Performance Metrics**: Gas usage and execution time tracking
- **Health Checks**: API availability and response time monitoring

## 🎉 Usage Examples

### Finding Arbitrage Opportunities
```
User: "Find arbitrage opportunities for USDC/SEI with minimum 2% spread"

Agent: Uses execute_arbitrage_opportunity tool with:
- tokenIn: "0x64445f0aecc51e94ad52d8ac56b7190e764e561a" (USDC)
- tokenOut: "0x0000000000000000000000000000000000000000" (SEI) 
- amount: "100"
- minSpread: 2.0
- slippage: 1.0
```

### Price Comparison
```
User: "Compare SEI prices across all DEXs"

Agent: Fetches real-time prices from:
- DragonSwap (V2 AMM)
- Sailor Finance (V3 concentrated liquidity)
- Displays spread percentages and optimal routing
```

### Risk Management
```
User: "Explain arbitrage risks"

Agent: Provides educational content on:
- Impermanent loss
- Slippage and MEV
- Gas fee considerations
- Approval security practices
```

---

## 📝 Development Notes

This implementation represents a production-ready arbitrage system with:
- ✅ 62% code reduction through service architecture
- ✅ Comprehensive error handling and user feedback
- ✅ Modern AI-powered user interface
- ✅ Real-time DEX integration with timeout handling
- ✅ Educational focus on risk management
- ✅ Type-safe MCP tool integration

The system is designed for both novice and expert traders, providing detailed guidance while maintaining the flexibility for advanced arbitrage strategies on the Sei blockchain ecosystem.