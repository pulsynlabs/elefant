import { emit, type HookRegistry } from '../hooks/index.ts'
import type { CompactionManager } from '../compaction/manager.ts'
import type { PermissionGate } from '../permissions/gate.ts'
import type { ProviderRouter } from '../providers/router.ts'
import type { StreamEvent, UsageEvent } from '../providers/types.ts'
import { clearRunEventSequence, publishRunEvent, publishStatusChange } from '../runs/events.ts'
import type { RunContext } from '../runs/types.ts'
import { createQuestionEmitter, type QuestionEmitter } from '../tools/question/emitter.ts'
import type { MetadataEmitter } from '../tools/task/metadata-emitter.ts'
import type { ElefantError } from '../types/errors.ts'
import { type Message } from '../types/providers.ts'
import type { Result } from '../types/result.ts'
import type { ToolCall, ToolDefinition, ToolResult } from '../types/tools.ts'
import type { SseManager } from '../transport/sse-manager.ts'
import { estimateMessageTokens } from '../utils/tokens.ts'

export interface ToolExecutor {
	execute(name: string, args: unknown): Promise<Result<string, ElefantError>>
}

export interface AgentLoopOptions {
	messages: Message[]
	tools: ToolDefinition[]
	state?: unknown
	provider?: string
	maxIterations?: number
	contextWindowTokens?: number
	maxTokens?: number
	temperature?: number
	topP?: number
	timeoutMs?: number
	hookRegistry: HookRegistry
	permissions?: PermissionGate
	compaction?: CompactionManager
	runContext: RunContext
	questionEmitter?: QuestionEmitter
	metadataEmitter?: MetadataEmitter
	sseManager?: SseManager
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
	runId: string,
	toolCallId: string,
	questionEmitter: QuestionEmitter,
): Record<string, unknown> {
	const baseArgs =
		typeof args === 'object' && args !== null && !Array.isArray(args)
			? (args as Record<string, unknown>)
			: {}

	return {
		...baseArgs,
		conversationId: runId,
		_toolCallId: toolCallId,
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
	let tokenCount = estimateMessageTokens(messages)
	const contextWindow = options.contextWindowTokens ?? 200_000
	const sessionId = options.runContext.sessionId
	const maxIterations = options.maxIterations ?? 50
	const repairCounts = new Map<string, number>()
	const emitRunEvent = (type: string, data: unknown): void => {
		if (!options.sseManager) {
			return
		}

		publishRunEvent(options.runContext, options.sseManager, type, data)
	}
	const baseQuestionEmitter = options.questionEmitter ?? (() => undefined)
	const questionEmitter: QuestionEmitter = (payload) => {
		emitRunEvent('agent_run.question', payload)
		baseQuestionEmitter(payload)
	}
	const runQuestionEmitter = createQuestionEmitter(
		options.runContext.runId,
		questionEmitter,
	)

	emitRunEvent('agent_run.spawned', {
		runId: options.runContext.runId,
		parentRunId: options.runContext.parentRunId ?? null,
		agentType: options.runContext.agentType,
		title: options.runContext.title,
	})

	while (iterations < maxIterations) {
		if (options.runContext.signal.aborted) {
			emitRunEvent('agent_run.cancelled', {
				reason: 'run aborted before provider call',
			})
			clearRunEventSequence(options.runContext.runId)
			return
		}

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
				conversationId: options.runContext.runId,
			})
			messages = compacted.messages
			tokenCount = compacted.tokenCountAfter
		}

		await emit(options.hookRegistry, 'message:before', {
			messages,
			provider: options.provider ?? 'default',
			model: 'unknown',
			runId: options.runContext.runId,
			sessionId: options.runContext.sessionId,
			projectId: options.runContext.projectId,
		})

		const adapterResult = router.getAdapter(options.provider)
		if (!adapterResult.ok) {
			yield { type: 'error', error: adapterResult.error }
			return
		}

		const pendingToolCalls: ToolCall[] = []
		let finishReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop'
		let assistantText = ''
		let lastUsage: UsageEvent | null = null

		// system:transform ordering: [fixed system header] → [injected blocks, deterministic] → [rest of messages]
		const outgoingMessagesBase = cloneMessages(messages)
		const transformedContext = await emit(options.hookRegistry, 'system:transform', {
			messages: outgoingMessagesBase,
			sessionId,
			conversationId: options.runContext.runId,
			runId: options.runContext.runId,
			projectId: options.runContext.projectId,
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
			signal: options.runContext.signal,
			provider: options.provider,
			maxTokens: options.maxTokens,
			temperature: options.temperature,
			topP: options.topP,
			timeoutMs: options.timeoutMs,
		})) {
			if (options.runContext.signal.aborted) {
				emitRunEvent('agent_run.cancelled', {
					reason: 'run aborted during provider stream',
				})
				clearRunEventSequence(options.runContext.runId)
				return
			}

			if (event.type === 'tool_call_complete') {
				emitRunEvent('agent_run.tool_call', {
					toolCall: event.toolCall,
				})
				pendingToolCalls.push(event.toolCall)
				continue
			}

			if (event.type === 'text_delta') {
				emitRunEvent('agent_run.token', {
					text: event.text,
				})
				assistantText += event.text
				yield event
				continue
			}

			if (event.type === 'usage') {
				lastUsage = event
				yield event
				continue
			}

			if (event.type === 'done') {
				finishReason = event.finishReason

				if (event.finishReason !== 'tool_calls') {
					// Run is truly finishing — emit done event and status change now.
					emitRunEvent('agent_run.done', {
						finishReason: event.finishReason,
					})

					// Emit status change: running -> done
					if (options.sseManager) {
						publishStatusChange(options.sseManager, {
							runId: options.runContext.runId,
							sessionId: options.runContext.sessionId,
							projectId: options.runContext.projectId,
							parentRunId: options.runContext.parentRunId,
							agentType: options.runContext.agentType,
							title: options.runContext.title,
							previousStatus: 'running',
							nextStatus: 'done',
							reason: `finishReason: ${event.finishReason}`,
						})
					}

					clearRunEventSequence(options.runContext.runId)
					yield event
				}
				// finishReason === 'tool_calls': intermediate turn, loop continues.
				// Do NOT emit agent_run.done — the run is not finished yet.
				continue
			}

			if (event.type === 'error') {
				emitRunEvent('agent_run.error', {
					code: event.error.code,
					message: event.error.message,
					details: event.error.details,
				})

				// Emit status change: running -> error
				if (options.sseManager) {
					publishStatusChange(options.sseManager, {
						runId: options.runContext.runId,
						sessionId: options.runContext.sessionId,
						projectId: options.runContext.projectId,
						parentRunId: options.runContext.parentRunId,
						agentType: options.runContext.agentType,
						title: options.runContext.title,
						previousStatus: 'running',
						nextStatus: 'error',
						reason: event.error.message,
					})
				}

				clearRunEventSequence(options.runContext.runId)
				yield event
				return
			}

			yield event
		}

		if (pendingToolCalls.length === 0 || finishReason !== 'tool_calls') {
			await emit(options.hookRegistry, 'message:after', {
				messages,
				provider: options.provider ?? 'default',
				model: 'unknown',
				durationMs: Date.now() - messageStart,
				runId: options.runContext.runId,
				sessionId: options.runContext.sessionId,
				projectId: options.runContext.projectId,
			})
			return
		}

		messages.push({
			role: 'assistant',
			content: assistantText,
			toolCalls: pendingToolCalls,
		})
		// Prefer real usage data from the provider; fall back to estimator.
		tokenCount = lastUsage !== null ? lastUsage.inputTokens : estimateMessageTokens(messages)

		type TaskOutput = {
			events: StreamEvent[]
			message: Message
			isRepair?: boolean
		}

		const toolTasks = pendingToolCalls.map((toolCall) =>
			(async (): Promise<TaskOutput> => {
				const taskEvents: StreamEvent[] = []
				taskEvents.push({ type: 'tool_call_complete', toolCall })

				// Permission gate check before tool execution
				if (options.permissions) {
					const permResult = await options.permissions.check(
						toolCall.name,
						toolCall.arguments as Record<string, unknown>,
						options.runContext.runId,
						{
							sessionId: options.runContext.sessionId,
							projectId: options.runContext.projectId,
							agent: options.runContext.agentType,
						},
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
						taskEvents.push({ type: 'tool_result', toolResult })

						return {
							events: taskEvents,
							message: {
								role: 'tool',
								content: toolResult.content,
								toolCallId: toolResult.toolCallId,
							},
						}
					}
				}

				const executeResult = await registry.execute(
					toolCall.name,
					toToolArguments(toolCall.arguments, options.runContext.runId, toolCall.id, runQuestionEmitter),
				)

				if (!executeResult.ok && executeResult.error.code === 'VALIDATION_ERROR') {
					const repairCount = repairCounts.get(toolCall.id) ?? 0
					if (repairCount < 2) {
						repairCounts.set(toolCall.id, repairCount + 1)
						const toolResult = createToolResult(toolCall.id, executeResult.error.message, true)
						emitRunEvent('agent_run.tool_result', {
							toolResult,
						})
						taskEvents.push({ type: 'tool_result', toolResult })

						return {
							events: taskEvents,
							message: {
								role: 'tool',
								content: toolResult.content,
								toolCallId: toolResult.toolCallId,
							},
							isRepair: true,
						}
					}
				}

				const toolResult = createToolResult(
					toolCall.id,
					executeResult.ok ? executeResult.data : executeResult.error.message,
					!executeResult.ok,
				)
				emitRunEvent('agent_run.tool_result', {
					toolResult,
				})
				taskEvents.push({ type: 'tool_result', toolResult })

				return {
					events: taskEvents,
					message: {
						role: 'tool',
						content: toolResult.content,
						toolCallId: toolResult.toolCallId,
					},
				}
			})(),
		)

		const taskOutputs = await Promise.all(toolTasks)
		const anyRepair = taskOutputs.some((output) => output.isRepair === true)

		for (const output of taskOutputs) {
			for (const event of output.events) {
				yield event
			}
			messages.push(output.message)
		}
		tokenCount = estimateMessageTokens(messages)

		await emit(options.hookRegistry, 'message:after', {
			messages,
			provider: options.provider ?? 'default',
			model: 'unknown',
			durationMs: Date.now() - messageStart,
			runId: options.runContext.runId,
			sessionId: options.runContext.sessionId,
			projectId: options.runContext.projectId,
		})

		if (anyRepair) {
			iterations -= 1
		}
	}

	yield {
		type: 'error',
		error: {
			code: 'TOOL_EXECUTION_FAILED',
			message: 'Max iterations reached',
		},
	}
	emitRunEvent('agent_run.error', {
		code: 'TOOL_EXECUTION_FAILED',
		message: 'Max iterations reached',
	})
	clearRunEventSequence(options.runContext.runId)
}
