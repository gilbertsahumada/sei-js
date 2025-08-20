import { PublicClient, encodeFunctionData, decodeFunctionResult, Address } from "viem";
import { ContractAddresses } from "../dex/contracts/ContractAddresses.js";

export interface MulticallCall {
	target: Address;
	allowFailure: boolean;
	callData: `0x${string}`;
}

export interface MulticallResult {
	success: boolean;
	returnData: `0x${string}`;
}

export interface TokenInfo {
	decimals: number;
	symbol: string;
	name?: string;
}

const MULTICALL3_ABI = [
	{
		inputs: [
			{
				components: [
					{ internalType: "address", name: "target", type: "address" },
					{ internalType: "bool", name: "allowFailure", type: "bool" },
					{ internalType: "bytes", name: "callData", type: "bytes" }
				],
				internalType: "struct Multicall3.Call3[]",
				name: "calls",
				type: "tuple[]"
			}
		],
		name: "aggregate3",
		outputs: [
			{
				components: [
					{ internalType: "bool", name: "success", type: "bool" },
					{ internalType: "bytes", name: "returnData", type: "bytes" }
				],
				internalType: "struct Multicall3.Result[]",
				name: "returnData",
				type: "tuple[]"
			}
		],
		stateMutability: "payable",
		type: "function"
	}
] as const;

const ERC20_ABI = [
	{
		inputs: [],
		name: "decimals",
		outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
		stateMutability: "view",
		type: "function"
	},
	{
		inputs: [],
		name: "symbol",
		outputs: [{ internalType: "string", name: "", type: "string" }],
		stateMutability: "view",
		type: "function"
	},
	{
		inputs: [],
		name: "name",
		outputs: [{ internalType: "string", name: "", type: "string" }],
		stateMutability: "view",
		type: "function"
	},
	{
		inputs: [{ internalType: "address", name: "account", type: "address" }],
		name: "balanceOf",
		outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
		stateMutability: "view",
		type: "function"
	},
	{
		inputs: [
			{ internalType: "address", name: "owner", type: "address" },
			{ internalType: "address", name: "spender", type: "address" }
		],
		name: "allowance",
		outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
		stateMutability: "view",
		type: "function"
	}
] as const;

export class MulticallService {
	private publicClient: PublicClient;
	private multicall3Address: Address;

	constructor(publicClient: PublicClient, chainId: number = 1329) {
		this.publicClient = publicClient;
		const contractAddresses = new ContractAddresses(chainId);
		this.multicall3Address = contractAddresses.getMulticall3Address();
	}

	async batchCall(calls: MulticallCall[]): Promise<MulticallResult[]> {
		const results = await this.publicClient.readContract({
			address: this.multicall3Address,
			abi: MULTICALL3_ABI,
			functionName: 'aggregate3',
			args: [calls]
		}) as MulticallResult[];

		return results;
	}

	createERC20Call(tokenAddress: Address, functionName: 'decimals' | 'symbol' | 'name'): MulticallCall {
		const callData = encodeFunctionData({
			abi: ERC20_ABI,
			functionName,
			args: []
		});

		return {
			target: tokenAddress,
			allowFailure: false,
			callData
		};
	}

	createERC20BalanceCall(tokenAddress: Address, accountAddress: Address): MulticallCall {
		const callData = encodeFunctionData({
			abi: ERC20_ABI,
			functionName: 'balanceOf',
			args: [accountAddress]
		});

		return {
			target: tokenAddress,
			allowFailure: false,
			callData
		};
	}

	createERC20AllowanceCall(tokenAddress: Address, ownerAddress: Address, spenderAddress: Address): MulticallCall {
		const callData = encodeFunctionData({
			abi: ERC20_ABI,
			functionName: 'allowance',
			args: [ownerAddress, spenderAddress]
		});

		return {
			target: tokenAddress,
			allowFailure: false,
			callData
		};
	}

	decodeERC20Result(result: MulticallResult, functionName: 'decimals' | 'symbol' | 'name' | 'balanceOf' | 'allowance'): any {
		if (!result.success) {
			throw new Error(`Multicall failed for ${functionName}`);
		}

		return decodeFunctionResult({
			abi: ERC20_ABI,
			functionName,
			data: result.returnData
		});
	}

