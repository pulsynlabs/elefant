import { Elysia } from 'elysia'
import { z } from 'zod'

import { emit, type HookRegistry } from '../hooks/index.ts'
import type { ProviderRouter } from '../providers/router.ts'
import type { StreamEvent } from '../providers/types.ts'
import type { Message } from '../types/providers.ts'
import type { ToolCall, ToolResult } from '../types/tools.ts'
import { createToolRegistryForRun, type ToolRegistry } from '../tools/registry.ts'
import { runAgentLoop } from './agent-loop.ts'
import { formatSSEEvent, formatSSEKeepalive } from './sse.ts'
import type { QuestionSsePayload } from '../tools/question/emitter.ts'
import type { SliderSsePayload } from '../tools/interactive/types.ts'
import { createMetadataEmitter, type ToolCallMetadataPayload } from '../tools/task/metadata-emitter.ts'
import type { RunContext } from '../runs/types.ts'
import { createRunContext } from '../runs/context.ts'
import type { Database } from '../db/database.ts'
import type { RunRegistry } from '../runs/registry.ts'
import type { SseManager } from '../transport/sse-manager.ts'
import type { ConfigManager } from '../config/loader.ts'
import type { MCPManager } from '../mcp/manager.ts'
import { createMcpToolDefinitions } from '../mcp/adapter.ts'
import { getSessionById } from '../db/repo/sessions.ts'

const toolCallSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	arguments: z.record(z.string(), z.unknown()),
})

const messageSchema = z.object({
	role: z.enum(['system', 'user', 'assistant', 'tool']),
	content: z.string(),
	toolCalls: z.array(toolCallSchema).optional(),
	toolCallId: z.string().min(1).optional(),
})

const chatRequestSchema = z.object({
	messages: z.array(messageSchema).min(1),
	sessionId: z.string().min(1).optional(),
	projectId: z.string().min(1).optional(),
	provider: z.string().min(1).optional(),
	model: z.string().min(1).optional(),
	maxIterations: z.number().int().positive().max(200).optional(),
	maxTokens: z.number().int().positive().optional(),
	temperature: z.number().min(0).max(2).optional(),
	topP: z.number().min(0).max(1).optional(),
	timeoutMs: z.number().int().positive().optional(),
})

const SSE_HEADERS = {
	'Content-Type': 'text/event-stream',
	'Cache-Control': 'no-cache',
	Connection: 'keep-alive',
} as const

const textEncoder = new TextEncoder()

function toMessageArray(messages: z.infer<typeof messageSchema>[]): Message[] {
	return messages.map((message) => ({
		role: message.role,
		content: message.content,
		toolCalls: message.toolCalls,
		toolCallId: message.toolCallId,
	}))
}

function encodeSSEChunk(controller: ReadableStreamDefaultController<Uint8Array>, chunk: string): void {
	controller.enqueue(textEncoder.encode(chunk))
}

function toToolCallPayload(toolCall: ToolCall): Record<string, unknown> {
	return {
		id: toolCall.id,
		name: toolCall.name,
		arguments: toolCall.arguments,
	}
}

function toToolResultPayload(toolResult: ToolResult): Record<string, unknown> {
	return {
		toolCallId: toolResult.toolCallId,
		content: toolResult.content,
		isError: toolResult.isError,
	}
}

function toSSEChunk(event: StreamEvent): string | null {
	if (event.type === 'text_delta') {
		return formatSSEEvent('token', { text: event.text })
	}

	// Emit an early `tool_call` event with the tool id+name as soon as
	// the provider announces the call, before arguments have streamed.
	// This mirrors OpenCode's toolStart() (packages/opencode/src/acp/agent.ts:1115-1134)
	// and Claude Code's content_block_start pattern (src/services/api/claude.ts:1997-2001)
	// — both emit the tool card UI event BEFORE the tool executes so the
	// card can render immediately. A subsequent `tool_call_update` event
	// fills in the complete arguments once streaming finishes.
	if (event.type === 'tool_call_start') {
		return formatSSEEvent('tool_call', {
			id: event.toolCall.id,
			name: event.toolCall.name,
			arguments: {},
		})
	}

	// tool_call_complete now emits a `tool_call_update` so the already-
	// rendered card can patch in the complete arguments.
	if (event.type === 'tool_call_complete') {
		return formatSSEEvent('tool_call_update', toToolCallPayload(event.toolCall))
	}

	if (event.type === 'tool_result') {
		return formatSSEEvent('tool_result', toToolResultPayload(event.toolResult))
	}

	if (event.type === 'done') {
		return formatSSEEvent('done', { finishReason: event.finishReason })
	}

	if (event.type === 'error') {
		return formatSSEEvent('error', {
			code: event.error.code,
			message: event.error.message,
			details: event.error.details,
		})
	}

	return null
}

