import { emit, type HookRegistry } from '../hooks/index.ts';
import type { ElefantError } from '../types/errors.ts';
import { err, ok, type Result } from '../types/result.ts';
import type { ToolDefinition, ToolResult } from '../types/tools.ts';
import { editTool } from './edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { readTool } from './read.js';
import { bashTool } from './shell/index.js';
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
	return registry;
}
