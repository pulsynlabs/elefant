import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ToolListChangedNotificationSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';

import type { ConfigManager } from '../config/loader.ts';
import type { McpServerConfig } from '../config/schema.ts';
import {
	createRemoteTransport,
	createSSETransport,
	createStdioTransport,
	type MCPRemoteTransport,
	type MCPTransport,
} from './transports.ts';
import { killDescendants } from './cleanup.ts';
import { searchMcpTools } from './search.ts';
import type {
	MCPServerState,
	MCPServerStatus,
	MCPStatusEvent,
	ToolWithMeta,
} from './types.ts';

const DEFAULT_INIT_CONCURRENCY = 8;
export const MAX_MCP_DESCRIPTION_LENGTH = 2048;

type MCPClient = Client;

interface MCPManagerDependencies {
	clientFactory?: () => MCPClient;
	createStdioTransport?: typeof createStdioTransport;
	createRemoteTransport?: typeof createRemoteTransport;
	createSSETransport?: typeof createSSETransport;
}

export class MCPManager {
	private readonly servers = new Map<string, MCPServerState>();
	private readonly initConcurrency: number;
	private readonly clientFactory: () => MCPClient;
	private readonly makeStdioTransport: typeof createStdioTransport;
	private readonly makeRemoteTransport: typeof createRemoteTransport;
	private readonly makeSSETransport: typeof createSSETransport;

	constructor(
		private config: ConfigManager,
		private onStatusChange?: (event: MCPStatusEvent) => void,
		dependencies: MCPManagerDependencies = {},
	) {
		this.initConcurrency = DEFAULT_INIT_CONCURRENCY;
		this.clientFactory = dependencies.clientFactory ?? (() => new Client({ name: 'elefant', version: '0.1.0' }, { capabilities: {} }));
		this.makeStdioTransport = dependencies.createStdioTransport ?? createStdioTransport;
		this.makeRemoteTransport = dependencies.createRemoteTransport ?? createRemoteTransport;
		this.makeSSETransport = dependencies.createSSETransport ?? createSSETransport;
	}

	public async init(): Promise<void> {
		const configResult = await this.config.getConfig();
		if (!configResult.ok) {
			throw new Error(configResult.error.message);
		}

		const enabledServers: McpServerConfig[] = [];
		this.servers.clear();

		for (const serverConfig of configResult.data.mcp) {
			if (serverConfig.enabled === false) {
				this.setState(serverConfig.id, {
					config: serverConfig,
					status: 'disabled',
					transport: serverConfig.transport,
				});
				continue;
			}

			this.setState(serverConfig.id, {
				config: serverConfig,
				status: 'connecting',
				transport: serverConfig.transport,
			});
			enabledServers.push(serverConfig);
		}

		await this.runWithConcurrency(enabledServers, this.initConcurrency, async (serverConfig) => {
			await this.connectSafely(serverConfig.id);
		});
	}

	public async connect(id: string): Promise<void> {
		const serverConfig = await this.getServerConfig(id);
		if (!serverConfig) {
			this.updateStatus(id, 'failed', `MCP server ${id} was not found in config`);
			return;
		}

		if (serverConfig.enabled === false) {
			await this.servers.get(id)?.client?.close();
			this.setState(id, {
				config: serverConfig,
				status: 'disabled',
				transport: serverConfig.transport,
			});
			return;
		}

		await this.servers.get(id)?.client?.close();
		this.setState(id, {
			config: serverConfig,
			status: 'connecting',
			transport: serverConfig.transport,
		});

		try {
			const connected = serverConfig.transport === 'stdio'
				? await this.connectStdio(serverConfig)
				: await this.connectRemote(serverConfig);
			const listedTools = await connected.client.listTools();
			const tools = truncateToolDescriptions(listedTools.tools);
			const lastToolsAt = Date.now();

			connected.client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
				const fresh = await connected.client.listTools();
				const existing = this.servers.get(id);
				if (!existing) {
					return;
				}

				this.servers.set(id, {
					...existing,
					tools: truncateToolDescriptions(fresh.tools),
					lastToolsAt: Date.now(),
				});
				this.onStatusChange?.({ type: 'mcp.tools.changed', serverId: id });
			});

