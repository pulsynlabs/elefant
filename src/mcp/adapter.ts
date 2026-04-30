import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

import type { MCPManager } from './manager.ts';
import type { RunContext } from '../runs/types.ts';
import { MAX_TOOL_OUTPUT_CHARS, truncateToolOutput } from '../tools/registry.ts';
import type { ElefantError } from '../types/errors.ts';
import { err, ok } from '../types/result.ts';
import type { ParameterDefinition, ToolDefinition } from '../types/tools.ts';

type JsonSchemaObject = Record<string, unknown>;

type McpContentBlock = {
	type?: unknown;
	text?: unknown;
	mimeType?: unknown;
	mime_type?: unknown;
	uri?: unknown;
	resource?: unknown;
};

function createToolExecutionError(message: string): ElefantError {
	return {
		code: 'TOOL_EXECUTION_FAILED',
		message,
	};
}

export function sanitizeMcpName(value: string): string {
	const sanitized = value
		.replace(/[^a-zA-Z0-9_-]/g, '_')
		.replace(/__+/g, '_')
		.replace(/^_+|_+$/g, '');

	return sanitized.length > 0 ? sanitized : '_';
}

function isObject(value: unknown): value is JsonSchemaObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toParameterType(value: unknown): ParameterDefinition['type'] {
	if (Array.isArray(value)) {
		const firstType = value.find((entry) => typeof entry === 'string');
		return toParameterType(firstType);
	}

	switch (value) {
		case 'string':
			return 'string';
		case 'number':
		case 'integer':
			return 'number';
		case 'boolean':
			return 'boolean';
		case 'array':
			return 'array';
		case 'object':
		default:
			return 'object';
	}
}

function schemaToParameters(inputSchema: unknown): Record<string, ParameterDefinition> {
	if (!isObject(inputSchema) || !isObject(inputSchema.properties)) {
		return {};
	}

	const required = Array.isArray(inputSchema.required)
		? new Set(inputSchema.required.filter((name): name is string => typeof name === 'string'))
		: new Set<string>();

	return Object.fromEntries(
		Object.entries(inputSchema.properties).map(([name, schema]) => {
			const property = isObject(schema) ? schema : {};
			const description = typeof property.description === 'string'
				? property.description
				: `MCP parameter ${name}`;

			return [name, {
				type: toParameterType(property.type),
				description,
				required: required.has(name) || undefined,
			} satisfies ParameterDefinition];
		}),
	);
}

function stripInternalToolArgs(args: JsonSchemaObject): Record<string, unknown> {
	const {
		conversationId: _conversationId,
		_toolCallId,
		_questionEmitter,
		...mcpArgs
	} = args;
	void _conversationId;
	void _toolCallId;
	void _questionEmitter;
	return mcpArgs;
}

function stringifyContentBlock(block: McpContentBlock): string {
	if (block.type === 'text') {
		return typeof block.text === 'string' ? block.text : String(block.text ?? '');
	}

	if (block.type === 'image') {
		const mimeType = typeof block.mimeType === 'string'
			? block.mimeType
			: typeof block.mime_type === 'string'
				? block.mime_type
				: 'unknown';
		return `[image: ${mimeType} image]`;
	}

	if (block.type === 'resource_link' || block.type === 'resource') {
		const resource = isObject(block.resource) ? block.resource : undefined;
		const uri = typeof block.uri === 'string'
			? block.uri
			: typeof resource?.uri === 'string'
				? resource.uri
				: 'unknown';
		return `[resource: ${uri}]`;
	}

	try {
		return JSON.stringify(block);
	} catch {
		return String(block);
	}
}

/**
 * Serialize MCP CallToolResult into text suitable for tool_result content.
 */
export function serializeMcpResult(result: CallToolResult): string {
	const content = Array.isArray(result.content)
		? result.content.map((block) => stringifyContentBlock(block as McpContentBlock)).filter((entry) => entry.length > 0).join('\n')
		: '';
	const serialized = content.length > 0
		? content
		: result.isError === true
			? 'MCP tool returned an error'
			: '';

	return truncateToolOutput({ content: serialized, maxChars: MAX_TOOL_OUTPUT_CHARS }).content;
}

async function callWithTimeout(
	manager: MCPManager,
	serverId: string,
	toolName: string,
	args: Record<string, unknown>,
): Promise<CallToolResult> {
	const timeoutMs = manager.getTimeout(serverId);
	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

	try {
		return await Promise.race([
			manager.callTool(serverId, toolName, args),
			new Promise<never>((_, reject) => {
				timeoutHandle = setTimeout(
					() => reject(new Error(`MCP tool "${toolName}" timed out after ${timeoutMs}ms`)),
					timeoutMs,
				);
			}),
		]);
	} finally {
		if (timeoutHandle) {
			clearTimeout(timeoutHandle);
		}
	}
}

/**
 * Convert all MCP tools from all connected servers into Elefant ToolDefinitions.
 * Tool names use mcp__<sanitized_server>__<sanitized_tool> format.
 */
export function createMcpToolDefinitions(
	manager: MCPManager,
	_runContext: RunContext,
): ToolDefinition<unknown, string>[] {
	return manager.listAllTools().map(({ serverId, serverName, tool }) => {
		const toolName = `mcp__${sanitizeMcpName(serverName)}__${sanitizeMcpName(tool.name)}`;
		const definition: ToolDefinition<unknown, string> = {
			name: toolName,
			description: tool.description ?? `MCP tool ${tool.name} from ${serverName}`,
			parameters: schemaToParameters(tool.inputSchema),
			inputJSONSchema: tool.inputSchema,
			execute: async (params) => {
				const args = isObject(params) ? stripInternalToolArgs(params) : {};

				try {
					const result = await callWithTimeout(manager, serverId, tool.name, args);
					const content = serializeMcpResult(result);
					if (result.isError === true) {
						return err(createToolExecutionError(content));
					}

					return ok(content);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return err(createToolExecutionError(message));
				}
			},
		};

		return definition;
	});
}

export function isMcpToolDefinition(tool: ToolDefinition): boolean {
	return tool.name.startsWith('mcp__');
}

export function isAlwaysLoadTool(tool: Tool): boolean {
	const meta = (tool as Tool & { _meta?: Record<string, unknown> })._meta;
	return meta?.['anthropic/alwaysLoad'] === true;
}
