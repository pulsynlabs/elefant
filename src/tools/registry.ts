import type { ConfigManager } from '../config/loader.js';
import type { Database } from '../db/database.ts';
import { emit, type HookRegistry } from '../hooks/index.ts';
import type { ProviderRouter } from '../providers/router.ts';
import type { RunRegistry } from '../runs/registry.ts';
import type { RunContext } from '../runs/types.ts';
import type { ElefantError } from '../types/errors.ts';
import { err, ok, type Result } from '../types/result.ts';
import type { ParameterDefinition, ToolDefinition, ToolResult } from '../types/tools.ts';
import type { SseManager } from '../transport/sse-manager.js';
import { applyPatchTool } from './apply_patch/index.js';
import { createAgentSessionSearchTool, type AgentSessionSearchDeps } from './agent_session_search/index.js';
import { editTool } from './edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { lspTool } from './lsp/index.js';
import { questionTool } from './question/index.js';
import { readTool } from './read.js';
import { bashTool } from './shell/index.js';
import { skillTool } from './skill/index.js';
import { createTaskTool, type TaskToolDeps } from './task/index.js';
import type { MetadataEmitter } from './task/metadata-emitter.js';
import { todoreadTool, todowriteTool } from './todo/index.js';
import { createToolListTool } from './tool_list/index.js';
import { webfetchTool } from './webfetch.js';
import { websearchTool } from './websearch.js';
import { writeTool } from './write.js';

export const MAX_TOOL_OUTPUT_CHARS = 100_000;

const TRUNCATION_NOTICE_TEMPLATE = (n: number): string =>
	`\n\n[Output truncated: showing first ${n} chars. Use grep/glob/read to retrieve specific parts.]`;

function createToolError(message: string, details?: unknown): ElefantError {
	return {
		code: 'TOOL_EXECUTION_FAILED',
		message,
		details,
	};
}

function toHookArgs(args: unknown): Record<string, unknown> {
	if (typeof args === 'object' && args !== null && !Array.isArray(args)) {
		return args as Record<string, unknown>;
	}

	return {};
}

function toConversationId(args: Record<string, unknown>): string {
	const candidate = args.conversationId;
	return typeof candidate === 'string' && candidate.length > 0 ? candidate : 'default';
}

function toToolContent(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}

	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

export function truncateToolOutput(args: {
	content: string;
	maxChars?: number;
	maxLines?: number;
}): { content: string; wasTruncated: boolean } {
	const maxChars = args.maxChars ?? MAX_TOOL_OUTPUT_CHARS;
	let content = args.content;
	let wasTruncated = false;

	if (args.maxLines !== undefined) {
		const lines = content.split('\n');
		if (lines.length > args.maxLines) {
			content = lines.slice(0, args.maxLines).join('\n');
			wasTruncated = true;
		}
	}

	if (content.length > maxChars) {
		content = content.slice(0, maxChars);
		wasTruncated = true;
	}

	if (!wasTruncated) {
		return { content, wasTruncated: false };
	}

	return {
		content: content + TRUNCATION_NOTICE_TEMPLATE(maxChars),
		wasTruncated: true,
	};
}

function toHookResult(content: string, isError: boolean): ToolResult {
	return {
		toolCallId: '',
		content,
		isError,
	};
}

function actualType(value: unknown): string {
	if (value === null) {
		return 'null';
	}

	if (Array.isArray(value)) {
		return 'array';
	}

	return typeof value;
}

function matchesParameterType(value: unknown, type: ParameterDefinition['type']): boolean {
	switch (type) {
		case 'string':
			return typeof value === 'string';
		case 'number':
			return typeof value === 'number' && !Number.isNaN(value);
		case 'boolean':
			return typeof value === 'boolean';
		case 'object':
			return typeof value === 'object' && value !== null && !Array.isArray(value);
		case 'array':
			return Array.isArray(value);
	}
}

