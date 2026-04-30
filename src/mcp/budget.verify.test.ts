import { describe, expect, it } from 'bun:test';

import { estimateMcpToolTokens, shouldUseSelectiveLoading } from './budget.ts';
import type { ToolWithMeta } from './types.ts';
import { createMcpSearchToolsTool } from './meta-tools.ts';
import type { MCPManager } from './manager.ts';
import { createRunContext } from '../runs/context.ts';
import type { ToolDefinition } from '../types/tools.ts';

function createSyntheticTools(count: number): ToolWithMeta[] {
	return Array.from({ length: count }, (_, index) => ({
		serverId: 'synthetic',
		serverName: 'synthetic-server',
		tool: {
			name: `synthetic_tool_${index}`,
			description: 'x'.repeat(200),
			inputSchema: {
				type: 'object',
				required: Array.from({ length: 30 }, (__, propIndex) => `field_${propIndex}`),
				properties: Object.fromEntries(
					Array.from({ length: 30 }, (__, propIndex) => [
						`field_${propIndex}`,
						{
							type: 'string',
							description: `Detailed schema guidance ${index}:${propIndex} ${'y'.repeat(160)}`,
						},
					]),
				),
			},
		},
	}));
}

function estimateToolDefinitionTokens(tools: ToolDefinition[]): number {
	const chars = JSON.stringify(tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
		inputJSONSchema: tool.inputJSONSchema,
	}))).length;
	return Math.ceil(chars / 2.5);
}

describe('MCP token budget verification', () => {
	it('uses selective loading for a large synthetic 20-tool server and reduces first-turn tool tokens by at least 60%', () => {
		const tools = createSyntheticTools(20);
		const selective = shouldUseSelectiveLoading(tools, {
			contextWindow: 128_000,
			tokenBudgetPercent: 10,
		});

		expect(selective).toBe(true);

		const fullInjectionTokens = estimateMcpToolTokens(tools);
		const runContext = createRunContext({
			runId: 'run-token-budget',
			projectId: 'project-token-budget',
			sessionId: 'session-token-budget',
			depth: 0,
			agentType: 'primary',
			title: 'token budget verification',
			signal: new AbortController().signal,
		});
		const metaTool = createMcpSearchToolsTool({
			manager: {
				searchTools: () => [],
			} as unknown as MCPManager,
			getRunContext: () => runContext,
		});
		const selectiveInjectionTokens = estimateToolDefinitionTokens([metaTool as ToolDefinition<unknown, string>]);
		const reduction = 1 - (selectiveInjectionTokens / fullInjectionTokens);

		// Measured with this fixture: full injection is >12.8k tokens, while the
		// first selective turn injects only mcp_search_tools; reduction stays >99%.
		expect(selectiveInjectionTokens).toBeLessThanOrEqual(fullInjectionTokens * 0.4);
		expect(reduction).toBeGreaterThanOrEqual(0.6);
	});
});
