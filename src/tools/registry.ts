import type { ConfigManager } from '../config/loader.js';
import type { Database } from '../db/database.ts';
import { emit, type HookRegistry } from '../hooks/index.ts';
import type { ProviderRouter } from '../providers/router.ts';
import type { RunRegistry } from '../runs/registry.ts';
import type { RunContext } from '../runs/types.ts';
import type { ElefantError } from '../types/errors.ts';
import { err, ok, type Result } from '../types/result.ts';
import type { ToolDefinition, ToolResult } from '../types/tools.ts';
import type { SseManager } from '../transport/sse-manager.js';
import { applyPatchTool } from './apply_patch/index.js';
import { editTool } from './edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { lspTool } from './lsp/index.js';
import { questionTool } from './question/index.js';
import { readTool } from './read.js';
import { bashTool } from './shell/index.js';
import { skillTool } from './skill/index.js';
import { createTaskTool, type TaskToolDeps } from './task/index.js';
import { todoreadTool, todowriteTool } from './todo/index.js';
import { createToolListTool } from './tool_list/index.js';
import { createWaitOnRunTool, type WaitOnRunDeps } from './wait_on_run/index.js';
import { webfetchTool } from './webfetch.js';
import { websearchTool } from './websearch.js';
import { writeTool } from './write.js';

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

function toHookResult(content: string, isError: boolean): ToolResult {
	return {
		toolCallId: '',
		content,
		isError,
	};
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

		try {
			const execution = await tool.execute(args);
			if (!execution.ok) {
				await emit(this.hookRegistry, 'tool:after', {
					toolName: name,
					args: hookArgs,
					result: toHookResult(execution.error.message, true),
					durationMs: Date.now() - startedAt,
					conversationId,
				});

				return execution;
			}

			const content = toToolContent(execution.data);
			await emit(this.hookRegistry, 'tool:after', {
				toolName: name,
				args: hookArgs,
				result: toHookResult(content, false),
				durationMs: Date.now() - startedAt,
				conversationId,
			});

			return ok(content);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await emit(this.hookRegistry, 'tool:after', {
				toolName: name,
				args: hookArgs,
				result: toHookResult(message, true),
				durationMs: Date.now() - startedAt,
				conversationId,
			});

			return err(createToolError(`Tool "${name}" threw an exception`, { message }));
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
	}
	registry.register(createTaskTool(taskToolDeps))

	// Register wait_on_run tool
	const waitDeps: WaitOnRunDeps = {
		database: deps.database,
		currentRun: deps.currentRun,
	}
	registry.register(createWaitOnRunTool(waitDeps))

	// tool_list MUST be last (reflects full set)
	registry.register(createToolListTool(registry))

	return registry
}
