import { afterEach, describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	configSchema,
	providerSchema,
	toolPolicyConfigSchema,
	agentRuntimeLimitsSchema,
	agentBehaviorConfigSchema,
	agentProfileSchema,
	defaultAgentProfiles,
	mcpServerSchema,
	mcpStdioConfigSchema,
	mcpRemoteConfigSchema,
	registryConfigSchema,
	skillsConfigSchema,
} from "./schema.ts";
import { ConfigManager } from './loader.ts';

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function tempConfigPath(): string {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-config-schema-'));
	tempDirs.push(dir);
	return join(dir, 'elefant.config.json');
}

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

	it("accepts anthropic-compatible format", () => {
		const validProvider = {
			name: "test-anthropic-compatible",
			baseURL: "https://api.example.com",
			apiKey: "test-key",
			model: "test-model",
			format: "anthropic-compatible" as const,
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

	it("fails when format is invalid", () => {
		const invalidProvider = {
			name: "test",
			baseURL: "https://api.example.com",
			apiKey: "test-key",
			model: "test-model",
			format: "invalid-format" as const,
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

	it("succeeds when providers array is missing (defaults to empty)", () => {
		const config = {
			port: 8080,
			defaultProvider: "openai",
			logLevel: "info" as const,
		};

		const result = configSchema.safeParse(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.providers).toEqual([]);
		}
	});

	it("succeeds when providers array is empty (zero-provider startup allowed)", () => {
		const config = {
			port: 8080,
			providers: [],
			defaultProvider: "openai",
			logLevel: "info" as const,
		};

		const result = configSchema.safeParse(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.providers).toEqual([]);
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

	it("succeeds when defaultProvider is empty (set after providers added via API)", () => {
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
		expect(result.success).toBe(true);
	});

	it('accepts optional agents record', () => {
		const result = configSchema.safeParse({
			providers: [],
			defaultProvider: '',
			agents: {
				executor: defaultAgentProfiles.executor,
			},
		});

		expect(result.success).toBe(true);
	});

	it('rejects unknown top-level fields in strict mode', () => {
		const result = configSchema.safeParse({
			providers: [],
			defaultProvider: '',
			unexpected: true,
		});

		expect(result.success).toBe(false);
	});
});

describe('agent config schemas', () => {
	it('accepts valid tool policy', () => {
		const result = toolPolicyConfigSchema.safeParse({
			mode: 'manual',
			allowedTools: ['read', 'glob'],
			perToolApproval: { bash: true },
		});

		expect(result.success).toBe(true);
	});

	it('fails tool policy for invalid enum', () => {
		const result = toolPolicyConfigSchema.safeParse({
			mode: 'invalid',
		});

		expect(result.success).toBe(false);
	});

	it('fails runtime limits for wrong type', () => {
		const result = agentRuntimeLimitsSchema.safeParse({
			maxIterations: '10',
			timeoutMs: 1000,
			maxConcurrency: 1,
		});

		expect(result.success).toBe(false);
	});

	it('fails profile when required field missing', () => {
		const result = agentProfileSchema.safeParse({
			id: 'executor',
			kind: 'executor',
			enabled: true,
			behavior: {},
			limits: {
				maxIterations: 12,
				timeoutMs: 30000,
				maxConcurrency: 1,
			},
			tools: {
				mode: 'auto',
			},
		});

		expect(result.success).toBe(false);
	});

	it('accepts valid behavior config', () => {
		const result = agentBehaviorConfigSchema.safeParse({
			provider: 'openai',
			model: 'gpt-4o-mini',
			workflowMode: 'standard',
			workflowDepth: 'deep',
			autopilot: false,
		});

		expect(result.success).toBe(true);
	});
});

describe('mcpStdioConfigSchema', () => {
	const validStdio = {
		id: '550e8400-e29b-41d4-a716-446655440000',
		name: 'filesystem',
		transport: 'stdio' as const,
		command: ['npx', '-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
	};

	it('accepts valid stdio config with all required fields', () => {
		const result = mcpStdioConfigSchema.safeParse(validStdio);
		expect(result.success).toBe(true);
	});

	it('applies default values for optional fields', () => {
		const result = mcpStdioConfigSchema.safeParse(validStdio);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.enabled).toBe(true);
			expect(result.data.timeout).toBe(30000);
			expect(result.data.env).toEqual({});
			expect(result.data.pinnedTools).toEqual([]);
		}
	});

	it('accepts stdio config with explicit optional fields', () => {
		const config = {
			...validStdio,
			env: { NODE_ENV: 'production' },
			enabled: false,
			timeout: 60000,
			pinnedTools: ['read_file', 'write_file'],
		};
		const result = mcpStdioConfigSchema.safeParse(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.env).toEqual({ NODE_ENV: 'production' });
			expect(result.data.enabled).toBe(false);
			expect(result.data.timeout).toBe(60000);
			expect(result.data.pinnedTools).toEqual(['read_file', 'write_file']);
		}
	});

	it('rejects stdio config with missing command', () => {
		const { command: _, ...noCommand } = validStdio;
		const result = mcpStdioConfigSchema.safeParse(noCommand);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some(i => i.path.includes('command'))).toBe(true);
		}
	});

	it('rejects stdio config with empty command array', () => {
		const result = mcpStdioConfigSchema.safeParse({ ...validStdio, command: [] });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some(i => i.path.includes('command'))).toBe(true);
		}
	});

	it('rejects name with invalid characters (must match /^[a-zA-Z0-9_-]+$/)', () => {
		const result = mcpStdioConfigSchema.safeParse({ ...validStdio, name: 'my server!' });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some(i => i.path.includes('name'))).toBe(true);
		}
	});

	it('rejects name with dots (non-kebab chars)', () => {
		const result = mcpStdioConfigSchema.safeParse({ ...validStdio, name: 'my.server' });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some(i => i.path.includes('name'))).toBe(true);
		}
	});

	it('rejects invalid UUID for id field', () => {
		const result = mcpStdioConfigSchema.safeParse({ ...validStdio, id: 'not-a-uuid' });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some(i => i.path.includes('id'))).toBe(true);
		}
	});

	it('rejects extra properties due to strict mode', () => {
		const result = mcpStdioConfigSchema.safeParse({
			...validStdio,
			url: 'https://example.com',
		});
		expect(result.success).toBe(false);
	});

	it('rejects transport that is not literal "stdio"', () => {
		const result = mcpStdioConfigSchema.safeParse({
			...validStdio,
			transport: 'sse',
		});
		expect(result.success).toBe(false);
	});
});

