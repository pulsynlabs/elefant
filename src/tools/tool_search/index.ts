/**
 * tool_search — discover and load tool schemas on demand.
 *
 * Wraps the in-memory search index (index-builder.ts), writes discovered
 * tool names into RunContext.discoveredTools, and returns a structured
 * response the agent can use to invoke the newly-discovered tools.
 */

import type { ToolDefinition } from '../../types/tools.js';
import type { ElefantError } from '../../types/errors.js';
import type { Result } from '../../types/result.js';
import { ok } from '../../types/result.js';
import type { RunContext } from '../../runs/types.js';
import type { ToolRegistry } from '../registry.js';
import { buildToolIndex, searchIndex, type IndexEntry, type ToolCategory } from './index-builder.js';

export interface ToolSearchParams {
	query?: string;
	names?: string[];
	category?: 'builtin' | 'mcp' | 'skill' | 'all';
	limit?: number;
}

export interface ToolSearchDeps {
	registry: ToolRegistry;
	runContext: RunContext;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Infer an IndexEntry category from a tool name.
 *
 * MCP tools carry an `mcp__` prefix.  Everything else is `builtin` for now;
 * skill catalog integration is added in Task 5.2.
 */
function inferCategory(name: string): ToolCategory {
	if (name.startsWith('mcp__')) return 'mcp';
	return 'builtin';
}

/**
 * Format a single tool definition for agent-readable output.
 * Mirrors the structure used by tool_list so the agent gets consistent
 * schema information in either path.
 */
function formatToolResult(tool: ToolDefinition): string {
	const params = Object.entries(tool.parameters)
		.map(([name, def]) => {
			const req = def.required === false ? 'optional' : 'required';
			return `  - ${name} (${def.type}, ${req}): ${def.description}`;
		})
		.join('\n');

	return [
		`## ${tool.name}`,
		`Description: ${tool.description}`,
		'Parameters:',
		params.length > 0 ? params : '  (none)',
	].join('\n');
}

/**
 * Build a human-readable result header line.
 */
function buildHeader(results: IndexEntry[], params: ToolSearchParams): string {
	const count = results.length;
	if (params.query && params.query.trim().length > 0) {
		return `Found ${count} tool${count === 1 ? '' : 's'} matching "${params.query.trim()}":\n\n`;
	}
	if (params.names && params.names.length > 0) {
		return `Found ${count} tool${count === 1 ? '' : 's'}:\n\n`;
	}
	if (params.category && params.category !== 'all') {
		return `Found ${count} tool${count === 1 ? '' : 's'} in category "${params.category}":\n\n`;
	}
	return `Found ${count} tool${count === 1 ? '' : 's'}:\n\n`;
}

/**
 * No-match message that tells the agent how to expand the search.
 */
function noMatchMessage(indexEntryCount: number): string {
	if (indexEntryCount === 0) {
		return 'No tools are currently registered.';
	}
	return (
		'No tools found matching your search. ' +
		'Try broadening the keyword, use `category: "all"` to search across all tool types, ' +
		'or provide exact names. ' +
		`Categories available: builtin, mcp, skill.`
	);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createToolSearchTool(deps: ToolSearchDeps): ToolDefinition<ToolSearchParams, string> {
	return {
		name: 'tool_search',
		description:
			`Search for available tools by keyword, exact name, or category. Use this to discover and load deferred tools before calling them.

Parameters:
- query: Keyword search (e.g., "git", "file read", "slack")
- names: Exact tool names to load (e.g., ["read_file", "write_file"])
- category: Filter by type — "builtin", "mcp", "skill", or "all"
- limit: Max results (default: 10)

Returns full tool descriptions for matched tools.`,
		parameters: {
			query: {
				type: 'string',
				description: 'Keyword search query (e.g., "git", "file read", "slack")',
				required: false,
			},
			names: {
				type: 'array',
				description: 'Exact tool names to load',
				required: false,
			},
			category: {
				type: 'string',
				description: 'Filter by type — "builtin", "mcp", "skill", or "all"',
				required: false,
			},
			limit: {
				type: 'number',
				description: 'Max results to return (default: 10)',
				required: false,
				default: 10,
			},
		},
		execute: async (params): Promise<Result<string, ElefantError>> => {
			const allTools = deps.registry.getAll();

			// Build the index on every call so the result always reflects the
			// live registry (plugins may register tools at any time).
			const entries: IndexEntry[] = allTools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				category: inferCategory(tool.name),
			}));

			const index = buildToolIndex(entries);
			const results = searchIndex(index, {
				query: params.query,
				names: params.names,
				category: params.category as ToolCategory | undefined,
				limit: params.limit,
			});

			// Always write matched names into the discovery set so the agent
			// loop can promote their schemas on the next turn.
			for (const entry of results) {
				deps.runContext.discoveredTools.add(entry.name);
			}

			if (results.length === 0) {
				return ok(noMatchMessage(entries.length));
			}

			// Resolve each index entry back to the full ToolDefinition so we
			// can emit parameter details.  Index entries only carry name +
			// description — the full schema lives in the registry.
			const descriptions = results.map((entry) => {
				const tool = allTools.find((t) => t.name === entry.name);
				if (tool) {
					return formatToolResult(tool);
				}
				// Defensive: registry was mutated between buildIndex and here.
				// Fall back to what the index holds.
				return [
					`## ${entry.name}`,
					`Description: ${entry.description}`,
					'Parameters:',
					'  (not available)',
				].join('\n');
			});

			return ok(buildHeader(results, params) + descriptions.join('\n\n'));
		},
	};
}