			this.setState(id, {
				config: serverConfig,
				client: connected.client,
				status: 'connected',
				tools,
				lastToolsAt,
				transport: connected.transport,
				pid: connected.pid,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.updateStatus(id, 'failed', message);
		}
	}

	public async disconnect(id: string): Promise<void> {
		const state = this.servers.get(id);
		if (!state) {
			return;
		}

		await state.client?.close();
		this.setState(id, {
			config: state.config,
			status: 'disabled',
			transport: state.transport,
		});
	}

	public async reconnect(id: string): Promise<void> {
		await this.disconnect(id);
		await this.connect(id);
	}

	public getStatus(id: string): MCPServerStatus | undefined {
		return this.servers.get(id)?.status;
	}

	public getTimeout(id: string): number {
		return this.servers.get(id)?.config.timeout ?? 30_000;
	}

	public getPinnedTools(id: string): string[] {
		return this.servers.get(id)?.config.pinnedTools ?? [];
	}

	public async listTools(id: string): Promise<Tool[]> {
		const state = this.servers.get(id);
		if (!state) {
			return [];
		}

		if (state.tools) {
			return state.tools;
		}

		if (!state.client || state.status !== 'connected') {
			return [];
		}

		const fresh = await state.client.listTools();
		const tools = truncateToolDescriptions(fresh.tools);
		this.servers.set(id, {
			...state,
			tools,
			lastToolsAt: Date.now(),
		});
		return tools;
	}

	public listAllTools(): ToolWithMeta[] {
		return Array.from(this.servers.values())
			.filter((state) => state.status === 'connected' && state.tools)
			.flatMap((state) => state.tools!.map((tool) => ({
				serverId: state.config.id,
				serverName: state.config.name,
				tool,
			})));
	}

	public async callTool(
		id: string,
		name: string,
		args: Record<string, unknown>,
	): Promise<CallToolResult> {
		const state = this.servers.get(id);
		if (!state || !state.client || state.status !== 'connected') {
			throw new Error(`MCP server ${id} is not connected`);
		}

		return state.client.callTool(
			{ name, arguments: args },
			undefined,
			{
				timeout: state.config.timeout ?? 30_000,
				resetTimeoutOnProgress: true,
			},
		) as Promise<CallToolResult>;
	}

	public searchTools(
		query: string,
		options: { server?: string; maxResults?: number } = {},
	): ToolWithMeta[] {
		return searchMcpTools(this.listAllTools(), query, options);
	}

	public getServerForTool(toolName: string): string | undefined {
		const normalizedToolName = stripMcpToolPrefix(toolName);

		for (const [serverId, state] of this.servers) {
			if ((state.tools ?? []).some((tool) => tool.name === normalizedToolName)) {
				return serverId;
			}
		}

		return undefined;
	}