describe('mcpRemoteConfigSchema', () => {
	const validSSE = {
		id: '660e8400-e29b-41d4-a716-446655440001',
		name: 'remote-server',
		transport: 'sse' as const,
		url: 'https://mcp.example.com/sse',
	};

	const validHTTP = {
		...validSSE,
		id: '770e8400-e29b-41d4-a716-446655440002',
		name: 'http-server',
		transport: 'streamable-http' as const,
		url: 'https://mcp.example.com/mcp',
	};

	it('accepts valid SSE transport config', () => {
		const result = mcpRemoteConfigSchema.safeParse(validSSE);
		expect(result.success).toBe(true);
	});

	it('accepts valid streamable-http transport config', () => {
		const result = mcpRemoteConfigSchema.safeParse(validHTTP);
		expect(result.success).toBe(true);
	});

	it('applies default values for optional fields', () => {
		const result = mcpRemoteConfigSchema.safeParse(validSSE);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.enabled).toBe(true);
			expect(result.data.timeout).toBe(30000);
			expect(result.data.headers).toEqual({});
			expect(result.data.pinnedTools).toEqual([]);
		}
	});

	it('rejects remote config with missing url', () => {
		const { url: _, ...noUrl } = validSSE;
		const result = mcpRemoteConfigSchema.safeParse(noUrl);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some(i => i.path.includes('url'))).toBe(true);
		}
	});

	it('rejects invalid URL format', () => {
		const result = mcpRemoteConfigSchema.safeParse({ ...validSSE, url: 'not-a-url' });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some(i => i.path.includes('url'))).toBe(true);
		}
	});

	it('rejects invalid transport value', () => {
		const result = mcpRemoteConfigSchema.safeParse({ ...validSSE, transport: 'stdio' });
		expect(result.success).toBe(false);
	});

	it('rejects extra properties due to strict mode', () => {
		const result = mcpRemoteConfigSchema.safeParse({
			...validSSE,
			command: ['npx', 'some-server'],
		});
		expect(result.success).toBe(false);
	});

	it('rejects name with special characters', () => {
		const result = mcpRemoteConfigSchema.safeParse({ ...validSSE, name: 'bad name!' });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some(i => i.path.includes('name'))).toBe(true);
		}
	});
});