function toQuestionSSEChunk(payload: QuestionSsePayload): string {
	return formatSSEEvent('question', {
		questionId: payload.questionId,
		question: payload.question,
		header: payload.header,
		options: payload.options,
		multiple: payload.multiple,
		conversationId: payload.conversationId,
	})
}

function toSliderSSEChunk(payload: SliderSsePayload): string {
	return formatSSEEvent('slider', {
		sliderId: payload.sliderId,
		label: payload.label,
		min: payload.min,
		max: payload.max,
		step: payload.step,
		default: payload.default,
		unit: payload.unit,
		conversationId: payload.conversationId,
	})
}

function resolveSessionMode(db: Database | undefined, sessionId: string): 'spec' | 'quick' {
	if (!db) return 'quick'
	const session = getSessionById(db, sessionId)
	return session.ok ? session.data.mode : 'quick'
}

function toToolCallMetadataSSEChunk(payload: ToolCallMetadataPayload): string {
	return formatSSEEvent('tool_call_metadata', {
		toolCallId: payload.toolCallId,
		runId: payload.runId,
		parentRunId: payload.parentRunId,
		agentType: payload.agentType,
		title: payload.title,
		conversationId: payload.conversationId,
	})
}

function createSSEStream(
	providerRouter: ProviderRouter,
	toolRegistry: ToolRegistry,
	hookRegistry: HookRegistry,
	request: z.infer<typeof chatRequestSchema>,
	runContext: RunContext,
	abortController: AbortController,
	runDeps?: ConversationRouteDeps,
): ReadableStream<Uint8Array> {
	const signal = abortController.signal
	let keepaliveTimer: ReturnType<typeof setInterval> | null = null
	let cleanedUp = false

	const cleanup = (abortUpstream: boolean): void => {
		if (cleanedUp) {
			return
		}

		cleanedUp = true
		if (keepaliveTimer) {
			clearInterval(keepaliveTimer)
			keepaliveTimer = null
		}

		if (abortUpstream) {
			abortController.abort()
		}
	}

	return new ReadableStream<Uint8Array>({
		start(controller) {
			const closeController = (): void => {
				try {
					controller.close()
				} catch {
					// Stream may already be closed when client disconnects.
				}
			}

			keepaliveTimer = setInterval(() => {
				encodeSSEChunk(controller, formatSSEKeepalive())
			}, 15_000)

			const questionEmitter = (payload: QuestionSsePayload): void => {
				encodeSSEChunk(controller, toQuestionSSEChunk(payload))
			}
			const sliderEmitter = (payload: SliderSsePayload): void => {
				encodeSSEChunk(controller, toSliderSSEChunk(payload))
			}

			const metadataEmitter = createMetadataEmitter(runContext.runId, (payload) => {
				encodeSSEChunk(controller, toToolCallMetadataSSEChunk(payload))
			})

			const activeRegistry =
				runDeps && request.projectId
					? createToolRegistryForRun({
						hookRegistry,
						database: runDeps.database,
						runRegistry: runDeps.runRegistry,
						sseManager: runDeps.sseManager,
						providerRouter,
						configManager: runDeps.configManager,
						currentRun: runContext,
						mode: resolveSessionMode(runDeps.database, request.sessionId ?? runContext.sessionId),
						metadataEmitter,
					})
					: toolRegistry

			void (async () => {
				try {
					await emit(hookRegistry, 'stream:start', {
						provider: request.provider ?? 'default',
						model: 'unknown',
						conversationId: runContext.runId,
					})

					const loopRunContext: RunContext = {
						...runContext,
						signal,
					}
					const mcpManager = runDeps?.mcpManager
					if (mcpManager) {
						for (const tool of createMcpToolDefinitions(mcpManager, loopRunContext)) {
							activeRegistry.register(tool)
						}
					}

					let mcpTokenBudgetPercent: number | undefined
					if (runDeps?.configManager) {
						const config = await runDeps.configManager.getConfig()
						if (config.ok) {
							mcpTokenBudgetPercent = config.data.tokenBudgetPercent
						}
					}

				const agentLoop = runAgentLoop(providerRouter, activeRegistry, {
					messages: toMessageArray(request.messages),
					tools: activeRegistry.getAll(),
					provider: request.provider,
					model: request.model,
					maxIterations: request.maxIterations,
					maxTokens: request.maxTokens,
					temperature: request.temperature,
					topP: request.topP,
					timeoutMs: request.timeoutMs,
						hookRegistry,
						runContext: loopRunContext,
						questionEmitter,
						sliderEmitter,
						metadataEmitter,
						mcpManager,
						state: { session: { mode: resolveSessionMode(runDeps?.database, request.sessionId ?? runContext.sessionId) } },
						mcpTokenBudgetPercent,
					})

					for await (const streamEvent of agentLoop) {
						if (signal.aborted) {
							break
						}

						const sseChunk = toSSEChunk(streamEvent)
						if (sseChunk) {
							encodeSSEChunk(controller, sseChunk)
						}

						if (streamEvent.type === 'error' || streamEvent.type === 'done') {
							break
						}
					}
				} catch (error) {
					if (!signal.aborted) {
						const message = error instanceof Error ? error.message : 'Unexpected provider stream error'
						encodeSSEChunk(
							controller,
							formatSSEEvent('error', {
								code: 'PROVIDER_ERROR',
								message,
							}),
						)
					}
				} finally {
					await emit(hookRegistry, 'stream:end', {
						provider: request.provider ?? 'default',
						model: 'unknown',
						conversationId: runContext.runId,
					})
					cleanup(false)
					closeController()
				}
			})()

			return undefined
		},
		cancel() {
			cleanup(true)
		},
	})
}

