import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { McpRemoteConfig, McpStdioConfig } from '../config/schema.ts';

export type MCPTransport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;
export type MCPRemoteTransport = StreamableHTTPClientTransport | SSEClientTransport;

function getProcessEnv(): Record<string, string> {
	return Object.fromEntries(
		Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
	);
}

function remoteRequestInit(config: McpRemoteConfig): RequestInit | undefined {
	if (Object.keys(config.headers).length === 0) {
		return undefined;
	}

	return { headers: config.headers };
}

export function createStdioTransport(config: McpStdioConfig): StdioClientTransport {
	const [command, ...args] = config.command;
	if (!command) {
		throw new Error(`MCP stdio server ${config.name} is missing a command`);
	}

	return new StdioClientTransport({
		command,
		args,
		cwd: process.cwd(),
		env: {
			...getProcessEnv(),
			...(config.env ?? {}),
		},
	});
}

export function createStreamableHttpTransport(config: McpRemoteConfig): StreamableHTTPClientTransport {
	return new StreamableHTTPClientTransport(new URL(config.url), {
		requestInit: remoteRequestInit(config),
	});
}

export function createSSETransport(config: McpRemoteConfig): SSEClientTransport {
	return new SSEClientTransport(new URL(config.url), {
		requestInit: remoteRequestInit(config),
	});
}

export async function createRemoteTransport(config: McpRemoteConfig): Promise<MCPRemoteTransport> {
	return createStreamableHttpTransport(config);
}