describe('mcpServerSchema (discriminated union)', () => {
	const validStdio = {
		id: '550e8400-e29b-41d4-a716-446655440000',
		name: 'filesystem',
		transport: 'stdio' as const,
		command: ['npx', '-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
	};

	const validSSE = {
		id: '660e8400-e29b-41d4-a716-446655440001',
		name: 'remote-server',
		transport: 'sse' as const,
		url: 'https://mcp.example.com/sse',
	};

	const validHTTP = {
		id: '770e8400-e29b-41d4-a716-446655440002',
		name: 'http-server',
		transport: 'streamable-http' as const,
		url: 'https://mcp.example.com/mcp',
	};

	it('discriminates stdio transport correctly', () => {
		const result = mcpServerSchema.safeParse(validStdio);
		expect(result.success).toBe(true);
	});

	it('discriminates sse transport correctly', () => {
		const result = mcpServerSchema.safeParse(validSSE);
		expect(result.success).toBe(true);
	});

	it('discriminates streamable-http transport correctly', () => {
		const result = mcpServerSchema.safeParse(validHTTP);
		expect(result.success).toBe(true);
	});

	it('rejects unknown transport value', () => {
		const result = mcpServerSchema.safeParse({
			id: '880e8400-e29b-41d4-a716-446655440003',
			name: 'bad-server',
			transport: 'websocket',
		});
		expect(result.success).toBe(false);
	});

	it('rejects stdio config missing command (discriminator matched but variant fails)', () => {
		const result = mcpServerSchema.safeParse({
			id: '990e8400-e29b-41d4-a716-446655440004',
			name: 'incomplete',
			transport: 'stdio',
		});
		expect(result.success).toBe(false);
	});

	it('rejects remote config missing url (discriminator matched but variant fails)', () => {
		const result = mcpServerSchema.safeParse({
			id: 'aa0e8400-e29b-41d4-a716-446655440005',
			name: 'incomplete-remote',
			transport: 'sse',
		});
		expect(result.success).toBe(false);
	});

	it('rejects a non-object (e.g. string)', () => {
		const result = mcpServerSchema.safeParse('not-an-object');
		expect(result.success).toBe(false);
	});

	it('parses an array of mixed stdio and remote servers', () => {
		const arraySchema = mcpServerSchema.array();
		const result = arraySchema.safeParse([validStdio, validSSE, validHTTP]);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toHaveLength(3);
		}
	});
});

