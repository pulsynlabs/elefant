import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import type { McpServerConfig } from '../config/schema.ts';

export type MCPServerStatus = 'connecting' | 'connected' | 'disabled' | 'failed';

export interface MCPServerState {
	config: McpServerConfig;
	client?: Client;
	status: MCPServerStatus;
	error?: string;
	tools?: Tool[];
	lastToolsAt?: number;
	transport?: 'stdio' | 'sse' | 'streamable-http';
}

export interface ToolWithMeta {
	serverId: string;
	serverName: string;
	tool: Tool;
}

export type MCPStatusEvent = {
	type: 'mcp.status.changed';
	serverId: string;
	status: MCPServerStatus;
	error?: string;
};
