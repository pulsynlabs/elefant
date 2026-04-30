import { afterEach, describe, expect, it } from 'bun:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigManager } from '../config/loader.ts';
import { MCPManager } from './manager.ts';
import type { MCPServerState, MCPServerStatus } from './types.ts';

const tempDirs: string[] = [];

function createConfigManager(config: Record<string, unknown>): ConfigManager {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-mcp-manager-test-'));
	tempDirs.push(dir);
	const configPath = join(dir, 'elefant.config.json');
	writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
	return new ConfigManager({ globalConfigPath: configPath });
}

function createServerConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: '00000000-0000-4000-8000-000000000101',
		name: 'local-filesystem',
		transport: 'stdio',
		command: ['bunx', '@modelcontextprotocol/server-filesystem', '/tmp'],
		...overrides,
	};
}

function createMockTransport(pid?: number): StdioClientTransport {
	return {
		start: async () => undefined,
		close: async () => undefined,
		send: async () => undefined,
		pid: pid ?? null,
	} as unknown as StdioClientTransport;
}

function createMockClient(connect: (transport: Transport) => Promise<void>, tools: Tool[] = []) {
	const calls = {
		connect: 0,
		close: 0,
		listTools: 0,
		setNotificationHandler: 0,
	};

	const client = {
		connect: async (transport: Transport) => {
			calls.connect += 1;
			await connect(transport);
		},
		close: async () => {
			calls.close += 1;
		},
		listTools: async () => {
			calls.listTools += 1;
			return { tools };
		},
		setNotificationHandler: () => {
			calls.setNotificationHandler += 1;
		},
	} as unknown as Client;

	return { client, calls };
}