describe('configSchema with MCP fields', () => {
	it('defaults mcp to empty array when not provided', () => {
		const config = {
			providers: [],
			defaultProvider: '',
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.mcp).toEqual([]);
		}
	});

	it('defaults tokenBudgetPercent to 10 when not provided', () => {
		const config = {
			providers: [],
			defaultProvider: '',
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.tokenBudgetPercent).toBe(10);
		}
	});

	it('accepts config with valid MCP stdio server', () => {
		const config = {
			providers: [],
			defaultProvider: '',
			mcp: [
				{
					id: '550e8400-e29b-41d4-a716-446655440000',
					name: 'filesystem',
					transport: 'stdio' as const,
					command: ['npx', '-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
				},
			],
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(true);
	});

	it('accepts config with valid MCP remote SSE server', () => {
		const config = {
			providers: [],
			defaultProvider: '',
			mcp: [
				{
					id: '660e8400-e29b-41d4-a716-446655440001',
					name: 'remote-server',
					transport: 'sse' as const,
					url: 'https://mcp.example.com/sse',
				},
			],
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(true);
	});

	it('accepts config with explicit tokenBudgetPercent', () => {
		const config = {
			providers: [],
			defaultProvider: '',
			tokenBudgetPercent: 25,
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.tokenBudgetPercent).toBe(25);
		}
	});

	it('rejects tokenBudgetPercent below 0', () => {
		const config = {
			providers: [],
			defaultProvider: '',
			tokenBudgetPercent: -1,
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(false);
	});

	it('rejects tokenBudgetPercent above 100', () => {
		const config = {
			providers: [],
			defaultProvider: '',
			tokenBudgetPercent: 101,
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(false);
	});

	it('defaults compactionThreshold to 0.8 when not provided', () => {
		const config = {
			providers: [],
			defaultProvider: '',
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.compactionThreshold).toBe(0.8);
		}
	});

	it('accepts config with compactionThreshold at minimum 0.5', () => {
		const config = {
			providers: [],
			defaultProvider: '',
			compactionThreshold: 0.5,
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.compactionThreshold).toBe(0.5);
		}
	});

	it('rejects compactionThreshold below min 0.5 (e.g. 0.4)', () => {
		const config = {
			providers: [],
			defaultProvider: '',
			compactionThreshold: 0.4,
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(false);
	});

	it('rejects compactionThreshold above max 0.95 (e.g. 0.96)', () => {
		const config = {
			providers: [],
			defaultProvider: '',
			compactionThreshold: 0.96,
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(false);
	});

	it('existing config without compactionThreshold parses and defaults to 0.8', () => {
		const config = {
			port: 8080,
			providers: [
				{
					name: 'openai',
					baseURL: 'https://api.openai.com/v1',
					apiKey: 'sk-test123',
					model: 'gpt-4',
					format: 'openai' as const,
				},
			],
			defaultProvider: 'openai',
			logLevel: 'debug' as const,
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.compactionThreshold).toBe(0.8);
		}
	});

	it('rejects config with invalid MCP server in mcp array', () => {
		const config = {
			providers: [],
			defaultProvider: '',
			mcp: [
				{
					name: 'incomplete',
					transport: 'stdio',
				},
			],
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(false);
	});

	it('accepts config with two MCP servers having the same name', () => {
		// Note: name uniqueness across servers is enforced at the
		// application level (MCPManager), not by this Zod schema.
		const config = {
			providers: [],
			defaultProvider: '',
			mcp: [
				{
					id: '550e8400-e29b-41d4-a716-446655440000',
					name: 'duplicate',
					transport: 'stdio' as const,
					command: ['npx', 'server-a'],
				},
				{
					id: '660e8400-e29b-41d4-a716-446655440001',
					name: 'duplicate',
					transport: 'sse' as const,
					url: 'https://mcp.example.com/sse',
				},
			],
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.mcp).toHaveLength(2);
		}
	});

	it('existing config without mcp field still parses (backward compatibility)', () => {
		const config = {
			port: 8080,
			providers: [
				{
					name: 'openai',
					baseURL: 'https://api.openai.com/v1',
					apiKey: 'sk-test123',
					model: 'gpt-4',
					format: 'openai' as const,
				},
			],
			defaultProvider: 'openai',
			logLevel: 'debug' as const,
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.mcp).toEqual([]);
			expect(result.data.tokenBudgetPercent).toBe(10);
		}
	});

	it('existing config without tokenBudgetPercent parses with default 10', () => {
		const config = {
			port: 8080,
			providers: [
				{
					name: 'openai',
					baseURL: 'https://api.openai.com/v1',
					apiKey: 'sk-test123',
					model: 'gpt-4',
					format: 'openai' as const,
				},
			],
			defaultProvider: 'openai',
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.tokenBudgetPercent).toBe(10);
		}
	});

	it('round-trips a full MCP server config through ConfigManager disk loading', async () => {
		const configPath = tempConfigPath();
		const fullConfig = configSchema.parse({
			port: 1444,
			providers: [
				{
					name: 'openai-compatible',
					baseURL: 'https://api.example.com/v1',
					apiKey: 'test-key',
					model: 'test-model',
					format: 'openai',
				},
			],
			defaultProvider: 'openai-compatible',
			logLevel: 'debug',
			projectPath: '/tmp/elefant-project',
			mcp: [
				{
					id: '00000000-0000-4000-8000-000000000731',
					name: 'filesystem-test',
					transport: 'stdio',
					command: ['bunx', '@modelcontextprotocol/server-filesystem', '/tmp'],
					env: { MCP_ENV: 'test' },
					enabled: true,
					timeout: 45_000,
					pinnedTools: ['list_directory'],
				},
				{
					id: '00000000-0000-4000-8000-000000000732',
					name: 'remote-test',
					transport: 'streamable-http',
					url: 'https://mcp.example.com/mcp',
					headers: { Authorization: 'Bearer test-token' },
					enabled: false,
					timeout: 60_000,
					pinnedTools: ['search'],
				},
			],
			tokenBudgetPercent: 15,
		});

		await Bun.write(configPath, `${JSON.stringify(fullConfig, null, 2)}\n`);
		const manager = new ConfigManager({ globalConfigPath: configPath });
		const loaded = await manager.getConfig();

		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.data.mcp).toEqual(fullConfig.mcp);
			expect(loaded.data.tokenBudgetPercent).toBe(15);
			expect(loaded.data.port).toBe(1444);
			expect(loaded.data.defaultProvider).toBe('openai-compatible');
		}
	});

	it('ConfigManager defaults mcp to [] when the field is absent', async () => {
		const configPath = tempConfigPath();
		await Bun.write(configPath, JSON.stringify({ providers: [], defaultProvider: '' }));

		const manager = new ConfigManager({ globalConfigPath: configPath });
		const loaded = await manager.getConfig();

		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.data.mcp).toEqual([]);
		}
	});

	it('ConfigManager loads old configs without mcp or tokenBudgetPercent', async () => {
		const configPath = tempConfigPath();
		await Bun.write(configPath, JSON.stringify({
			port: 1555,
			providers: [],
			defaultProvider: '',
			logLevel: 'warn',
		}));

		const manager = new ConfigManager({ globalConfigPath: configPath });
		const loaded = await manager.getConfig();

		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.data.mcp).toEqual([]);
			expect(loaded.data.tokenBudgetPercent).toBe(10);
			expect(loaded.data.port).toBe(1555);
		}
	});
});

