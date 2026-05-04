import { describe, expect, it } from 'bun:test';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import type { MCPManager } from './manager.ts';
import { createMcpSearchToolsTool } from './meta-tools.ts';
import type { ToolWithMeta } from './types.ts';
import type { RunContext } from '../runs/types.ts';

function tool(name: string, description: string): Tool {
	return {
		name,
		description,
		inputSchema: {
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			type: 'object',
			additionalProperties: false,
			properties: {
				path: {
					type: 'string',
					additionalProperties: false,
				},
			},
		},
	};
}

function entry(serverName: string, mcpTool: Tool): ToolWithMeta {
	return { serverId: `${serverName}-id`, serverName, tool: mcpTool };
}

function runContext(discoveredTools = new Set<string>()): RunContext {
	return {
		runId: 'run-1',
		depth: 0,
		agentType: 'executor',
		title: 'Run',
		sessionId: 'session-1',
		projectId: 'project-1',
		signal: new AbortController().signal,
		discoveredTools,
	};
}

function managerReturning(matches: ToolWithMeta[]): MCPManager {
	return {
		listAllTools: () => matches,
	} as unknown as MCPManager;
}

function parseToolResult(output: string): { tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }> } {
	return JSON.parse(output) as { tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }> };
}

describe('createMcpSearchToolsTool', () => {
	it('returns matching tools for keyword queries', async () => {
		const ctx = runContext();
		const searchTool = createMcpSearchToolsTool({
			manager: managerReturning([entry('filesystem', tool('read_file', 'Read local files'))]),
			getRunContext: () => ctx,
		});

		const result = await searchTool.execute({ query: 'read', max_results: 5 });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(parseToolResult(result.data).tools.map((match) => match.name)).toEqual(['read_file']);
		}
	});

	it('returns tools for select queries', async () => {
		const ctx = runContext();
		const searchTool = createMcpSearchToolsTool({
			manager: managerReturning([
				entry('filesystem', tool('read_file', 'Read local files')),
				entry('filesystem', tool('write_file', 'Write local files')),
			]),
			getRunContext: () => ctx,
		});

		const result = await searchTool.execute({ query: 'select:write_file' });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(parseToolResult(result.data).tools.map((match) => match.name)).toEqual(['write_file']);
		}
	});

	it('mutates runContext.discoveredTools and strips schema noise', async () => {
		const ctx = runContext();
		const searchTool = createMcpSearchToolsTool({
			manager: managerReturning([entry('filesystem', tool('read_file', 'Read local files'))]),
			getRunContext: () => ctx,
		});

		const result = await searchTool.execute({ query: 'read' });

		expect(ctx.discoveredTools.has('read_file')).toBe(true);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const schema = parseToolResult(result.data).tools[0]?.input_schema;
			expect(schema).not.toHaveProperty('$schema');
			expect(schema).not.toHaveProperty('additionalProperties');
			expect((schema.properties as Record<string, unknown>).path).not.toHaveProperty('additionalProperties');
		}
	});

	it('returns already-discovered tools without throwing', async () => {
		const discovered = new Set<string>(['read_file']);
		const ctx = runContext(discovered);
		const searchTool = createMcpSearchToolsTool({
			manager: managerReturning([entry('filesystem', tool('read_file', 'Read local files'))]),
			getRunContext: () => ctx,
		});

		const result = await searchTool.execute({ query: 'select:read_file' });

		expect(result.ok).toBe(true);
		expect(ctx.discoveredTools.size).toBe(1);
		if (result.ok) {
			expect(parseToolResult(result.data).tools.map((match) => match.name)).toEqual(['read_file']);
		}
	});
});