	async getTokensInfo(tokenAddresses: Address[]): Promise<Record<Address, TokenInfo>> {
		const calls: MulticallCall[] = [];
		
		// Create calls for each token: decimals, symbol, name
		for (const tokenAddress of tokenAddresses) {
			calls.push(
				this.createERC20Call(tokenAddress, 'decimals'),
				this.createERC20Call(tokenAddress, 'symbol'),
				this.createERC20Call(tokenAddress, 'name')
			);
		}

		const results = await this.batchCall(calls);
		const tokensInfo: Record<Address, TokenInfo> = {};

		// Process results (3 calls per token)
		for (let i = 0; i < tokenAddresses.length; i++) {
			const tokenAddress = tokenAddresses[i];
			const decimalsResult = results[i * 3];
			const symbolResult = results[i * 3 + 1];
			const nameResult = results[i * 3 + 2];

			try {
				const decimals = this.decodeERC20Result(decimalsResult, 'decimals') as number;
				const symbol = this.decodeERC20Result(symbolResult, 'symbol') as string;
				const name = this.decodeERC20Result(nameResult, 'name') as string;

				tokensInfo[tokenAddress] = {
					decimals,
					symbol,
					name
				};
			} catch (error) {
				console.warn(`Failed to decode token info for ${tokenAddress}:`, error);
				// Set defaults for failed calls
				tokensInfo[tokenAddress] = {
					decimals: 18,
					symbol: 'UNKNOWN',
					name: 'Unknown Token'
				};
			}
		}

		return tokensInfo;
	}

	async getTokenBasicInfo(tokenIn: Address, tokenOut: Address): Promise<{
		tokenInDecimals: number;
		tokenOutDecimals: number;
		tokenInSymbol: string;
		tokenOutSymbol: string;
	}> {
		const tokensInfo = await this.getTokensInfo([tokenIn, tokenOut]);
		
		return {
			tokenInDecimals: tokensInfo[tokenIn].decimals,
			tokenOutDecimals: tokensInfo[tokenOut].decimals,
			tokenInSymbol: tokensInfo[tokenIn].symbol,
			tokenOutSymbol: tokensInfo[tokenOut].symbol
		};
	}

	async getSwapInfo(tokenIn: Address, tokenOut: Address, accountAddress: Address, spenderAddress: Address): Promise<{
		tokenInDecimals: number;
		tokenOutDecimals: number;
		tokenInSymbol: string;
		tokenOutSymbol: string;
		tokenInName: string;
		tokenOutName: string;
		balance: bigint;
		allowance: bigint;
	}> {
		const calls: MulticallCall[] = [
			// Token in info
			this.createERC20Call(tokenIn, 'decimals'),
			this.createERC20Call(tokenIn, 'symbol'),
			this.createERC20Call(tokenIn, 'name'),
			
			// Token out info  
			this.createERC20Call(tokenOut, 'decimals'),
			this.createERC20Call(tokenOut, 'symbol'),
			this.createERC20Call(tokenOut, 'name'),
			
			// Balance and allowance for tokenIn
			this.createERC20BalanceCall(tokenIn, accountAddress),
			this.createERC20AllowanceCall(tokenIn, accountAddress, spenderAddress)
		];

		const results = await this.batchCall(calls);

		try {
			const tokenInDecimals = this.decodeERC20Result(results[0], 'decimals') as number;
			const tokenInSymbol = this.decodeERC20Result(results[1], 'symbol') as string;
			const tokenInName = this.decodeERC20Result(results[2], 'name') as string;
			
			const tokenOutDecimals = this.decodeERC20Result(results[3], 'decimals') as number;
			const tokenOutSymbol = this.decodeERC20Result(results[4], 'symbol') as string;
			const tokenOutName = this.decodeERC20Result(results[5], 'name') as string;
			
			const balance = this.decodeERC20Result(results[6], 'balanceOf') as bigint;
			const allowance = this.decodeERC20Result(results[7], 'allowance') as bigint;

			return {
				tokenInDecimals,
				tokenOutDecimals,
				tokenInSymbol,
				tokenOutSymbol,
				tokenInName,
				tokenOutName,
				balance,
				allowance
			};
		} catch (error) {
			console.warn(`Failed to decode swap info:`, error);
			throw new Error(`Failed to get swap info: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}