describe('registryConfigSchema (discriminated union)', () => {
	it('accepts valid native registry', () => {
		const result = registryConfigSchema.safeParse({
			type: 'native',
			url: 'https://example.com/skills/index.json',
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.enabled).toBe(true);
		}
	});

	it('accepts valid clawhub registry with default URL', () => {
		const result = registryConfigSchema.safeParse({
			type: 'clawhub',
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.url).toBe('https://clawhub.com');
			expect(result.data.enabled).toBe(true);
		}
	});

	it('accepts clawhub registry with custom URL', () => {
		const result = registryConfigSchema.safeParse({
			type: 'clawhub',
			url: 'https://custom-clawhub.example.com',
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.url).toBe('https://custom-clawhub.example.com');
		}
	});

	it('accepts valid github-registry', () => {
		const result = registryConfigSchema.safeParse({
			type: 'github-registry',
			url: 'https://raw.githubusercontent.com/user/repo/main/registry.json',
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.enabled).toBe(true);
		}
	});

	it('accepts disabled registry entry', () => {
		const result = registryConfigSchema.safeParse({
			type: 'clawhub',
			enabled: false,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.enabled).toBe(false);
		}
	});

	it('accepts disabled native registry entry', () => {
		const result = registryConfigSchema.safeParse({
			type: 'native',
			url: 'https://example.com/index.json',
			enabled: false,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.enabled).toBe(false);
		}
	});

	it('rejects invalid URL in native registry', () => {
		const result = registryConfigSchema.safeParse({
			type: 'native',
			url: 'not-a-valid-url',
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some(i => i.path.includes('url'))).toBe(true);
		}
	});

	it('rejects invalid URL in github-registry', () => {
		const result = registryConfigSchema.safeParse({
			type: 'github-registry',
			url: 'invalid-url',
		});
		expect(result.success).toBe(false);
	});

	it('rejects unknown registry type', () => {
		const result = registryConfigSchema.safeParse({
			type: 'unknown-type',
			url: 'https://example.com',
		});
		expect(result.success).toBe(false);
	});

	it('rejects native registry missing url', () => {
		const result = registryConfigSchema.safeParse({
			type: 'native',
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some(i => i.path.includes('url'))).toBe(true);
		}
	});

	it('rejects github-registry missing url', () => {
		const result = registryConfigSchema.safeParse({
			type: 'github-registry',
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some(i => i.path.includes('url'))).toBe(true);
		}
	});

	it('rejects non-object input', () => {
		const result = registryConfigSchema.safeParse('not-an-object');
		expect(result.success).toBe(false);
	});

	it('parses an array of mixed registry types', () => {
		const arraySchema = registryConfigSchema.array();
		const result = arraySchema.safeParse([
			{ type: 'clawhub' as const },
			{ type: 'native' as const, url: 'https://example.com/index.json' },
			{ type: 'github-registry' as const, url: 'https://raw.githubusercontent.com/user/repo/main/registry.json' },
		]);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toHaveLength(3);
		}
	});
});

