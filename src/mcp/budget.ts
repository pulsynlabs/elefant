import type { ToolWithMeta } from './types.ts';

export const MAX_MCP_DESCRIPTION_LENGTH = 2048;

const CHARS_PER_TOKEN = 2.5;
const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_TOKEN_BUDGET_PERCENT = 10;

function estimateChars(value: unknown): number {
	if (typeof value === 'string') {
		return value.length;
	}

	try {
		return JSON.stringify(value).length;
	} catch {
		return String(value).length;
	}
}

/**
 * Estimate MCP tool token cost: name + description + input_schema.
 */
export function estimateMcpToolTokens(tools: ToolWithMeta[]): number {
	const chars = tools.reduce((total, entry) => {
		const tool = entry.tool;
		return total
			+ tool.name.length
			+ (tool.description?.slice(0, MAX_MCP_DESCRIPTION_LENGTH).length ?? 0)
			+ estimateChars(tool.inputSchema);
	}, 0);

	return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Should selective loading be used?
 * Returns true if total MCP tool tokens > (contextWindow * budgetPercent / 100).
 */
export function shouldUseSelectiveLoading(
	tools: ToolWithMeta[],
	options: { contextWindow?: number; tokenBudgetPercent?: number },
): boolean {
	const tokenBudgetPercent = options.tokenBudgetPercent ?? DEFAULT_TOKEN_BUDGET_PERCENT;

	if (tokenBudgetPercent <= 0) {
		console.debug('[mcp] selective loading decision', {
			toolTokens: estimateMcpToolTokens(tools),
			contextWindow: options.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
			tokenBudgetPercent,
			thresholdTokens: 0,
			selective: true,
			reason: 'tokenBudgetPercent=0',
		});
		return true;
	}

	if (tokenBudgetPercent >= 100) {
		console.debug('[mcp] selective loading decision', {
			toolTokens: estimateMcpToolTokens(tools),
			contextWindow: options.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
			tokenBudgetPercent,
			thresholdTokens: Infinity,
			selective: false,
			reason: 'tokenBudgetPercent=100',
		});
		return false;
	}

	const contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
	const toolTokens = estimateMcpToolTokens(tools);
	const thresholdTokens = contextWindow * (tokenBudgetPercent / 100);
	const selective = toolTokens > thresholdTokens;

	console.debug('[mcp] selective loading decision', {
		toolTokens,
		contextWindow,
		tokenBudgetPercent,
		thresholdTokens,
		selective,
	});

	return selective;
}
