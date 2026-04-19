import { emit, type HookRegistry } from '../hooks/index.ts'
import type { CompactionManager } from '../compaction/manager.ts'
import type { PermissionGate } from '../permissions/gate.ts'
import type { ProviderRouter } from '../providers/router.ts'
import type { StreamEvent } from '../providers/types.ts'
import { createQuestionEmitter, type QuestionEmitter } from '../tools/question/emitter.ts'
import type { ElefantError } from '../types/errors.ts'
import { type Message } from '../types/providers.ts'
import type { Result } from '../types/result.ts'
import type { ToolCall, ToolDefinition, ToolResult } from '../types/tools.ts'

export interface ToolExecutor {
	execute(name: string, args: unknown): Promise<Result<string, ElefantError>>
}

export interface AgentLoopOptions {
	messages: Message[]
	tools: ToolDefinition[]
	sessionId?: string
	state?: unknown
	provider?: string
	maxIterations?: number
	contextWindowTokens?: number
	maxTokens?: number
	temperature?: number
	topP?: number
	timeoutMs?: number
	signal?: AbortSignal
	hookRegistry: HookRegistry
	permissions?: PermissionGate
	compaction?: CompactionManager
	conversationId: string
	questionEmitter?: QuestionEmitter
}

function estimateTokenCount(messages: Message[]): number {
	const content = messages.map((message) => message.content).join(' ')
	return Math.ceil(content.length / 4)
}

function createToolResult(toolCallId: string, content: string, isError: boolean): ToolResult {
	return {
		toolCallId,
		content,
		isError,
	}
}

function cloneMessages(messages: Message[]): Message[] {
	return messages.map((message) => ({
		...message,
		toolCalls: message.toolCalls ? [...message.toolCalls] : undefined,
	}))
}

function toToolArguments(
	args: unknown,
	conversationId: string,
	questionEmitter: QuestionEmitter,
): Record<string, unknown> {
	const baseArgs =
		typeof args === 'object' && args !== null && !Array.isArray(args)
			? (args as Record<string, unknown>)
			: {}

	return {
		...baseArgs,
		conversationId,
		_questionEmitter: questionEmitter,
	}
}

export async function* runAgentLoop(
	router: ProviderRouter,
	registry: ToolExecutor,
	options: AgentLoopOptions,
): AsyncGenerator<StreamEvent> {
	let messages = [...options.messages]
	let iterations = 0
	let tokenCount = estimateTokenCount(messages)
	const contextWindow = options.contextWindowTokens ?? 200_000
	const sessionId = options.sessionId ?? options.conversationId
	const maxIterations = options.maxIterations ?? 50
	const runQuestionEmitter = createQuestionEmitter(
		options.conversationId,
		options.questionEmitter ?? (() => undefined),
	)

	while (iterations < maxIterations) {
		iterations += 1
		const messageStart = Date.now()

		if (
			options.compaction &&
			options.compaction.shouldCompact(tokenCount, contextWindow)
		) {
			const compacted = await options.compaction.compact({
				messages,
				tokenCount,
				contextWindow,
				sessionId,
				conversationId: options.conversationId,
			})
			messages = compacted.messages
			tokenCount = compacted.tokenCountAfter
		}

		await emit(options.hookRegistry, 'message:before', {
			messages,
			provider: options.provider ?? 'default',
			model: 'unknown',
		})

		const adapterResult = router.getAdapter(options.provider)
		if (!adapterResult.ok) {
			yield { type: 'error', error: adapterResult.error }
			return
		}

		const pendingToolCalls: ToolCall[] = []
		let finishReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop'
		let assistantText = ''

		// system:transform ordering: [fixed system header] → [injected blocks, deterministic] → [rest of messages]
		const outgoingMessagesBase = cloneMessages(messages)
		const transformedContext = await emit(options.hookRegistry, 'system:transform', {
			messages: outgoingMessagesBase,
			sessionId,
			conversationId: options.conversationId,
			state: options.state ?? null,
			budgets: {
				tokens: Math.max(0, contextWindow - tokenCount),
			},
		})
		const outgoingMessages =
			Array.isArray(transformedContext.messages) && transformedContext.messages.length > 0
				? transformedContext.messages
				: outgoingMessagesBase

		for await (const event of adapterResult.data.sendMessage(outgoingMessages, options.tools, {
			signal: options.signal,
			provider: options.provider,
			maxTokens: options.maxTokens,
			temperature: options.temperature,
			topP: options.topP,
			timeoutMs: options.timeoutMs,
		})) {
			if (event.type === 'tool_call_complete') {
				pendingToolCalls.push(event.toolCall)
				continue
			}

			if (event.type === 'text_delta') {
				assistantText += event.text
				yield event
				continue
			}

			if (event.type === 'done') {
				finishReason = event.finishReason
				if (event.finishReason !== 'tool_calls') {
					yield event
				}
				continue
			}

			if (event.type === 'error') {
				yield event
				return
			}

			yield event
		}

		await emit(options.hookRegistry, 'message:after', {
			messages,
			provider: options.provider ?? 'default',
			model: 'unknown',
			durationMs: Date.now() - messageStart,
		})

		if (pendingToolCalls.length === 0 || finishReason !== 'tool_calls') {
			return
		}

		messages.push({
			role: 'assistant',
			content: assistantText,
			toolCalls: pendingToolCalls,
		})
		tokenCount = estimateTokenCount(messages)

		for (const toolCall of pendingToolCalls) {
			yield { type: 'tool_call_complete', toolCall }

			// Permission gate check before tool execution
			if (options.permissions) {
				const permResult = await options.permissions.check(
					toolCall.name,
					toolCall.arguments as Record<string, unknown>,
					options.conversationId,
				)

				if (!permResult.ok || !permResult.data.approved) {
					const reason = permResult.ok
						? permResult.data.reason
						: permResult.error.message
					const toolResult = createToolResult(
						toolCall.id,
						`Tool call denied: ${reason}`,
						true,
					)

					yield {
						type: 'tool_result',
						toolResult,
					}

					messages.push({
						role: 'tool',
						content: toolResult.content,
						toolCallId: toolResult.toolCallId,
					})
					continue
				}
			}

			const executeResult = await registry.execute(
				toolCall.name,
				toToolArguments(toolCall.arguments, options.conversationId, runQuestionEmitter),
			)
			const toolResult = createToolResult(
				toolCall.id,
				executeResult.ok ? executeResult.data : executeResult.error.message,
				!executeResult.ok,
			)

			yield {
				type: 'tool_result',
				toolResult,
			}

			messages.push({
				role: 'tool',
				content: toolResult.content,
				toolCallId: toolResult.toolCallId,
			})
			tokenCount = estimateTokenCount(messages)
		}
	}

	yield {
		type: 'error',
		error: {
			code: 'TOOL_EXECUTION_FAILED',
			message: 'Max iterations reached',
		},
	}
}
