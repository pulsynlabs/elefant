import { describe, expect, it } from 'bun:test';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { shouldUseSelectiveLoading } from './budget.ts';
import type { ToolWithMeta } from './types.ts';

function tool(name: string, description: string): ToolWithMeta {
	const mcpTool: Tool = {
		name,
		description,
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Path to inspect' },
			},
		},
	};

	return { serverId: 'server-id', serverName: 'filesystem', tool: mcpTool };
}

describe('MCP token budget', () => {
	it('returns true when tools exceed threshold', () => {
		const tools = [tool('large_tool', 'a'.repeat(1_000))];

		expect(shouldUseSelectiveLoading(tools, { contextWindow: 1_000, tokenBudgetPercent: 10 })).toBe(true);
	});

	it('returns false when tools are below threshold', () => {
		const tools = [tool('small_tool', 'small')];

		expect(shouldUseSelectiveLoading(tools, { contextWindow: 10_000, tokenBudgetPercent: 10 })).toBe(false);
	});

	it('treats tokenBudgetPercent 0 as always selective', () => {
		expect(shouldUseSelectiveLoading([], { contextWindow: 10_000, tokenBudgetPercent: 0 })).toBe(true);
	});

	it('treats tokenBudgetPercent 100 as never selective', () => {
		const tools = [tool('huge_tool', 'a'.repeat(100_000))];

		expect(shouldUseSelectiveLoading(tools, { contextWindow: 1_000, tokenBudgetPercent: 100 })).toBe(false);
	});
});
