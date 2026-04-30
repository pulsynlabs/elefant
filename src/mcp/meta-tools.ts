import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import type { MCPManager } from './manager.ts';
import type { RunContext } from '../runs/types.ts';
import { ok } from '../types/result.ts';
import type { ToolDefinition } from '../types/tools.ts';

type JsonObject = { [key: string]: JsonValue };
type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

interface McpSearchToolsParams {
	query: string;
	server?: string;
	max_results?: number;
}

interface McpSearchToolResult {
	tools: Array<{
		name: string;
		description: string;
		input_schema: JsonValue;
	}>;
}

function isJsonObject(value: JsonValue): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown): JsonValue {
	if (
		value === null
		|| typeof value === 'string'
		|| typeof value === 'number'
		|| typeof value === 'boolean'
	) {
		return value;
	}

	if (Array.isArray(value)) {
		return value.map(toJsonValue);
	}

	if (typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, toJsonValue(nested)]),
		);
	}

	return String(value);
}

function stripSchemaTokenNoise(value: JsonValue): JsonValue {
	if (Array.isArray(value)) {
		return value.map(stripSchemaTokenNoise);
	}

	if (!isJsonObject(value)) {
		return value;
	}

	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => key !== '$schema' && key !== 'additionalProperties')
			.map(([key, nested]) => [key, stripSchemaTokenNoise(nested)]),
	);
}

function cleanInputSchema(tool: Tool): JsonValue {
	return stripSchemaTokenNoise(toJsonValue(tool.inputSchema));
}

/**
 * Create the mcp_search_tools tool definition.
 * This is a regular ToolDefinition registered alongside built-in tools.
 */
export function createMcpSearchToolsTool(deps: {
	manager: MCPManager;
	getRunContext: () => RunContext;
}): ToolDefinition<McpSearchToolsParams, string> {
	return {
		name: 'mcp_search_tools',
		description: "Search for MCP tools by keyword or exact name. Use 'select:tool_a,tool_b' to load specific tools. Returns tool schemas ready to use.",
		parameters: {
			query: {
				type: 'string',
				description: "Keyword search or exact selection, e.g. 'filesystem read' or 'select:list_directory,read_file'",
				required: true,
			},
			server: {
				type: 'string',
				description: 'Optional MCP server name or id to scope the search.',
			},
			max_results: {
				type: 'number',
				description: 'Maximum number of matching tools to return.',
				default: 5,
			},
		},
		execute: async (params) => {
			const maxResults = params.max_results ?? 5;
			const matches = deps.manager.searchTools(params.query, {
				server: params.server,
				maxResults,
			});

			const runContext = deps.getRunContext();
			for (const match of matches) {
				runContext.discoveredMcpTools.add(match.tool.name);
			}

			const result: McpSearchToolResult = {
				tools: matches.map((match) => ({
					name: match.tool.name,
					description: match.tool.description ?? '',
					input_schema: cleanInputSchema(match.tool),
				})),
			};

			return ok(JSON.stringify(result));
		},
	};
}
