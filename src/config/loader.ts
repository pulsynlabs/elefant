/**
 * Config loader — discovers, parses, and validates configuration.
 *
 * Discovery order:
 * 1. ./elefant.config.ts (dynamic import)
 * 2. ./elefant.config.json (Bun.file().json())
 * 3. ~/.config/elefant/elefant.config.ts
 * 4. ~/.config/elefant/elefant.config.json
 *
 * Environment variables override config file values:
 * - ELEFANT_PORT → config.port
 * - ELEFANT_MODEL → default provider model
 * - ELEFANT_API_KEY → default provider apiKey
 * - ELEFANT_BASE_URL → default provider baseURL
 * - ELEFANT_DEFAULT_PROVIDER → config.defaultProvider
 */

import { z } from "zod";
import { configSchema, type ElefantConfig, type ProviderEntry } from "./schema.ts";
import type { Result } from "../types/result.ts";
import { ok, err } from "../types/result.ts";
import type { ElefantError } from "../types/errors.ts";
import { homedir } from "os";
import { join, resolve } from "path";

interface RawConfig {
	port?: number;
	providers?: ProviderEntry[];
	defaultProvider?: string;
	logLevel?: "debug" | "info" | "warn" | "error";
}

/**
 * Search paths for config files, in order of precedence.
 */
function getSearchPaths(): string[] {
	const home = homedir();
	return [
		"./elefant.config.ts",
		"./elefant.config.json",
		join(home, ".config", "elefant", "elefant.config.ts"),
		join(home, ".config", "elefant", "elefant.config.json"),
	];
}

/**
 * Check if a file exists and is readable.
 */
async function fileExists(path: string): Promise<boolean> {
	try {
		const file = Bun.file(path);
		await file.text();
		return true;
	} catch {
		return false;
	}
}

/**
 * Load a TypeScript config file via dynamic import.
 */
async function loadTsConfig(path: string): Promise<Result<RawConfig, ElefantError>> {
	try {
		// Resolve to absolute path for dynamic import
		const absolutePath = resolve(path);
		
		// Dynamic import for .ts files — Bun supports this natively
		const module = await import(absolutePath);
		
		// Support both default export and named `config` export
		const config = module.default ?? module.config;
		
		if (!config || typeof config !== "object") {
			return err({
				code: "CONFIG_INVALID",
				message: `Config file ${path} must export a config object (default export or named 'config' export)`,
			});
		}
		
		return ok(config as RawConfig);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return err({
			code: "CONFIG_INVALID",
			message: `Failed to load TypeScript config from ${path}: ${message}`,
		});
	}
}

/**
 * Load a JSON config file via Bun.file().json().
 */
async function loadJsonConfig(path: string): Promise<Result<RawConfig, ElefantError>> {
	try {
		const file = Bun.file(path);
		const config = await file.json();
		
		if (!config || typeof config !== "object") {
			return err({
				code: "CONFIG_INVALID",
				message: `Config file ${path} must contain a JSON object`,
			});
		}
		
		return ok(config as RawConfig);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return err({
			code: "CONFIG_INVALID",
			message: `Failed to load JSON config from ${path}: ${message}`,
		});
	}
}

/**
 * Discover and load the first available config file.
 */
async function discoverAndLoadConfig(): Promise<Result<RawConfig, ElefantError>> {
	const searchPaths = getSearchPaths();
	
	for (const path of searchPaths) {
		if (await fileExists(path)) {
			if (path.endsWith(".ts")) {
				return loadTsConfig(path);
			} else if (path.endsWith(".json")) {
				return loadJsonConfig(path);
			}
		}
	}
	
	return err({
		code: "CONFIG_INVALID",
		message: "No elefant.config.ts or elefant.config.json found in project root or ~/.config/elefant/",
	});
}

/**
 * Apply environment variable overrides to the config.
 * Env vars always win over config file values.
 */
function applyEnvOverrides(config: RawConfig): RawConfig {
	const result: RawConfig = { ...config };
	
	// ELEFANT_PORT → config.port
	if (process.env.ELEFANT_PORT) {
		const port = parseInt(process.env.ELEFANT_PORT, 10);
		if (!isNaN(port)) {
			result.port = port;
		}
	}
	
	// ELEFANT_DEFAULT_PROVIDER → config.defaultProvider
	if (process.env.ELEFANT_DEFAULT_PROVIDER) {
		result.defaultProvider = process.env.ELEFANT_DEFAULT_PROVIDER;
	}
	
	// Provider-specific overrides apply to the first provider (default provider)
	if (result.providers && result.providers.length > 0) {
		const defaultProvider = result.providers[0];
		const updatedProvider: ProviderEntry = { ...defaultProvider };
		
		// ELEFANT_MODEL → default provider model
		if (process.env.ELEFANT_MODEL) {
			updatedProvider.model = process.env.ELEFANT_MODEL;
		}
		
		// ELEFANT_API_KEY → default provider apiKey
		if (process.env.ELEFANT_API_KEY) {
			updatedProvider.apiKey = process.env.ELEFANT_API_KEY;
		}
		
		// ELEFANT_BASE_URL → default provider baseURL
		if (process.env.ELEFANT_BASE_URL) {
			updatedProvider.baseURL = process.env.ELEFANT_BASE_URL;
		}
		
		// Replace the first provider with updated values
		result.providers = [updatedProvider, ...result.providers.slice(1)];
	}
	
	return result;
}

/**
 * Format Zod validation errors into human-readable strings.
 */
function formatZodErrors(error: z.ZodError): string {
	return error.issues
		.map((e) => `${e.path.join(".")}: ${e.message}`)
		.join(", ");
}

/**
 * Load, merge, and validate configuration.
 *
 * @returns Result containing validated ElefantConfig or ElefantError
 */
export async function loadConfig(): Promise<Result<ElefantConfig, ElefantError>> {
	// Step 1: Discover and load config file
	const loadResult = await discoverAndLoadConfig();
	if (!loadResult.ok) {
		return loadResult;
	}
	
	const rawConfig = loadResult.data;
	
	// Step 2: Apply environment variable overrides
	const mergedConfig = applyEnvOverrides(rawConfig);
	
	// Step 3: Validate with Zod
	const parseResult = configSchema.safeParse(mergedConfig);
	
	if (!parseResult.success) {
		const formattedError = formatZodErrors(parseResult.error);
		return err({
			code: "CONFIG_INVALID",
			message: formattedError,
		});
	}
	
	return ok(parseResult.data);
}