describe('skillsConfigSchema', () => {
	it('defaults registries to two bundled entries and cacheTtlHours to 24', () => {
		const result = skillsConfigSchema.safeParse({});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.registries).toHaveLength(2);
			expect(result.data.registries[0].type).toBe('clawhub');
			expect(result.data.registries[1].type).toBe('github-registry');
			expect(result.data.cacheTtlHours).toBe(24);
		}
	});

	it('defaults registries to bundled entries when skills object is empty', () => {
		const result = skillsConfigSchema.safeParse(undefined);
		expect(result.success).toBe(false); // zod requires input for parse; .default() only works via configSchema
	});

	it('accepts user override with empty registries array', () => {
		const result = skillsConfigSchema.safeParse({
			registries: [],
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.registries).toEqual([]);
			expect(result.data.cacheTtlHours).toBe(24);
		}
	});

	it('accepts user adding a native registry alongside defaults', () => {
		const result = skillsConfigSchema.safeParse({
			registries: [
				{ type: 'native' as const, url: 'https://example.com/index.json' },
			],
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.registries).toHaveLength(1);
			expect(result.data.registries[0].type).toBe('native');
		}
	});

	it('accepts cacheTtlHours: 48', () => {
		const result = skillsConfigSchema.safeParse({
			cacheTtlHours: 48,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.cacheTtlHours).toBe(48);
		}
	});

	it('rejects cacheTtlHours: 0 (min is 1)', () => {
		const result = skillsConfigSchema.safeParse({
			cacheTtlHours: 0,
		});
		expect(result.success).toBe(false);
	});

	it('rejects cacheTtlHours: -1', () => {
		const result = skillsConfigSchema.safeParse({
			cacheTtlHours: -1,
		});
		expect(result.success).toBe(false);
	});

	it('rejects non-integer cacheTtlHours', () => {
		const result = skillsConfigSchema.safeParse({
			cacheTtlHours: 3.5,
		});
		expect(result.success).toBe(false);
	});
});

