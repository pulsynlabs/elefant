import type { ToolDefinition } from '../types/tools.ts';
import type { ToolWithMeta } from './types.ts';

export const MAX_MCP_DESCRIPTION_LENGTH = 2048;
export const MAX_TOOL_DESCRIPTION_LENGTH = 2048;

const CHARS_PER_TOKEN = 2.5;
const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_TOKEN_BUDGET_PERCENT = 10;

export type ToolType = 'mcp' | 'builtin' | 'skill';

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

function isToolWithMeta(entry: ToolWithMeta | ToolDefinition): entry is ToolWithMeta {
	return 'tool' in entry && 'serverId' in entry;
}

function estimateMetaFields(entry: ToolWithMeta | ToolDefinition): number {
	if (isToolWithMeta(entry)) {
		const tool = entry.tool;
		return tool.name.length
			+ (tool.description?.slice(0, MAX_MCP_DESCRIPTION_LENGTH).length ?? 0)
			+ estimateChars(tool.inputSchema);
	}

	return entry.name.length
		+ (entry.description?.slice(0, MAX_TOOL_DESCRIPTION_LENGTH).length ?? 0)
		+ estimateChars(entry.parameters);
}

/**
 * Estimate token cost for a tool list (MCP ToolWithMeta or generic ToolDefinition):
 * name + description + input schema/parameters.
 */
export function estimateToolTokens(tools: ToolWithMeta[] | ToolDefinition[]): number {
	const chars = tools.reduce((total, entry) => total + estimateMetaFields(entry), 0);
	return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Estimate MCP tool token cost: name + description + input_schema.
 *
 * @deprecated Use {@link estimateToolTokens} for unified estimation across all tool types.
 */
export function estimateMcpToolTokens(tools: ToolWithMeta[]): number {
	return estimateToolTokens(tools);
}

/**
 * Should deferred loading be used for this tool type?
 *
 * Returns true when the estimated token cost of the provided tools exceeds
 * a configurable percentage of the context window. Returns false (auto-disable)
 * when the catalog is small enough to load upfront without impact.
 *
 * @param toolType  Category of tools being evaluated — drives log prefix only.
 * @param tools     Tool list in either MCP ({@link ToolWithMeta}) or
 *                  generic ({@link ToolDefinition}) format.
 * @param options   Budget tuning overrides.
 */
export function shouldDeferTools(
	toolType: ToolType,
	tools: ToolWithMeta[] | ToolDefinition[],
	options: { contextWindow?: number; tokenBudgetPercent?: number },
): boolean {
	const tokenBudgetPercent = options.tokenBudgetPercent ?? DEFAULT_TOKEN_BUDGET_PERCENT;

	if (tokenBudgetPercent <= 0) {
		console.debug(`[budget] ${toolType} defer decision`, {
			toolTokens: estimateToolTokens(tools),
			contextWindow: options.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
			tokenBudgetPercent,
			thresholdTokens: 0,
			defer: true,
			reason: 'tokenBudgetPercent=0',
		});
		return true;
	}

	if (tokenBudgetPercent >= 100) {
		console.debug(`[budget] ${toolType} defer decision`, {
			toolTokens: estimateToolTokens(tools),
			contextWindow: options.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
			tokenBudgetPercent,
			thresholdTokens: Infinity,
			defer: false,
			reason: 'tokenBudgetPercent=100',
		});
		return false;
	}

	const contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
	const toolTokens = estimateToolTokens(tools);
	const thresholdTokens = contextWindow * (tokenBudgetPercent / 100);
	const defer = toolTokens > thresholdTokens;

	console.debug(`[budget] ${toolType} defer decision`, {
		toolTokens,
		contextWindow,
		tokenBudgetPercent,
		thresholdTokens,
		defer,
	});

	return defer;
}

/**
 * Should selective (deferred) loading be used for MCP tools?
 *
 * Thin alias for {@link shouldDeferTools} with {@code toolType: 'mcp'}.
 * Retained for backward compatibility.
 */
export function shouldUseSelectiveLoading(
	tools: ToolWithMeta[],
	options: { contextWindow?: number; tokenBudgetPercent?: number },
): boolean {
	return shouldDeferTools('mcp', tools, options);
}
