import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface PackageInfo {
	name: string;
	version: string;
	description: string;
}

let cachedPackageInfo: PackageInfo | null = null;

export const getPackageInfo = (): PackageInfo => {
	if (cachedPackageInfo) {
		return cachedPackageInfo;
	}

	// Try multiple possible paths for package.json
	const possiblePaths = [
		join(__dirname, '../../../package.json'), // from dist/esm/server/
		join(__dirname, '../../../../package.json'), // from dist/esm/server/ alternative
		join(__dirname, '../../package.json'), // from src/server/ when not compiled
		join(__dirname, '../../../..', 'package.json'), // alternative path
		join(process.cwd(), 'package.json'), // current working directory
		join(process.cwd(), 'packages/mcp-server/package.json'), // from monorepo root
	];

	for (const packageJsonPath of possiblePaths) {
		try {
			console.log(`🔍 Trying to read package.json from: ${packageJsonPath}`);
			const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
			
			cachedPackageInfo = {
				name: packageJson.name || 'sei-mcp-server',
				version: packageJson.version || '0.0.0',
				description: packageJson.description || 'Sei MCP Server'
			};

			console.log(`✅ Successfully loaded package info from: ${packageJsonPath}`);
			return cachedPackageInfo;
		} catch (error) {
			console.log(`❌ Failed to read from ${packageJsonPath}: ${error instanceof Error ? error.message : error}`);
			continue;
		}
	}

	console.error('❌ Could not find package.json in any expected location, using fallback values');
	// Fallback values
	cachedPackageInfo = {
		name: 'sei-mcp-server',
		version: '0.0.0',
		description: 'Sei MCP Server'
	};
	
	return cachedPackageInfo;
};
