import { parseUnits } from "viem";

export interface DragonSwapQuoteRequest {
	amount: string;
	tokenInAddress: string;
	tokenOutAddress: string;
	type: "exactIn" | "exactOut";
	recipient: string;
	deadline: number;
	slippage: number;
	protocols: string;
	intent: "swap" | "quote";
	user?: string;
}

export interface DragonSwapPoolInfo {
	type: string;
	address: string;
	tokenIn: {
		chainId: number;
		decimals: string;
		address: string;
		symbol: string;
	};
	tokenOut: {
		chainId: number;
		decimals: string;
		address: string;
		symbol: string;
	};
	reserve0?: {
		token: {
			chainId: number;
			decimals: string;
			address: string;
			symbol: string;
		};
		quotient: string;
	};
	reserve1?: {
		token: {
			chainId: number;
			decimals: string;
			address: string;
			symbol: string;
		};
		quotient: string;
	};
	amountIn?: string;
	amountOut?: string;
}

export interface DragonSwapQuoteResponse {
	methodParameters: {
		calldata: string;
		value: string;
		to: string;
	};
	blockNumber: string;
	amount: string;
	amountDecimals: string;
	quote: string;
	quoteDecimals: string;
	quoteGasAdjusted: string;
	quoteGasAdjustedDecimals: string;
	gasUseEstimateQuote: string;
	gasUseEstimateQuoteDecimals: string;
	gasUseEstimate: string;
	gasUseEstimateUSD: string;
	gasPriceWei: string;
	route: DragonSwapPoolInfo[][];
	routeString: string;
	hitsCachedRoutes: boolean;
	priceImpact: string;
}

export class DragonSwapApiService {
	private static readonly API_BASE_URL = "https://sei-api.dragonswap.app/api/v1";

	static async getQuote(params: {
		tokenIn: string;
		tokenOut: string;
		amountIn: string;
		tokenInDecimals: number;
		recipient: string;
		slippage?: number;
		deadline?: number;
		timeoutMs?: number;
	}): Promise<DragonSwapQuoteResponse> {
		const {
			tokenIn,
			tokenOut,
			amountIn,
			tokenInDecimals,
			recipient,
			slippage = 0.5,
			deadline = 1200,
			timeoutMs = 12000
		} = params;

		const amountInWei = parseUnits(amountIn, tokenInDecimals);
		
		console.log(`DragonSwap API: Converting amount`, {
			originalAmount: amountIn,
			tokenInDecimals,
			amountInWei: amountInWei.toString(),
			tokenIn,
			tokenOut
		});

		const quoteParams: DragonSwapQuoteRequest = {
			amount: amountInWei.toString(),
			tokenInAddress: tokenIn,
			tokenOutAddress: tokenOut,
			type: "exactIn",
			recipient,
			deadline,
			slippage,
			protocols: "v2,v3",
			intent: "swap",
			user: "mcp-server"
		};

		const url = new URL(`${this.API_BASE_URL}/quote`);
		Object.entries(quoteParams).forEach(([key, value]) => {
			url.searchParams.append(key, value.toString());
		});

		console.log(`DragonSwap API: Request URL:`, url.toString());

		// Create AbortController for timeout
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		try {
			console.log(`DragonSwap API: Fetching quote with ${timeoutMs}ms timeout...`);
			const startTime = Date.now();
			
			const response = await fetch(url.toString(), {
				signal: controller.signal,
				headers: {
					'Accept': 'application/json',
					'Content-Type': 'application/json',
				}
			});
			
			const elapsedTime = Date.now() - startTime;
			console.log(`DragonSwap API: Response received in ${elapsedTime}ms`);
			
			clearTimeout(timeoutId);
			
			if (!response.ok) {
				const errorText = await response.text().catch(() => 'Unknown error');
				console.error(`DragonSwap API error:`, {
					status: response.status,
					statusText: response.statusText,
					errorText,
					requestParams: quoteParams
				});
				throw new Error(`DragonSwap API error: ${response.status} ${response.statusText} - ${errorText}`);
			}

			const data = await response.json() as DragonSwapQuoteResponse;
			console.log(`DragonSwap API: Quote successful for ${amountIn} ${tokenIn} -> ${tokenOut}`, {
				estimatedOutput: data.quoteDecimals,
				priceImpact: data.priceImpact,
				route: data.routeString
			});
			return data;
			
		} catch (error) {
			clearTimeout(timeoutId);
			
			if (error instanceof Error) {
				if (error.name === 'AbortError') {
					throw new Error(`DragonSwap API timeout after ${timeoutMs}ms`);
				}
				throw new Error(`DragonSwap API error: ${error.message}`);
			}
			throw error;
		}
	}

	static extractPathFromRoute(route: DragonSwapPoolInfo[][]): string[] {
		if (route.length === 0 || route[0].length === 0) {
			throw new Error("Invalid route");
		}

		// Get the first route option
		const routePath = route[0];
		const path: string[] = [];

		// Add first token
		path.push(routePath[0].tokenIn.address);

		// Add intermediate and final tokens
		for (const pool of routePath) {
			path.push(pool.tokenOut.address);
		}

		return path;
	}

	static calculateMinAmountOut(quoteDecimals: string, slippagePercent: number): string {
		const quote = parseFloat(quoteDecimals);
		const minAmount = quote * (1 - slippagePercent / 100);
		return minAmount.toString();
	}
}