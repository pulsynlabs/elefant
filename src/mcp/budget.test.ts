import { describe, expect, it } from 'bun:test';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { estimateToolTokens, isAlwaysLoadTool, shouldDeferTools, shouldUseSelectiveLoading } from './budget.ts';
import type { ToolType } from './budget.ts';
import type { ToolWithMeta } from './types.ts';
import type { ToolDefinition } from '../types/tools.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mcpTool(name: string, description: string): ToolWithMeta {
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

function builtinTool(name: string, description: string): ToolDefinition {
	return {
		name,
		description,
		parameters: {
			path: { type: 'string', description: 'Path to inspect' },
		},
		execute: async () => ({ ok: true, data: '' }),
	};
}

function stubToolDef(name: string, description: string): ToolDefinition {
	return builtinTool(name, description);
}

// ---------------------------------------------------------------------------
// estimateToolTokens
// ---------------------------------------------------------------------------

describe('estimateToolTokens', () => {
	it('estimates tokens for MCP format (ToolWithMeta[])', () => {
		const tools: ToolWithMeta[] = [mcpTool('my_tool', 'hello world')];
		const tokens = estimateToolTokens(tools);
		expect(tokens).toBeGreaterThan(0);
		expect(typeof tokens).toBe('number');
	});

	it('estimates tokens for built-in format (ToolDefinition[])', () => {
		const tools: ToolDefinition[] = [builtinTool('my_tool', 'hello world')];
		const tokens = estimateToolTokens(tools);
		expect(tokens).toBeGreaterThan(0);
		expect(typeof tokens).toBe('number');
	});

	it('returns 0 for an empty array', () => {
		expect(estimateToolTokens([])).toBe(0);
	});

	it('scales with larger descriptions', () => {
		const small = estimateToolTokens([stubToolDef('t', 'x')]);
		const large = estimateToolTokens([stubToolDef('t', 'x'.repeat(20_000))]);
		expect(large).toBeGreaterThan(small);
	});

	it('returns the same value for estimateMcpToolTokens backward compat', async () => {
		// Import estimateMcpToolTokens dynamically to confirm it still exists.
		const { estimateMcpToolTokens } = await import('./budget.ts');
		const tools: ToolWithMeta[] = [
			mcpTool('tool_a', 'describes something'),
			mcpTool('tool_b', 'another description'),
		];
		expect(estimateMcpToolTokens(tools)).toBe(estimateToolTokens(tools));
	});
});

// ---------------------------------------------------------------------------
// shouldDeferTools — core contract
// ---------------------------------------------------------------------------

describe('shouldDeferTools', () => {
	const empty: ToolWithMeta[] = [];
	const C10K = 10_000;
	const C200K = 200_000;
	const PERCENT_10 = 10;

	// -- Edge: empty --------------------------------------------------------

	it('returns false for empty registry (auto-disable)', () => {
		for (const toolType of ['mcp', 'builtin', 'skill'] as ToolType[]) {
			expect(shouldDeferTools(toolType, empty, { contextWindow: C200K, tokenBudgetPercent: PERCENT_10 })).toBe(
				false,
			);
		}
	});

	// -- Edge: tokenBudgetPercent 0 → always true ---------------------------

	it('returns true when tokenBudgetPercent is 0 (all types)', () => {
		for (const toolType of ['mcp', 'builtin', 'skill'] as ToolType[]) {
			expect(shouldDeferTools(toolType, empty, { contextWindow: C10K, tokenBudgetPercent: 0 })).toBe(true);
		}
	});

	// -- Edge: tokenBudgetPercent 100 → always false ------------------------

	it('returns false when tokenBudgetPercent is 100 (all types)', () => {
		const huge = [mcpTool('h', 'h'.repeat(100_000))];
		for (const toolType of ['mcp', 'builtin', 'skill'] as ToolType[]) {
			expect(shouldDeferTools(toolType, huge, { contextWindow: 1_000, tokenBudgetPercent: 100 })).toBe(false);
		}
	});

	// -- Boundary: just below threshold -------------------------------------

	it('returns false when just below threshold (mcp)', () => {
		// 100 token budget, tools cost ~99 tokens
		// contextWindow=1000, 10% = 100 tokens. One small tool < 100.
		const below = [mcpTool('s', 'short')];
		expect(shouldDeferTools('mcp', below, { contextWindow: 1_000, tokenBudgetPercent: PERCENT_10 })).toBe(false);
	});

	// -- Boundary: just above threshold -------------------------------------

	it('returns true when just above threshold (mcp)', () => {
		const above = [mcpTool('large', 'a'.repeat(1_000))];
		expect(shouldDeferTools('mcp', above, { contextWindow: 1_000, tokenBudgetPercent: PERCENT_10 })).toBe(true);
	});

	// -- Per-type: builtin --------------------------------------------------

	it('evaluates built-in tools with same budget logic', () => {
		const below: ToolDefinition[] = [stubToolDef('s', 'short')];
		const above: ToolDefinition[] = [stubToolDef('l', 'l'.repeat(1_000))];

		expect(shouldDeferTools('builtin', below, { contextWindow: 1_000, tokenBudgetPercent: PERCENT_10 })).toBe(
			false,
		);
		expect(shouldDeferTools('builtin', above, { contextWindow: 1_000, tokenBudgetPercent: PERCENT_10 })).toBe(true);
	});

	// -- Per-type: skill ----------------------------------------------------

	it('evaluates skill tools with same budget logic', () => {
		const below: ToolDefinition[] = [stubToolDef('s', 'short')];
		const above: ToolDefinition[] = [stubToolDef('l', 'l'.repeat(1_000))];

		expect(shouldDeferTools('skill', below, { contextWindow: 1_000, tokenBudgetPercent: PERCENT_10 })).toBe(false);
		expect(shouldDeferTools('skill', above, { contextWindow: 1_000, tokenBudgetPercent: PERCENT_10 })).toBe(true);
	});

	// -- Defaults -----------------------------------------------------------

	it('uses DEFAULT_CONTEXT_WINDOW and DEFAULT_TOKEN_BUDGET_PERCENT when options omitted', () => {
		// 10% of 200k = 20k tokens. 500 medium tools should exceed that.
		const largeSet = Array.from({ length: 500 }, (_, i) => mcpTool(`t_${i}`, 'description '.repeat(40)));
		expect(shouldDeferTools('mcp', largeSet, {})).toBe(true);
	});

	// -- MCP format + options -----------------------------------------------

	it('accepts MCP ToolWithMeta format', () => {
		const tools = [mcpTool('large', 'a'.repeat(1_000))];
		expect(shouldDeferTools('mcp', tools, { contextWindow: 1_000, tokenBudgetPercent: PERCENT_10 })).toBe(true);
	});

	// -- Mixed-category test: different types, same tool list, same result --

	it('returns consistent results across types for identical tool lists', () => {
		const tools: ToolDefinition[] = [
			stubToolDef('tool_a', 'First tool'),
			stubToolDef('tool_b', 'Second tool description'),
		];
		const results = (['mcp', 'builtin', 'skill'] as ToolType[]).map((t) =>
			shouldDeferTools(t, tools, { contextWindow: C200K, tokenBudgetPercent: PERCENT_10 }),
		);
		expect(results[0]).toBe(results[1]);
		expect(results[1]).toBe(results[2]);
	});
});