	public async shutdown(): Promise<void> {
		const closeOperations = Array.from(this.servers.entries()).map(async ([id, state]) => {
			if (!state.client) {
				return;
			}

			try {
				if (state.transport === 'stdio' && state.pid) {
					await killDescendants(state.pid);
				}
				await state.client.close();
			} catch (error) {
				console.warn(
					`Failed to close MCP client ${id} during shutdown: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		});

		await Promise.all(closeOperations);
		this.servers.clear();
	}

	private async connectSafely(id: string): Promise<void> {
		await this.connect(id);
	}

	private async connectStdio(config: Extract<McpServerConfig, { transport: 'stdio' }>): Promise<{ client: MCPClient; transport: 'stdio'; pid?: number }> {
		const client = this.clientFactory();
		const transport = this.makeStdioTransport(config);

		try {
			await this.connectClient(client, transport, config.timeout);
			return { client, transport: 'stdio', pid: transport.pid ?? undefined };
		} catch (error) {
			await this.closeAfterFailedConnect(client, transport);
			throw error;
		}
	}

	private async connectRemote(config: Extract<McpServerConfig, { transport: 'sse' | 'streamable-http' }>): Promise<{ client: MCPClient; transport: 'sse' | 'streamable-http'; pid?: number }> {
		const streamableClient = this.clientFactory();
		const streamableTransport = await this.makeRemoteTransport(config);

		try {
			await this.connectClient(streamableClient, streamableTransport, config.timeout);
			return { client: streamableClient, transport: 'streamable-http' };
		} catch (streamableError) {
			await this.closeAfterFailedConnect(streamableClient, streamableTransport);
			const streamableMessage = streamableError instanceof Error ? streamableError.message : String(streamableError);
			console.debug(`StreamableHTTP MCP connection failed for ${config.name}; falling back to SSE: ${streamableMessage}`);

			const client = this.clientFactory();
			const transport = this.makeSSETransport(config);

			try {
				await this.connectClient(client, transport, config.timeout);
				return { client, transport: 'sse' };
			} catch (sseError) {
				await this.closeAfterFailedConnect(client, transport);
				const sseMessage = sseError instanceof Error ? sseError.message : String(sseError);
				throw new Error(`StreamableHTTP failed: ${streamableMessage}; SSE failed: ${sseMessage}`);
			}
		}
	}

	private async connectClient(client: MCPClient, transport: MCPTransport | MCPRemoteTransport, timeout: number): Promise<void> {
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				client.connect(transport as Transport),
				new Promise<never>((_, reject) => {
					timeoutHandle = setTimeout(() => reject(new Error(`MCP connection timed out after ${timeout}ms`)), timeout);
				}),
			]);
		} finally {
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
			}
		}
	}

	private async closeAfterFailedConnect(client: MCPClient, transport: MCPTransport | MCPRemoteTransport): Promise<void> {
		await Promise.allSettled([
			client.close(),
			transport.close(),
		]);
	}

	private async getServerConfig(id: string): Promise<McpServerConfig | undefined> {
		const configResult = await this.config.getConfig();
		if (!configResult.ok) {
			return undefined;
		}

		return configResult.data.mcp.find((serverConfig) => serverConfig.id === id);
	}

	private setState(id: string, state: MCPServerState): void {
		this.servers.set(id, state);
		this.emitStatus(id, state.status, state.error);
	}

	private updateStatus(id: string, status: MCPServerStatus, error?: string): void {
		const existing = this.servers.get(id);
		if (!existing) {
			return;
		}

		const nextState: MCPServerState = {
			...existing,
			status,
			error,
		};
		this.servers.set(id, nextState);
		this.emitStatus(id, status, error);
	}

	private emitStatus(id: string, status: MCPServerStatus, error?: string): void {
		this.onStatusChange?.({
			type: 'mcp.status.changed',
			serverId: id,
			status,
			error,
		});
	}

	private async runWithConcurrency<T>(
		items: T[],
		concurrency: number,
		worker: (item: T) => Promise<void>,
	): Promise<void> {
		let nextIndex = 0;
		const workerCount = Math.min(concurrency, items.length);

		await Promise.all(Array.from({ length: workerCount }, async () => {
			while (nextIndex < items.length) {
				const item = items[nextIndex];
				nextIndex += 1;
				if (item !== undefined) {
					await worker(item);
				}
			}
		}));
	}
}

function truncateToolDescriptions(tools: Tool[]): Tool[] {
	return tools.map((tool) => ({
		...tool,
		description: tool.description?.slice(0, MAX_MCP_DESCRIPTION_LENGTH),
	}));
}

function stripMcpToolPrefix(toolName: string): string {
	const parts = toolName.split('__');
	if (parts.length >= 3 && parts[0] === 'mcp') {
		return parts.slice(2).join('__');
	}

	return toolName;
}
