/**
 * Tests for config loader.
 *
 * @module src/config/loader.test
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig } from "./loader.ts";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("loadConfig", () => {
	let tempDir: string;
	let originalCwd: string;
	let originalEnv: NodeJS.ProcessEnv;
	let homeConfigDir: string;

	beforeEach(() => {
		// Save original state
		originalCwd = process.cwd();
		originalEnv = { ...process.env };
		
		// Create temp directory for test configs
		tempDir = mkdtempSync(join(tmpdir(), "elefant-config-test-"));
		
		// Set up a mock home directory for ~/.config/elefant/ tests
		homeConfigDir = join(tempDir, "home", ".config", "elefant");
		mkdirSync(homeConfigDir, { recursive: true });
		
		// Change to temp directory
		process.chdir(tempDir);
		
		// Clear relevant env vars
		delete process.env.ELEFANT_PORT;
		delete process.env.ELEFANT_MODEL;
		delete process.env.ELEFANT_API_KEY;
		delete process.env.ELEFANT_BASE_URL;
		delete process.env.ELEFANT_DEFAULT_PROVIDER;
	});

	afterEach(() => {
		// Restore original state
		process.chdir(originalCwd);
		Object.assign(process.env, originalEnv);
		
		// Clean up temp directory
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	describe("JSON config loading", () => {
		it("should load and validate a valid JSON config", async () => {
			const config = {
				port: 8080,
				providers: [
					{
						name: "openai",
						baseURL: "https://api.openai.com/v1",
						apiKey: "sk-test-key",
						model: "gpt-4",
						format: "openai",
					},
				],
				defaultProvider: "openai",
				logLevel: "info",
			};
			
			writeFileSync(
				join(tempDir, "elefant.config.json"),
				JSON.stringify(config, null, 2)
			);
			
			const result = await loadConfig();
			
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.port).toBe(8080);
				expect(result.data.defaultProvider).toBe("openai");
				expect(result.data.providers).toHaveLength(1);
				expect(result.data.providers[0].apiKey).toBe("sk-test-key");
			}
		});

		it("should return error for invalid JSON format", async () => {
			writeFileSync(
				join(tempDir, "elefant.config.json"),
				"not valid json {{{"
			);
			
			const result = await loadConfig();
			
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("CONFIG_INVALID");
				expect(result.error.message).toContain("Failed to load JSON config");
			}
		});

		it("should return error for JSON config with missing required fields", async () => {
			const config = {
				port: 8080,
				// Missing providers and defaultProvider
			};
			
			writeFileSync(
				join(tempDir, "elefant.config.json"),
				JSON.stringify(config, null, 2)
			);
			
			const result = await loadConfig();
			
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("CONFIG_INVALID");
				expect(result.error.message).toContain("providers");
			}
		});
	});

	describe("TypeScript config loading", () => {
		it("should load and validate a valid TS config with default export", async () => {
			const tsConfig = `
export default {
  port: 9090,
  providers: [
    {
      name: "anthropic",
      baseURL: "https://api.anthropic.com",
      apiKey: "sk-ant-test",
      model: "claude-3-sonnet",
      format: "anthropic",
    },
  ],
  defaultProvider: "anthropic",
  logLevel: "debug",
};
`;
			
			writeFileSync(join(tempDir, "elefant.config.ts"), tsConfig);
			
			const result = await loadConfig();
			
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.port).toBe(9090);
				expect(result.data.defaultProvider).toBe("anthropic");
				expect(result.data.logLevel).toBe("debug");
				expect(result.data.providers[0].model).toBe("claude-3-sonnet");
			}
		});

		it("should load and validate a valid TS config with named export", async () => {
			const tsConfig = `
export const config = {
  port: 7070,
  providers: [
    {
      name: "openai",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-3.5-turbo",
      format: "openai",
    },
  ],
  defaultProvider: "openai",
};
`;
			
			writeFileSync(join(tempDir, "elefant.config.ts"), tsConfig);
			
			const result = await loadConfig();
			
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.port).toBe(7070);
			}
		});

		it("should return error for TS config without valid export", async () => {
			const tsConfig = `
const someOtherVar = { foo: "bar" };
`;
			
			writeFileSync(join(tempDir, "elefant.config.ts"), tsConfig);
			
			const result = await loadConfig();
			
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("CONFIG_INVALID");
				expect(result.error.message).toContain("must export a config object");
			}
		});
	});

	describe("config file discovery precedence", () => {
		it("should prefer project root TS config over JSON", async () => {
			const tsConfig = `
export default {
  port: 1111,
  providers: [{ name: "test", baseURL: "http://test", apiKey: "key", model: "m", format: "openai" }],
  defaultProvider: "test",
};
`;
			const jsonConfig = {
				port: 2222,
				providers: [{ name: "test", baseURL: "http://test", apiKey: "key", model: "m", format: "openai" }],
				defaultProvider: "test",
			};
			
			writeFileSync(join(tempDir, "elefant.config.ts"), tsConfig);
			writeFileSync(
				join(tempDir, "elefant.config.json"),
				JSON.stringify(jsonConfig, null, 2)
			);
			
			const result = await loadConfig();
			
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.port).toBe(1111); // TS config wins
			}
		});

		it("should prefer project root JSON over home directory config", async () => {
			// Create config in home directory
			const homeConfig = {
				port: 3333,
				providers: [{ name: "test", baseURL: "http://test", apiKey: "key", model: "m", format: "openai" }],
				defaultProvider: "test",
			};
			
			// Create config in project root
			const projectConfig = {
				port: 4444,
				providers: [{ name: "test", baseURL: "http://test", apiKey: "key", model: "m", format: "openai" }],
				defaultProvider: "test",
			};
			
			writeFileSync(
				join(homeConfigDir, "elefant.config.json"),
				JSON.stringify(homeConfig, null, 2)
			);
			writeFileSync(
				join(tempDir, "elefant.config.json"),
				JSON.stringify(projectConfig, null, 2)
			);
			
			const result = await loadConfig();
			
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.port).toBe(4444); // Project config wins
			}
		});
	});

	describe("environment variable overrides", () => {
		it("should override port with ELEFANT_PORT", async () => {
			const config = {
				port: 8080,
				providers: [
					{
						name: "openai",
						baseURL: "https://api.openai.com/v1",
						apiKey: "sk-test",
						model: "gpt-4",
						format: "openai",
					},
				],
				defaultProvider: "openai",
			};
			
			writeFileSync(
				join(tempDir, "elefant.config.json"),
				JSON.stringify(config, null, 2)
			);
			
			process.env.ELEFANT_PORT = "9999";
			
			const result = await loadConfig();
			
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.port).toBe(9999);
			}
		});

		it("should override first provider apiKey with ELEFANT_API_KEY", async () => {
			const config = {
				providers: [
					{
						name: "openai",
						baseURL: "https://api.openai.com/v1",
						apiKey: "original-key",
						model: "gpt-4",
						format: "openai",
					},
				],
				defaultProvider: "openai",
			};
			
			writeFileSync(
				join(tempDir, "elefant.config.json"),
				JSON.stringify(config, null, 2)
			);
			
			process.env.ELEFANT_API_KEY = "env-override-key";
			
			const result = await loadConfig();
			
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.providers[0].apiKey).toBe("env-override-key");
			}
		});

		it("should override first provider model with ELEFANT_MODEL", async () => {
			const config = {
				providers: [
					{
						name: "openai",
						baseURL: "https://api.openai.com/v1",
						apiKey: "sk-test",
						model: "gpt-4",
						format: "openai",
					},
				],
				defaultProvider: "openai",
			};
			
			writeFileSync(
				join(tempDir, "elefant.config.json"),
				JSON.stringify(config, null, 2)
			);
			
			process.env.ELEFANT_MODEL = "gpt-4-turbo";
			
			const result = await loadConfig();
			
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.providers[0].model).toBe("gpt-4-turbo");
			}
		});

		it("should override first provider baseURL with ELEFANT_BASE_URL", async () => {
			const config = {
				providers: [
					{
						name: "openai",
						baseURL: "https://api.openai.com/v1",
						apiKey: "sk-test",
						model: "gpt-4",
						format: "openai",
					},
				],
				defaultProvider: "openai",
			};
			
			writeFileSync(
				join(tempDir, "elefant.config.json"),
				JSON.stringify(config, null, 2)
			);
			
			process.env.ELEFANT_BASE_URL = "https://custom.openai.com/v1";
			
			const result = await loadConfig();
			
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.providers[0].baseURL).toBe("https://custom.openai.com/v1");
			}
		});

		it("should override defaultProvider with ELEFANT_DEFAULT_PROVIDER", async () => {
			const config = {
				providers: [
					{
						name: "openai",
						baseURL: "https://api.openai.com/v1",
						apiKey: "sk-test",
						model: "gpt-4",
						format: "openai",
					},
				],
				defaultProvider: "openai",
			};
			
			writeFileSync(
				join(tempDir, "elefant.config.json"),
				JSON.stringify(config, null, 2)
			);
			
			process.env.ELEFANT_DEFAULT_PROVIDER = "custom-provider";
			
			const result = await loadConfig();
			
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.defaultProvider).toBe("custom-provider");
			}
		});

		it("should apply multiple env overrides simultaneously", async () => {
			const config = {
				port: 8080,
				providers: [
					{
						name: "openai",
						baseURL: "https://api.openai.com/v1",
						apiKey: "original-key",
						model: "gpt-4",
						format: "openai",
					},
				],
				defaultProvider: "openai",
			};
			
			writeFileSync(
				join(tempDir, "elefant.config.json"),
				JSON.stringify(config, null, 2)
			);
			
			process.env.ELEFANT_PORT = "7777";
			process.env.ELEFANT_API_KEY = "new-key";
			process.env.ELEFANT_MODEL = "new-model";
			process.env.ELEFANT_DEFAULT_PROVIDER = "new-provider";
			
			const result = await loadConfig();
			
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.port).toBe(7777);
				expect(result.data.providers[0].apiKey).toBe("new-key");
				expect(result.data.providers[0].model).toBe("new-model");
				expect(result.data.defaultProvider).toBe("new-provider");
			}
		});
	});

	describe("missing config file", () => {
		it("should return CONFIG_INVALID error when no config file exists", async () => {
			// Ensure no config files exist in temp directory
			// (temp directory is empty by default)
			
			const result = await loadConfig();
			
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("CONFIG_INVALID");
				expect(result.error.message).toContain("No elefant.config.ts or elefant.config.json found");
			}
		});
	});

	describe("Zod validation error formatting", () => {
		it("should format Zod errors as human-readable messages", async () => {
			const config = {
				port: 8080,
				providers: [
					{
						name: "openai",
						baseURL: "not-a-valid-url",
						apiKey: "sk-test",
						model: "gpt-4",
						format: "openai",
					},
				],
				defaultProvider: "openai",
			};
			
			writeFileSync(
				join(tempDir, "elefant.config.json"),
				JSON.stringify(config, null, 2)
			);
			
			const result = await loadConfig();
			
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("CONFIG_INVALID");
				// Should contain path info, not raw ZodError
				expect(result.error.message).toContain("providers.0.baseURL");
				expect(result.error.message).toContain("Invalid URL");
			}
		});

		it("should format multiple validation errors", async () => {
			const config = {
				port: 99999, // Invalid: > 65535
				providers: [], // Invalid: empty array
				// Missing defaultProvider
			};
			
			writeFileSync(
				join(tempDir, "elefant.config.json"),
				JSON.stringify(config, null, 2)
			);
			
			const result = await loadConfig();
			
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("CONFIG_INVALID");
				// Should list multiple errors
				expect(result.error.message).toContain("port");
				expect(result.error.message).toContain("providers");
				expect(result.error.message).toContain("defaultProvider");
			}
		});
	});
});