function createValidationError(toolName: string, reason: string): ElefantError {
	return {
		code: 'VALIDATION_ERROR',
		message: `The "${toolName}" tool was called with invalid arguments: ${reason}. Please rewrite the input so it satisfies the expected schema.`,
	};
}

export function validateToolArgs(
	tool: ToolDefinition<unknown, string>,
	rawArgs: unknown,
): Result<Record<string, unknown>, ElefantError> {
	if (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs)) {
		return err(createValidationError(tool.name, `expected an object, got ${actualType(rawArgs)}`));
	}

	const validatedArgs: Record<string, unknown> = { ...(rawArgs as Record<string, unknown>) };

	for (const [paramName, definition] of Object.entries(tool.parameters)) {
		const valueIsPresent = paramName in validatedArgs;
		if (!valueIsPresent) {
			if (definition.default !== undefined) {
				validatedArgs[paramName] = definition.default;
				continue;
			}

			if (definition.required) {
				return err(createValidationError(tool.name, `missing required field "${paramName}" (${definition.type})`));
			}

			continue;
		}

		if (!matchesParameterType(validatedArgs[paramName], definition.type)) {
			return err(createValidationError(
				tool.name,
				`field "${paramName}" expected ${definition.type}, got ${actualType(validatedArgs[paramName])}`,
			));
		}
	}

	return ok(validatedArgs);
}

export class ToolRegistry {
	private readonly tools: Map<string, ToolDefinition<unknown, string>>;
	private readonly hookRegistry: HookRegistry;

	public constructor(hookRegistry: HookRegistry) {
		this.tools = new Map<string, ToolDefinition<unknown, string>>();
		this.hookRegistry = hookRegistry;
	}

	public register<TParams, TResult>(tool: ToolDefinition<TParams, TResult>): void {
		const normalized: ToolDefinition<unknown, string> = {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
			execute: async (params): Promise<Result<string, ElefantError>> => {
				const result = await tool.execute(params as TParams)
				if (!result.ok) {
					return result
				}

				return ok(toToolContent(result.data))
			},
		}

		this.tools.set(tool.name, normalized);
	}

	public get(name: string): Result<ToolDefinition<unknown, string>, ElefantError> {
		const tool = this.tools.get(name);
		if (!tool) {
			return err({
				code: 'TOOL_NOT_FOUND',
				message: `Tool not found: ${name}`,
			});
		}

		return ok(tool);
	}

	public async execute(name: string, args: unknown): Promise<Result<string, ElefantError>> {
		const toolResult = this.get(name);
		if (!toolResult.ok) {
			return toolResult;
		}

		const tool = toolResult.data;
		const hookArgs = toHookArgs(args);
		const conversationId = toConversationId(hookArgs);
		const startedAt = Date.now();

		await emit(this.hookRegistry, 'tool:before', {
			toolName: name,
			args: hookArgs,
			conversationId,
		});

		const validatedArgs = validateToolArgs(tool, args);
		if (!validatedArgs.ok) {
			const truncated = truncateToolOutput({ content: validatedArgs.error.message });
			const error = {
				...validatedArgs.error,
				message: truncated.content,
			};

			await emit(this.hookRegistry, 'tool:after', {
				toolName: name,
				args: hookArgs,
				result: toHookResult(truncated.content, true),
				durationMs: Date.now() - startedAt,
				conversationId,
			});

			return err(error);
		}

		try {
			const execution = await tool.execute(validatedArgs.data);
			if (!execution.ok) {
				const truncated = truncateToolOutput({ content: execution.error.message });
				const error = {
					...execution.error,
					message: truncated.content,
				};

				await emit(this.hookRegistry, 'tool:after', {
					toolName: name,
					args: hookArgs,
					result: toHookResult(truncated.content, true),
					durationMs: Date.now() - startedAt,
					conversationId,
				});

				return err(error);
			}

			const content = toToolContent(execution.data);
			const truncated = truncateToolOutput({ content });
			await emit(this.hookRegistry, 'tool:after', {
				toolName: name,
				args: hookArgs,
				result: toHookResult(truncated.content, false),
				durationMs: Date.now() - startedAt,
				conversationId,
			});

			return ok(truncated.content);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const stack = error instanceof Error ? error.stack : undefined;
			const wrappedMessage = `Tool "${name}" threw an exception: ${message}`;
			const truncated = truncateToolOutput({ content: wrappedMessage });
			// Log the full error so operators can diagnose tool crashes. The
			// registry rewrites the thrown error into a flat `{ ok: false, error }`
			// Result below (so the agent loop can continue), which hides the stack
			// from the SSE client. The stderr log is the only place to see it.
			console.error(`[registry] Tool "${name}" threw:`, error);
			await emit(this.hookRegistry, 'tool:after', {
				toolName: name,
				args: hookArgs,
				result: toHookResult(truncated.content, true),
				durationMs: Date.now() - startedAt,
				conversationId,
			});

			return err(createToolError(truncated.content, { message, stack }));
		}
	}