// ---------------------------------------------------------------------------
// shouldUseSelectiveLoading — backward compat
// ---------------------------------------------------------------------------

describe('shouldUseSelectiveLoading (backward compat)', () => {
	it('returns true when tools exceed threshold', () => {
		const tools = [mcpTool('large_tool', 'a'.repeat(1_000))];
		expect(shouldUseSelectiveLoading(tools, { contextWindow: 1_000, tokenBudgetPercent: 10 })).toBe(true);
	});

	it('returns false when tools are below threshold', () => {
		const tools = [mcpTool('small_tool', 'small')];
		expect(shouldUseSelectiveLoading(tools, { contextWindow: 10_000, tokenBudgetPercent: 10 })).toBe(false);
	});

	it('treats tokenBudgetPercent 0 as always selective', () => {
		expect(shouldUseSelectiveLoading([], { contextWindow: 10_000, tokenBudgetPercent: 0 })).toBe(true);
	});

	it('treats tokenBudgetPercent 100 as never selective', () => {
		const tools = [mcpTool('huge_tool', 'a'.repeat(100_000))];
		expect(shouldUseSelectiveLoading(tools, { contextWindow: 1_000, tokenBudgetPercent: 100 })).toBe(false);
	});

	it('produces the same result as shouldDeferTools(mcp)', () => {
		const tools = [mcpTool('test', 'some description'), mcpTool('other', 'another description')];
		expect(shouldUseSelectiveLoading(tools, { contextWindow: 50_000, tokenBudgetPercent: 10 })).toBe(
			shouldDeferTools('mcp', tools, { contextWindow: 50_000, tokenBudgetPercent: 10 }),
		);
	});
});

// ---------------------------------------------------------------------------
// isAlwaysLoadTool — per-tool config check
// ---------------------------------------------------------------------------

describe('isAlwaysLoadTool', () => {
	it('returns true when tool is in config.alwaysLoad list', () => {
		const config = { alwaysLoad: ['read_file', 'write_file'] };
		expect(isAlwaysLoadTool('filesystem', 'read_file', config)).toBe(true);
		expect(isAlwaysLoadTool('filesystem', 'write_file', config)).toBe(true);
	});

	it('returns false for tools NOT in the per-tool alwaysLoad list', () => {
		const config = { alwaysLoad: ['read_file'] };
		expect(isAlwaysLoadTool('filesystem', 'search_files', config)).toBe(false);
		expect(isAlwaysLoadTool('filesystem', 'delete_file', config)).toBe(false);
	});

	it('returns false when config.alwaysLoad is empty (both off)', () => {
		const config = { alwaysLoad: [] };
		expect(isAlwaysLoadTool('filesystem', 'any_tool', config)).toBe(false);
	});

	it('returns false for unknown tools (not in the list)', () => {
		const config = { alwaysLoad: ['read_file'] };
		expect(isAlwaysLoadTool('filesystem', 'nonexistent_tool', config)).toBe(false);
	});

	it('returns false when alwaysLoad is undefined (missing field)', () => {
		const config = {} as { alwaysLoad?: string[] };
		expect(isAlwaysLoadTool('filesystem', 'any_tool', config)).toBe(false);
	});
});
