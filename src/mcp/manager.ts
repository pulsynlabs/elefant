import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

import type { ConfigManager } from '../config/loader.ts';
import type { McpServerConfig } from '../config/schema.ts';
import type {
	MCPServerState,
	MCPServerStatus,
	MCPStatusEvent,
	ToolWithMeta,
} from './types.ts';

const DEFAULT_INIT_CONCURRENCY = 8;

export class MCPManager {
	private readonly servers = new Map<string, MCPServerState>();
	private readonly initConcurrency: number;

	constructor(
		private config: ConfigManager,
		private onStatusChange?: (event: MCPStatusEvent) => void,
	) {
		this.initConcurrency = DEFAULT_INIT_CONCURRENCY;
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
		void id;
		throw new Error('not implemented');
	}

	public async disconnect(id: string): Promise<void> {
		const state = this.servers.get(id);
		if (!state) {
			return;
		}

		await state.client?.close();
		this.servers.delete(id);
	}

	public async reconnect(id: string): Promise<void> {
		await this.disconnect(id);
		await this.connect(id);
	}

	public getStatus(id: string): MCPServerStatus | undefined {
		return this.servers.get(id)?.status;
	}

	public async listTools(id: string): Promise<Tool[]> {
		void id;
		throw new Error('not implemented');
	}

	public listAllTools(): ToolWithMeta[] {
		const tools: ToolWithMeta[] = [];

		for (const [serverId, state] of this.servers) {
			for (const tool of state.tools ?? []) {
				tools.push({
					serverId,
					serverName: state.config.name,
					tool,
				});
			}
		}

		return tools;
	}

	public async callTool(
		id: string,
		name: string,
		args: Record<string, unknown>,
	): Promise<CallToolResult> {
		void id;
		void name;
		void args;
		throw new Error('not implemented');
	}

	public searchTools(
		query: string,
		options: { server?: string; maxResults?: number } = {},
	): ToolWithMeta[] {
		const normalizedQuery = query.trim().toLowerCase();
		const maxResults = options.maxResults ?? 5;
		const candidates = this.listAllTools().filter((entry) => (
			options.server === undefined
			|| entry.serverId === options.server
			|| entry.serverName === options.server
		));

		if (normalizedQuery.startsWith('select:')) {
			const selectedNames = new Set(
				normalizedQuery
					.slice('select:'.length)
					.split(',')
					.map((name) => name.trim())
					.filter((name) => name.length > 0),
			);

			return candidates
				.filter((entry) => selectedNames.has(entry.tool.name.toLowerCase()))
				.slice(0, maxResults);
		}

		if (normalizedQuery.length === 0) {
			return candidates.slice(0, maxResults);
		}

		return candidates
			.filter((entry) => this.toolMatchesQuery(entry, normalizedQuery))
			.slice(0, maxResults);
	}

	public getServerForTool(toolName: string): string | undefined {
		for (const [serverId, state] of this.servers) {
			if ((state.tools ?? []).some((tool) => tool.name === toolName)) {
				return serverId;
			}
		}

		return undefined;
	}

	public async shutdown(): Promise<void> {
		const closeOperations = Array.from(this.servers.values()).map(async (state) => {
			await state.client?.close();
		});

		await Promise.all(closeOperations);
		this.servers.clear();
	}

	private async connectSafely(id: string): Promise<void> {
		try {
			await this.connect(id);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.updateStatus(id, 'failed', message);
		}
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

	private toolMatchesQuery(entry: ToolWithMeta, normalizedQuery: string): boolean {
		return entry.tool.name.toLowerCase().includes(normalizedQuery)
			|| entry.serverName.toLowerCase().includes(normalizedQuery)
			|| (entry.tool.description?.toLowerCase().includes(normalizedQuery) ?? false);
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
