import { describe, expect, it } from 'bun:test';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

import type { MCPManager } from './manager.ts';
import {
	createMcpToolDefinitions,
	sanitizeMcpName,
	serializeMcpResult,
} from './adapter.ts';
import type { ToolWithMeta } from './types.ts';
import type { RunContext } from '../runs/types.ts';

function runContext(): RunContext {
	return {
		runId: 'run-1',
		depth: 0,
		agentType: 'executor',
		title: 'Run',
		sessionId: 'session-1',
		projectId: 'project-1',
		signal: new AbortController().signal,
		discoveredMcpTools: new Set<string>(),
	};
}

function tool(name: string, description = 'Test tool'): Tool {
	return {
		name,
		description,
		inputSchema: {
			type: 'object',
			required: ['path'],
			properties: {
				path: { type: 'string', description: 'Path to inspect' },
				recursive: { type: 'boolean', description: 'Recurse into directories' },
			},
		},
	};
}

function manager(options: {
	tools: ToolWithMeta[];
	callTool?: (serverId: string, name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
	timeout?: number;
}): MCPManager {
	return {
		listAllTools: () => options.tools,
		callTool: options.callTool ?? (async () => ({ content: [{ type: 'text', text: 'ok' }] } as CallToolResult)),
		getTimeout: () => options.timeout ?? 30_000,
	} as unknown as MCPManager;
}

describe('MCP adapter', () => {
	it('sanitizes server and tool names into mcp__server__tool format', () => {
		const definitions = createMcpToolDefinitions(manager({
			tools: [{ serverId: 'server-1', serverName: 'local fs!!', tool: tool('read:file') }],
		}), runContext());

		expect(definitions.map((definition) => definition.name)).toEqual(['mcp__local_fs__read_file']);
		expect(sanitizeMcpName('a!!b')).toBe('a_b');
	});

	it('keeps raw input JSON schema on generated definitions', () => {
		const mcpTool = tool('read_file');
		const definitions = createMcpToolDefinitions(manager({
			tools: [{ serverId: 'server-1', serverName: 'filesystem', tool: mcpTool }],
		}), runContext());

		expect(definitions[0]?.inputJSONSchema).toBe(mcpTool.inputSchema);
		expect(definitions[0]?.parameters.path?.required).toBe(true);
		expect(definitions[0]?.parameters.recursive?.type).toBe('boolean');
	});

	it('serializes text, image, and resource content', () => {
		const output = serializeMcpResult({
			content: [
				{ type: 'text', text: 'hello' },
				{ type: 'image', mimeType: 'image/png', data: 'abc' },
				{ type: 'resource_link', uri: 'file:///tmp/example.txt' },
			],
		} as CallToolResult);

		expect(output).toBe('hello\n[image: image/png image]\n[resource: file:///tmp/example.txt]');
	});

	it('serializes error results to their text content', () => {
		const output = serializeMcpResult({
			isError: true,
			content: [{ type: 'text', text: 'server exploded' }],
		} as CallToolResult);

		expect(output).toBe('server exploded');
	});

	it('executes through manager.callTool and returns serialized output', async () => {
		const calls: Array<{ serverId: string; name: string; args: Record<string, unknown> }> = [];
		const definitions = createMcpToolDefinitions(manager({
			tools: [{ serverId: 'server-1', serverName: 'filesystem', tool: tool('read_file') }],
			callTool: async (serverId, name, args) => {
				calls.push({ serverId, name, args });
				return { content: [{ type: 'text', text: `read ${String(args.path)}` }] } as CallToolResult;
			},
		}), runContext());

		const result = await definitions[0]!.execute({ path: '/tmp/a' });

		expect(calls).toEqual([{ serverId: 'server-1', name: 'read_file', args: { path: '/tmp/a' } }]);
		expect(result).toEqual({ ok: true, data: 'read /tmp/a' });
	});

	it('returns an error result when MCP marks the tool output as error', async () => {
		const definitions = createMcpToolDefinitions(manager({
			tools: [{ serverId: 'server-1', serverName: 'filesystem', tool: tool('read_file') }],
			callTool: async () => ({ isError: true, content: [{ type: 'text', text: 'permission denied' }] } as CallToolResult),
		}), runContext());

		const result = await definitions[0]!.execute({ path: '/root' });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('TOOL_EXECUTION_FAILED');
			expect(result.error.message).toBe('permission denied');
		}
	});

	it('returns an error result when manager.callTool throws', async () => {
		const definitions = createMcpToolDefinitions(manager({
			tools: [{ serverId: 'server-1', serverName: 'filesystem', tool: tool('read_file') }],
			callTool: async () => {
				throw new Error('network unavailable');
			},
		}), runContext());

		const result = await definitions[0]!.execute({ path: '/tmp' });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toBe('network unavailable');
		}
	});
});