export interface ConversationRouteDeps {
	database: Database
	runRegistry: RunRegistry
	sseManager: SseManager | undefined
	configManager: ConfigManager
	mcpManager?: MCPManager
}

export function createConversationRoute<TApp extends Elysia>(
	app: TApp,
	providerRouter: ProviderRouter,
	toolRegistry: ToolRegistry,
	hookRegistry: HookRegistry,
	runDeps?: ConversationRouteDeps,
): TApp {
	app.post('/api/chat', ({ body, set }) => {
		const parsed = chatRequestSchema.safeParse(body)
		if (!parsed.success) {
			set.status = 400
			return {
				ok: false,
				error: 'Invalid request body',
				details: parsed.error.issues,
			}
		}

		const adapterResult = providerRouter.getAdapter(parsed.data.provider)
		if (!adapterResult.ok) {
			set.status = 400
			return {
				ok: false,
				error: adapterResult.error.message,
				code: adapterResult.error.code,
				details: adapterResult.error.details,
			}
		}

		// Use the caller-supplied sessionId so the desktop can associate a chat
		// with a persisted session. Fall back to a fresh UUID for CLI/API callers.
		const sessionId = parsed.data.sessionId ?? crypto.randomUUID()
		const projectId = parsed.data.projectId ?? 'chat'
		const runId = `chat:${sessionId}:${crypto.randomUUID()}`
		const abortController = new AbortController()

		const runContext: RunContext = createRunContext({
			runId,
			depth: 0,
			agentType: 'primary',
			title: 'chat',
			sessionId,
			projectId,
			signal: abortController.signal,
		})

		const stream = createSSEStream(
			providerRouter,
			toolRegistry,
			hookRegistry,
			parsed.data,
			runContext,
			abortController,
			runDeps,
		)
		return new Response(stream, {
			headers: SSE_HEADERS,
		})
	})

	return app
}

export { chatRequestSchema }