function getState(manager: MCPManager, id: string): MCPServerState | undefined {
	return (manager as unknown as { servers: Map<string, MCPServerState> }).servers.get(id);
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('MCPManager', () => {
	it('runs init without error when zero servers are configured', async () => {
		const manager = new MCPManager(createConfigManager({ mcp: [] }));

		await expect(manager.init()).resolves.toBeUndefined();
	});

	it('returns undefined for unknown server status', () => {
		const manager = new MCPManager(createConfigManager({ mcp: [] }));

		expect(manager.getStatus('missing')).toBeUndefined();
	});

	it('runs shutdown without error on empty state', async () => {
		const manager = new MCPManager(createConfigManager({ mcp: [] }));

		await expect(manager.shutdown()).resolves.toBeUndefined();
	});

	it('stores disabled servers with disabled status after init', async () => {
		const disabledServerId = '00000000-0000-4000-8000-000000000001';
		const manager = new MCPManager(createConfigManager({
			mcp: [
				{
					id: disabledServerId,
					name: 'local-filesystem',
					transport: 'stdio',
					command: ['bunx', '@modelcontextprotocol/server-filesystem', '/tmp'],
					enabled: false,
				},
			],
		}));

		await manager.init();

		expect(manager.getStatus(disabledServerId)).toBe('disabled');
	});

	it('connects a stdio server and transitions to connected', async () => {
		const serverId = '00000000-0000-4000-8000-000000000101';
		const statuses: MCPServerStatus[] = [];
		const mock = createMockClient(async () => undefined);
		const manager = new MCPManager(
			createConfigManager({ mcp: [createServerConfig({ id: serverId })] }),
			(event) => {
				if (event.type === 'mcp.status.changed') {
					statuses.push(event.status);
				}
			},
			{
				clientFactory: () => mock.client,
				createStdioTransport: () => createMockTransport(),
			},
		);

		await manager.connect(serverId);

		expect(manager.getStatus(serverId)).toBe('connected');
		expect(getState(manager, serverId)?.transport).toBe('stdio');
		expect(getState(manager, serverId)?.pid).toBeUndefined();
		expect(getState(manager, serverId)?.tools).toEqual([]);
		expect(mock.calls.connect).toBe(1);
		expect(mock.calls.listTools).toBe(1);
		expect(mock.calls.setNotificationHandler).toBe(1);
		expect(statuses).toEqual(['connecting', 'connected']);
	});

	it('stores the stdio transport pid after connect', async () => {
		const serverId = '00000000-0000-4000-8000-000000000107';
		const mock = createMockClient(async () => undefined);
		const manager = new MCPManager(
			createConfigManager({ mcp: [createServerConfig({ id: serverId })] }),
			undefined,
			{
				clientFactory: () => mock.client,
				createStdioTransport: () => createMockTransport(12_345),
			},
		);

		await manager.connect(serverId);

		expect(getState(manager, serverId)?.pid).toBe(12_345);
	});

	it('caches listed tools after connect and returns flat tools across connected servers', async () => {
		const serverId = '00000000-0000-4000-8000-000000000105';
		const mock = createMockClient(async () => undefined, [
			{
				name: 'read_file',
				description: 'Read a file from disk',
				inputSchema: { type: 'object' },
			},
		]);
		const manager = new MCPManager(
			createConfigManager({ mcp: [createServerConfig({ id: serverId })] }),
			undefined,
			{
				clientFactory: () => mock.client,
				createStdioTransport: () => createMockTransport(),
			},
		);

		await manager.connect(serverId);

		expect(await manager.listTools(serverId)).toEqual([
			{
				name: 'read_file',
				description: 'Read a file from disk',
				inputSchema: { type: 'object' },
			},
		]);
		expect(manager.listAllTools()).toEqual([
			{
				serverId,
				serverName: 'local-filesystem',
				tool: {
					name: 'read_file',
					description: 'Read a file from disk',
					inputSchema: { type: 'object' },
				},
			},
		]);
		expect(mock.calls.listTools).toBe(1);
	});

	it('refreshes cached tools when the tool list changed notification fires', async () => {
		const serverId = '00000000-0000-4000-8000-000000000106';
		let notificationHandler: (() => Promise<void>) | undefined;
		let listedTools: Tool[] = [
			{
				name: 'read_file',
				description: 'Read a file from disk',
				inputSchema: { type: 'object' },
			},
		];
		const events: string[] = [];
		const client = {
			connect: async () => undefined,
			close: async () => undefined,
			listTools: async () => ({ tools: listedTools }),
			setNotificationHandler: (_schema: unknown, handler: () => Promise<void>) => {
				notificationHandler = handler;
			},
		} as unknown as Client;
		const manager = new MCPManager(
			createConfigManager({ mcp: [createServerConfig({ id: serverId })] }),
			(event) => events.push(event.type),
			{
				clientFactory: () => client,
				createStdioTransport: () => createMockTransport(),
			},
		);

		await manager.connect(serverId);
		listedTools = [
			{
				name: 'write_file',
				description: 'Write a file to disk',
				inputSchema: { type: 'object' },
			},
		];
		await notificationHandler?.();

		expect(manager.listAllTools().map((entry) => entry.tool.name)).toEqual(['write_file']);
		expect(events).toEqual(['mcp.status.changed', 'mcp.status.changed', 'mcp.tools.changed']);
		expect(getState(manager, serverId)?.lastToolsAt).toBeNumber();
	});

	it('sets failed status and error when client connect throws', async () => {
		const serverId = '00000000-0000-4000-8000-000000000102';
		const mock = createMockClient(async () => {
			throw new Error('server refused connection');
		});
		const manager = new MCPManager(
			createConfigManager({ mcp: [createServerConfig({ id: serverId })] }),
			undefined,
			{
				clientFactory: () => mock.client,
				createStdioTransport: () => createMockTransport(),
			},
		);

		await expect(manager.connect(serverId)).resolves.toBeUndefined();

		expect(manager.getStatus(serverId)).toBe('failed');
		expect(getState(manager, serverId)?.error).toBe('server refused connection');
		expect(mock.calls.close).toBe(1);
	});

	it('disconnect closes the client and marks configured server disabled', async () => {
		const serverId = '00000000-0000-4000-8000-000000000103';
		const mock = createMockClient(async () => undefined);
		const manager = new MCPManager(
			createConfigManager({ mcp: [createServerConfig({ id: serverId })] }),
			undefined,
			{
				clientFactory: () => mock.client,
				createStdioTransport: () => createMockTransport(),
			},
		);

		await manager.connect(serverId);
		await manager.disconnect(serverId);

		expect(manager.getStatus(serverId)).toBe('disabled');
		expect(getState(manager, serverId)?.client).toBeUndefined();
		expect(mock.calls.close).toBe(1);
	});

	it('sets failed status when connection exceeds configured timeout', async () => {
		const serverId = '00000000-0000-4000-8000-000000000104';
		const mock = createMockClient(() => new Promise(() => undefined));
		const manager = new MCPManager(
			createConfigManager({ mcp: [createServerConfig({ id: serverId, timeout: 5 })] }),
			undefined,
			{
				clientFactory: () => mock.client,
				createStdioTransport: () => createMockTransport(),
			},
		);

		await manager.connect(serverId);

		expect(manager.getStatus(serverId)).toBe('failed');
		expect(getState(manager, serverId)?.error).toBe('MCP connection timed out after 5ms');
		expect(mock.calls.close).toBe(1);
	});

});