	public getAll(): ToolDefinition[] {
		return Array.from(this.tools.values());
	}
}

export function createToolRegistry(hookRegistry: HookRegistry): ToolRegistry {
	const registry = new ToolRegistry(hookRegistry);
	registry.register(readTool);
	registry.register(writeTool);
	registry.register(editTool);
	registry.register(globTool);
	registry.register(grepTool);
	registry.register(bashTool);
	registry.register(applyPatchTool);
	registry.register(webfetchTool);
	registry.register(websearchTool);
	registry.register(todowriteTool);
	registry.register(todoreadTool);
	registry.register(questionTool);
	registry.register(skillTool);
	registry.register(lspTool);
	// tool_list is registered last so it reflects the complete set, including
	// any tools registered above it. Plugins that register tools after startup
	// are also included since the factory closes over the live registry instance.
	registry.register(createToolListTool(registry));
	return registry;
}

export interface ToolRegistryRunDeps {
	hookRegistry: HookRegistry
	database: Database
	runRegistry: RunRegistry
	sseManager: SseManager
	providerRouter: ProviderRouter
	configManager: ConfigManager
	currentRun: RunContext
	metadataEmitter?: MetadataEmitter
}

export function createToolRegistryForRun(deps: ToolRegistryRunDeps): ToolRegistry {
	const registry = new ToolRegistry(deps.hookRegistry)

	// Register all static tools (same list as createToolRegistry)
	registry.register(readTool)
	registry.register(writeTool)
	registry.register(editTool)
	registry.register(globTool)
	registry.register(grepTool)
	registry.register(bashTool)
	registry.register(applyPatchTool)
	registry.register(webfetchTool)
	registry.register(websearchTool)
	registry.register(todowriteTool)
	registry.register(todoreadTool)
	registry.register(questionTool)
	registry.register(skillTool)
	registry.register(lspTool)

	// Register task tool (needs per-run deps)
	const taskToolDeps: TaskToolDeps = {
		database: deps.database,
		runRegistry: deps.runRegistry,
		sseManager: deps.sseManager,
		providerRouter: deps.providerRouter,
		hookRegistry: deps.hookRegistry,
		configManager: deps.configManager,
		toolRegistry: registry,
		currentRun: deps.currentRun,
		metadataEmitter: deps.metadataEmitter,
	}
	registry.register(createTaskTool(taskToolDeps))

	// Register agent_session_search tool (needs per-run deps)
	const agentSessionSearchDeps: AgentSessionSearchDeps = {
		database: deps.database,
		currentRun: deps.currentRun,
	}
	registry.register(createAgentSessionSearchTool(agentSessionSearchDeps))

	// tool_list MUST be last (reflects full set)
	registry.register(createToolListTool(registry))

	return registry
}
