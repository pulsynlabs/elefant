import { describe, it, expect } from "bun:test";
import { configSchema, providerSchema } from "./schema.ts";

describe("providerSchema", () => {
	it("accepts valid provider config", () => {
		const validProvider = {
			name: "openai",
			baseURL: "https://api.openai.com/v1",
			apiKey: "sk-test123",
			model: "gpt-4",
			format: "openai" as const,
		};

		const result = providerSchema.safeParse(validProvider);
		expect(result.success).toBe(true);
	});

	it("accepts anthropic format", () => {
		const validProvider = {
			name: "anthropic",
			baseURL: "https://api.anthropic.com",
			apiKey: "sk-ant-test123",
			model: "claude-3-opus-20240229",
			format: "anthropic" as const,
		};

		const result = providerSchema.safeParse(validProvider);
		expect(result.success).toBe(true);
	});

	it("fails when apiKey is empty string", () => {
		const invalidProvider = {
			name: "openai",
			baseURL: "https://api.openai.com/v1",
			apiKey: "",
			model: "gpt-4",
			format: "openai" as const,
		};

		const result = providerSchema.safeParse(invalidProvider);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].path).toContain("apiKey");
		}
	});

	it("fails when baseURL is invalid URL", () => {
		const invalidProvider = {
			name: "openai",
			baseURL: "not-a-valid-url",
			apiKey: "sk-test123",
			model: "gpt-4",
			format: "openai" as const,
		};

		const result = providerSchema.safeParse(invalidProvider);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].path).toContain("baseURL");
		}
	});

	it("fails when format is not openai or anthropic", () => {
		const invalidProvider = {
			name: "gemini",
			baseURL: "https://api.gemini.com",
			apiKey: "test123",
			model: "gemini-pro",
			format: "gemini" as const,
		};

		const result = providerSchema.safeParse(invalidProvider);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].path).toContain("format");
		}
	});
});

describe("configSchema", () => {
	it("accepts valid config with all fields", () => {
		const validConfig = {
			port: 8080,
			providers: [
				{
					name: "openai",
					baseURL: "https://api.openai.com/v1",
					apiKey: "sk-test123",
					model: "gpt-4",
					format: "openai" as const,
				},
			],
			defaultProvider: "openai",
			logLevel: "debug" as const,
		};

		const result = configSchema.safeParse(validConfig);
		expect(result.success).toBe(true);
	});

	it("fails when providers array is missing", () => {
		const invalidConfig = {
			port: 8080,
			defaultProvider: "openai",
			logLevel: "info" as const,
		};

		const result = configSchema.safeParse(invalidConfig);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].path).toContain("providers");
		}
	});

	it("fails when providers array is empty", () => {
		const invalidConfig = {
			port: 8080,
			providers: [],
			defaultProvider: "openai",
			logLevel: "info" as const,
		};

		const result = configSchema.safeParse(invalidConfig);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].path).toContain("providers");
		}
	});

	it("defaults port to 1337 when not provided", () => {
		const configWithoutPort = {
			providers: [
				{
					name: "openai",
					baseURL: "https://api.openai.com/v1",
					apiKey: "sk-test123",
					model: "gpt-4",
					format: "openai" as const,
				},
			],
			defaultProvider: "openai",
		};

		const result = configSchema.safeParse(configWithoutPort);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.port).toBe(1337);
		}
	});

	it("defaults logLevel to info when not provided", () => {
		const configWithoutLogLevel = {
			port: 8080,
			providers: [
				{
					name: "openai",
					baseURL: "https://api.openai.com/v1",
					apiKey: "sk-test123",
					model: "gpt-4",
					format: "openai" as const,
				},
			],
			defaultProvider: "openai",
		};

		const result = configSchema.safeParse(configWithoutLogLevel);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.logLevel).toBe("info");
		}
	});

	it("fails when port is out of valid range", () => {
		const invalidConfig = {
			port: 70000,
			providers: [
				{
					name: "openai",
					baseURL: "https://api.openai.com/v1",
					apiKey: "sk-test123",
					model: "gpt-4",
					format: "openai" as const,
				},
			],
			defaultProvider: "openai",
		};

		const result = configSchema.safeParse(invalidConfig);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].path).toContain("port");
		}
	});

	it("fails when defaultProvider is empty", () => {
		const invalidConfig = {
			port: 8080,
			providers: [
				{
					name: "openai",
					baseURL: "https://api.openai.com/v1",
					apiKey: "sk-test123",
					model: "gpt-4",
					format: "openai" as const,
				},
			],
			defaultProvider: "",
			logLevel: "info" as const,
		};

		const result = configSchema.safeParse(invalidConfig);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].path).toContain("defaultProvider");
		}
	});
});
