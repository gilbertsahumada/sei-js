import { parseUnits } from "viem";

export interface SailorQuoteRequest {
	sliprate: number; // 9000 = 90% (10% slippage)
	starttoken: string;
	endtoken: string;
	maxdepth: number; // 3 = max hops
	amount: string;
	tradetype: "EXACT_INPUT" | "EXACT_OUTPUT";
}

export interface SailorPoolHop {
	token_in: string;
	token_out: string;
	pool_id: string;
	amount_in: string;
	amount_out: string;
	price_impact: string;
	fee: string;
}

export interface SailorQuoteResponse {
	success: boolean;
	route: SailorPoolHop[];
	total_amount_in: string;
	total_amount_out: string;
	total_price_impact: string;
	total_fee: string;
	estimated_gas: string;
	slippage_tolerance: string;
	minimum_amount_out: string;
	maxPriorityFeePerGas?: string;
	maxFeePerGas?: string;
	error?: string;
}

export interface SailorSwapRequest {
	sliprate: number;
	starttoken: string;
	endtoken: string;
	amount: string;
	tradetype: "EXACT_INPUT" | "EXACT_OUTPUT";
	recipient: string;
	deadline?: number;
}

export interface SailorSwapResponse {
	success: boolean;
	calldata: string;
	to: string;
	value: string;
	gasLimit: string;
	error?: string;
}

export class SailorApiService {
	private static readonly QUOTE_API_BASE = "https://asia-southeast1-ktx-finance-2.cloudfunctions.net/sailor_routerapi";
	private static readonly SWAP_API_BASE = "https://asia-southeast1-ktx-finance-2.cloudfunctions.net/sailor_routerapi";

	static async getQuote(params: {
		tokenIn: string;
		tokenOut: string;
		amountIn: string;
		tokenInDecimals: number;
		slippage?: number;
		maxDepth?: number;
		timeoutMs?: number;
	}): Promise<SailorQuoteResponse> {
		const {
			tokenIn,
			tokenOut,
			amountIn,
			tokenInDecimals,
			slippage = 2.0,
			maxDepth = 3,
			timeoutMs = 15000
		} = params;

		const amountInWei = parseUnits(amountIn, tokenInDecimals);
		
		// Convert slippage percentage to sliprate (10000 = 100%, 9000 = 90% = 10% slippage)
		const sliprate = Math.floor((100 - slippage) * 100);
		
		console.log(`Sailor API: Converting amount`, {
			originalAmount: amountIn,
			tokenInDecimals,
			amountInWei: amountInWei.toString(),
			slippage: `${slippage}%`,
			sliprate,
			tokenIn,
			tokenOut
		});

		const quoteParams: SailorQuoteRequest = {
			sliprate,
			starttoken: tokenIn,
			endtoken: tokenOut,
			maxdepth: maxDepth,
			amount: amountInWei.toString(),
			tradetype: "EXACT_INPUT"
		};

		const url = new URL(`${this.QUOTE_API_BASE}/quote`);
		Object.entries(quoteParams).forEach(([key, value]) => {
			url.searchParams.append(key, value.toString());
		});

		console.log(`Sailor API: Request URL:`, url.toString());

		// Create AbortController for timeout
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		try {
			console.log(`Sailor API: Fetching quote with ${timeoutMs}ms timeout...`);
			const startTime = Date.now();
			
			const response = await fetch(url.toString(), {
				signal: controller.signal,
				headers: {
					'Accept': 'application/json',
					'Content-Type': 'application/json',
				}
			});
			
			const elapsedTime = Date.now() - startTime;
			console.log(`Sailor API: Response received in ${elapsedTime}ms`);
			
			clearTimeout(timeoutId);
			
			// NOTE: Sailor API returns an error when route doesn't exist
			if (!response.ok) {
				const errorText = await response.text().catch(() => 'Unknown error');
				console.error(`Sailor API error:`, {
					status: response.status,
					statusText: response.statusText,
					errorText,
					requestParams: quoteParams
				});
				
				throw new Error(`Sailor API error: ${response.status} ${response.statusText} - ${errorText}`);
			}

			const data: any = await response.json();
			
			/*
			console.log(`Sailor API: Quote successful for ${amountIn} ${tokenIn} -> ${tokenOut}`, {
				input: data.quote.input.amount,
				estimatedOutput: data.quote.output.amount,
				priceImpact: data.total_price_impact,
				routeHops: data.quote.route.length
			});
			*/

			// Transform response to match our interface  
			// Sailor API structure: data.quote.route[0] contains the actual route
			const quote = data.quote || {};
			const route = quote.route && quote.route.length > 0 ? quote.route[0] : [];
			
			console.log(`Sailor API: Raw response structure:`, {
				hasQuote: !!data.quote,
				hasRoute: !!(quote.route),
				routeLength: quote.route?.length || 0,
				firstRouteHops: route.length || 0,
				outputAmount: quote.output?.amount,
				inputAmount: quote.input?.amount
			});
			
			const sailorResponse: SailorQuoteResponse = {
				success: true,
				route: route || [],
				total_amount_in: quote.input?.amount?.toString() || amountInWei.toString(),
				total_amount_out: quote.output?.amount?.toString() || "0",
				total_price_impact: data.quote?.priceImpact?.toString() || "0",
				total_fee: data.quote?.total_fee_rate?.toString() || "0", 
				estimated_gas: data.quote?.gasEstimates?.length > 0 ? data.quote.gasEstimates[0] : "200000",
				slippage_tolerance: slippage.toString(),
				minimum_amount_out: quote.output?.amount ? (parseFloat(quote.output.amount) * (1 - slippage / 100)).toString() : "0",
				maxPriorityFeePerGas: data.quote?.maxPriorityFeePerGas || "2000000000", // Default 2 gwei
				maxFeePerGas: data.quote?.maxFeePerGas
			};

			return sailorResponse;
			
		} catch (error) {
			console.log(`Sailor API: Caught error`, error);
			clearTimeout(timeoutId);
			
			if (error instanceof Error) {
				if (error.name === 'AbortError') {
					throw new Error(`Sailor API timeout after ${timeoutMs}ms`);
				}
				throw new Error(`Sailor API error: ${error.message}`);
			}
			throw error;
		}
	}