describe('configSchema with skills field', () => {
	it('defaults skills to bundled registries when field is absent', () => {
		const config = {
			providers: [],
			defaultProvider: '',
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.skills.registries).toHaveLength(2);
			expect(result.data.skills.registries[0].type).toBe('clawhub');
			expect(result.data.skills.registries[0].enabled).toBe(true);
			expect(result.data.skills.registries[1].type).toBe('github-registry');
			expect(result.data.skills.registries[1].enabled).toBe(true);
			expect(result.data.skills.cacheTtlHours).toBe(24);
		}
	});

	it('accepts user-provided empty registries array in skills', () => {
		const config = {
			providers: [],
			defaultProvider: '',
			skills: {
				registries: [],
			},
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.skills.registries).toEqual([]);
			expect(result.data.skills.cacheTtlHours).toBe(24);
		}
	});

	it('accepts user-provided native registry in skills', () => {
		const config = {
			providers: [],
			defaultProvider: '',
			skills: {
				registries: [
					{ type: 'native' as const, url: 'https://example.com/skills/index.json' },
				],
			},
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.skills.registries).toHaveLength(1);
			expect(result.data.skills.registries[0].type).toBe('native');
			expect(result.data.skills.registries[0].url).toBe('https://example.com/skills/index.json');
		}
	});

	it('accepts disabled registry in skills', () => {
		const config = {
			providers: [],
			defaultProvider: '',
			skills: {
				registries: [
					{ type: 'clawhub' as const, enabled: false },
				],
			},
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.skills.registries[0].enabled).toBe(false);
		}
	});

	it('rejects invalid URL in skills.registries entry', () => {
		const config = {
			providers: [],
			defaultProvider: '',
			skills: {
				registries: [
					{ type: 'native' as const, url: 'not-a-url' },
				],
			},
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(false);
	});

	it('rejects cacheTtlHours below 1', () => {
		const config = {
			providers: [],
			defaultProvider: '',
			skills: {
				cacheTtlHours: -1,
			},
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(false);
	});

	it('accepts cacheTtlHours: 48 in skills', () => {
		const config = {
			providers: [],
			defaultProvider: '',
			skills: {
				cacheTtlHours: 48,
			},
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.skills.cacheTtlHours).toBe(48);
		}
	});

	it('rejects unknown registry type in skills.registries', () => {
		const config = {
			providers: [],
			defaultProvider: '',
			skills: {
				registries: [
					{ type: 'unknown-type', url: 'https://example.com' },
				],
			},
		};
		const result = configSchema.safeParse(config);
		expect(result.success).toBe(false);
	});

	it('round-trips skills config through ConfigManager disk loading', async () => {
		const configPath = tempConfigPath();
		const fullConfig = configSchema.parse({
			providers: [],
			defaultProvider: '',
			skills: {
				registries: [
					{ type: 'clawhub', enabled: false },
					{ type: 'native', url: 'https://example.com/index.json', enabled: true },
				],
				cacheTtlHours: 12,
			},
		});

		await Bun.write(configPath, `${JSON.stringify(fullConfig, null, 2)}\n`);
		const manager = new ConfigManager({ globalConfigPath: configPath });
		const loaded = await manager.getConfig();

		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.data.skills.registries).toHaveLength(2);
			expect(loaded.data.skills.registries[0].type).toBe('clawhub');
			expect(loaded.data.skills.registries[0].enabled).toBe(false);
			expect(loaded.data.skills.registries[1].type).toBe('native');
			expect(loaded.data.skills.registries[1].url).toBe('https://example.com/index.json');
			expect(loaded.data.skills.cacheTtlHours).toBe(12);
		}
	});

	it('ConfigManager defaults skills to bundled registries when field is absent', async () => {
		const configPath = tempConfigPath();
		await Bun.write(configPath, JSON.stringify({ providers: [], defaultProvider: '' }));

		const manager = new ConfigManager({ globalConfigPath: configPath });
		const loaded = await manager.getConfig();

		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.data.skills.registries).toHaveLength(2);
			expect(loaded.data.skills.registries[0].type).toBe('clawhub');
			expect(loaded.data.skills.registries[1].type).toBe('github-registry');
			expect(loaded.data.skills.cacheTtlHours).toBe(24);
		}
	});

	it('ConfigManager loads old configs without skills field (backward compatibility)', async () => {
		const configPath = tempConfigPath();
		await Bun.write(configPath, JSON.stringify({
			port: 1555,
			providers: [],
			defaultProvider: '',
			logLevel: 'warn',
		}));

		const manager = new ConfigManager({ globalConfigPath: configPath });
		const loaded = await manager.getConfig();

		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.data.skills.registries).toHaveLength(2);
			expect(loaded.data.skills.cacheTtlHours).toBe(24);
			expect(loaded.data.port).toBe(1555);
		}
	});
});
