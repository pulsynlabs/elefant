import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import type { ConfigManager } from '../config/loader.ts';
import type { ElefantConfig, McpRemoteConfig, McpStdioConfig } from '../config/schema.ts';
import type { MCPRemoteTransport } from './transports.ts';
import { createRemoteTransport, createStdioTransport } from './transports.ts';

const killDescendantCalls: number[] = [];

mock.module('./cleanup.ts', () => ({
	killDescendants: async (pid: number): Promise<void> => {
		killDescendantCalls.push(pid);
	},
}));

const { MCPManager } = await import('./manager.ts');

function createStdioConfig(overrides: Partial<McpStdioConfig> = {}): McpStdioConfig {
	return {
		id: '00000000-0000-4000-8000-000000000701',
		name: 'filesystem-test',
		transport: 'stdio',
		command: ['bunx', '@modelcontextprotocol/server-filesystem', '/tmp'],
		env: { ELEFANT_MCP_TEST: '1' },
		enabled: true,
		timeout: 30_000,
		pinnedTools: [],
		...overrides,
	};
}

function createRemoteConfig(overrides: Partial<McpRemoteConfig> = {}): McpRemoteConfig {
	return {
		id: '00000000-0000-4000-8000-000000000702',
		name: 'remote-test',
		transport: 'streamable-http',
		url: 'http://localhost:31337/mcp',
		headers: { Authorization: 'Bearer test-token' },
		enabled: true,
		timeout: 30_000,
		pinnedTools: [],
		...overrides,
	};
}

function createConfigManager(config: ElefantConfig): ConfigManager {
	return {
		getConfig: async () => ({ ok: true, data: config }),
	} as ConfigManager;
}

function createClient(connect: (transport: Transport) => Promise<void>, tools: Tool[] = []): Client {
	return {
		connect,
		close: async () => undefined,
		listTools: async () => ({ tools }),
		setNotificationHandler: () => undefined,
		callTool: async () => ({ content: [] }),
	} as unknown as Client;
}

function createTransport(label: string): MCPRemoteTransport {
	return {
		label,
		start: async () => undefined,
		close: async () => undefined,
		send: async () => undefined,
	} as unknown as MCPRemoteTransport;
}

afterEach(() => {
	killDescendantCalls.length = 0;
	mock.restore();
});

describe('MCP transport verification', () => {
	it('createStdioTransport preserves command, args, cwd, and merged env', () => {
		const transport = createStdioTransport(createStdioConfig());
		const params = (transport as unknown as { _serverParams: { command: string; args: string[]; cwd: string; env: Record<string, string> } })._serverParams;

		expect(params.command).toBe('bunx');
		expect(params.args).toEqual(['@modelcontextprotocol/server-filesystem', '/tmp']);
		expect(params.cwd).toBe(process.cwd());
		expect(params.env.ELEFANT_MCP_TEST).toBe('1');
	});

	it('createRemoteTransport produces a StreamableHTTP transport without eager network I/O', async () => {
		const fetchMock = mock(() => Promise.resolve(new Response('{}')));
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		try {
			const transport = await createRemoteTransport(createRemoteConfig());
			expect(typeof transport.start).toBe('function');
			expect(fetchMock).not.toHaveBeenCalled();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('falls back from StreamableHTTP to SSE when the first remote connect is unsupported', async () => {
		const serverId = '00000000-0000-4000-8000-000000000703';
		const attempts: string[] = [];
		let clientCount = 0;
		const manager = new MCPManager(
			createConfigManager({
				port: 1337,
				providers: [],
				defaultProvider: '',
				logLevel: 'info',
				projectPath: process.cwd(),
				mcp: [createRemoteConfig({ id: serverId })],
				tokenBudgetPercent: 10,
			}),
			undefined,
			{
				clientFactory: () => {
					clientCount += 1;
					return createClient(async (transport) => {
						const label = (transport as unknown as { label: string }).label;
						attempts.push(label);
						if (clientCount === 1) {
							throw new Error('StreamableHTTP not supported by server');
						}
					});
				},
				createRemoteTransport: async () => createTransport('streamable-http'),
				createSSETransport: (() => createTransport('sse')) as never,
			},
		);

		await manager.connect(serverId);

		expect(attempts).toEqual(['streamable-http', 'sse']);
		expect(manager.getStatus(serverId)).toBe('connected');
	});

	it('shutdown kills stdio descendants before closing the client', async () => {
		const closed: string[] = [];
		const stateMap = new Map<string, unknown>();
		const manager = new MCPManager(createConfigManager({
			port: 1337,
			providers: [],
			defaultProvider: '',
			logLevel: 'info',
			projectPath: process.cwd(),
			mcp: [],
			tokenBudgetPercent: 10,
		}));
		stateMap.set('stdio-server', {
			config: createStdioConfig({ id: '00000000-0000-4000-8000-000000000704' }),
			status: 'connected',
			transport: 'stdio',
			pid: 12_345,
			client: {
				close: async () => {
					closed.push('client');
				},
			},
		});
		(manager as unknown as { servers: Map<string, unknown> }).servers = stateMap;

		await manager.shutdown();

		expect(killDescendantCalls).toEqual([12_345]);
		expect(closed).toEqual(['client']);
	});
});