	static async getSwapCalldata(params: {
		tokenIn: string;
		tokenOut: string;
		amountIn: string;
		tokenInDecimals: number;
		recipient: string;
		slippage?: number;
		deadline?: number;
		timeoutMs?: number;
	}): Promise<SailorSwapResponse> {
		const {
			tokenIn,
			tokenOut,
			amountIn,
			tokenInDecimals,
			recipient,
			slippage = 2.0,
			deadline = 1200,
			timeoutMs = 15000
		} = params;

		const amountInWei = parseUnits(amountIn, tokenInDecimals);
		const sliprate = Math.floor((100 - slippage) * 100);
		
		console.log(`Sailor API: Getting swap calldata`, {
			tokenIn,
			tokenOut,
			amountIn,
			recipient,
			slippage: `${slippage}%`,
			deadline
		});

		const swapParams: SailorSwapRequest = {
			sliprate,
			starttoken: tokenIn,
			endtoken: tokenOut,
			amount: amountInWei.toString(),
			tradetype: "EXACT_INPUT",
			recipient,
			deadline
		};

		const url = new URL(`${this.SWAP_API_BASE}/swap`);
		Object.entries(swapParams).forEach(([key, value]) => {
			if (value !== undefined) {
				url.searchParams.append(key, value.toString());
			}
		});

		console.log(`Sailor API: Swap request URL:`, url.toString());

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const startTime = Date.now();
			
			const response = await fetch(url.toString(), {
				signal: controller.signal,
				headers: {
					'Accept': 'application/json',
					'Content-Type': 'application/json',
				}
			});
			
			const elapsedTime = Date.now() - startTime;
			console.log(`Sailor API: Swap response received in ${elapsedTime}ms`);
			
			clearTimeout(timeoutId);
			
			if (!response.ok) {
				const errorText = await response.text().catch(() => 'Unknown error');
				console.error(`Sailor Swap API error:`, {
					status: response.status,
					statusText: response.statusText,
					errorText,
					requestParams: swapParams
				});
				
				throw new Error(`Sailor Swap API error: ${response.status} ${response.statusText} - ${errorText}`);
			}

			const data: any = await response.json();
			
			if (!data.success || data.error) {
				throw new Error(`Sailor swap preparation failed: ${data.error || 'Unknown error'}`);
			}
			
			console.log(`Sailor API: Swap calldata prepared successfully`);

			const sailorSwapResponse: SailorSwapResponse = {
				success: true,
				calldata: data.calldata || "0x",
				to: data.to || "",
				value: data.value || "0x0",
				gasLimit: data.gasLimit || "200000"
			};

			return sailorSwapResponse;
			
		} catch (error) {
			clearTimeout(timeoutId);
			
			if (error instanceof Error) {
				if (error.name === 'AbortError') {
					throw new Error(`Sailor Swap API timeout after ${timeoutMs}ms`);
				}
				throw new Error(`Sailor Swap API error: ${error.message}`);
			}
			throw error;
		}
	}

	static extractPathFromRoute(route: SailorPoolHop[]): string[] {
		if (!route || route.length === 0) {
			throw new Error("Invalid route");
		}

		const path: string[] = [];
		
		// Add first token
		path.push(route[0].token_in);

		// Add all output tokens
		for (const hop of route) {
			path.push(hop.token_out);
		}

		return path;
	}

	static calculateMinAmountOut(totalAmountOut: string, slippagePercent: number): string {
		const outputAmount = parseFloat(totalAmountOut);
		const minAmount = outputAmount * (1 - slippagePercent / 100);
		return minAmount.toString();
	}

	static formatRouteString(route: SailorPoolHop[]): string {
		if (!route || route.length === 0) {
			return "No route";
		}

		const tokens = route.map(hop => `${hop.token_in} -> ${hop.token_out}`);
		return tokens.join(" -> ");
	}
}