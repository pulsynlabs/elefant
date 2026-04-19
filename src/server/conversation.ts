import { Elysia } from 'elysia'
import { z } from 'zod'

import { emit, type HookRegistry } from '../hooks/index.ts'
import type { ProviderRouter } from '../providers/router.ts'
import type { StreamEvent } from '../providers/types.ts'
import type { Message } from '../types/providers.ts'
import type { ToolCall, ToolResult } from '../types/tools.ts'
import type { ToolRegistry } from '../tools/registry.ts'
import { runAgentLoop } from './agent-loop.ts'
import { formatSSEEvent, formatSSEKeepalive } from './sse.ts'
import type { QuestionSsePayload } from '../tools/question/emitter.ts'
import type { RunContext } from '../runs/types.ts'

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
	provider: z.string().min(1).optional(),
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

	if (event.type === 'tool_call_complete') {
		return formatSSEEvent('tool_call', toToolCallPayload(event.toolCall))
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

function createSSEStream(
	providerRouter: ProviderRouter,
	toolRegistry: ToolRegistry,
	hookRegistry: HookRegistry,
	request: z.infer<typeof chatRequestSchema>,
	runContext: RunContext,
	abortController: AbortController,
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

			void (async () => {
				try {
					await emit(hookRegistry, 'stream:start', {
						provider: request.provider ?? 'default',
						model: 'unknown',
						conversationId: runContext.runId,
					})

					const agentLoop = runAgentLoop(providerRouter, toolRegistry, {
						messages: toMessageArray(request.messages),
						tools: toolRegistry.getAll(),
						provider: request.provider,
						maxIterations: request.maxIterations,
						maxTokens: request.maxTokens,
						temperature: request.temperature,
						topP: request.topP,
						timeoutMs: request.timeoutMs,
						hookRegistry,
						runContext: {
							...runContext,
							signal,
						},
						questionEmitter,
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

export function createConversationRoute<TApp extends Elysia>(
	app: TApp,
	providerRouter: ProviderRouter,
	toolRegistry: ToolRegistry,
	hookRegistry: HookRegistry,
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
		const runId = `chat:${sessionId}:${crypto.randomUUID()}`
		const abortController = new AbortController()
		const stream = createSSEStream(
			providerRouter,
			toolRegistry,
			hookRegistry,
			parsed.data,
			{
				runId,
				agentType: 'primary',
				title: 'chat',
				sessionId,
				projectId: 'chat',
				signal: abortController.signal,
			},
			abortController,
		)
		return new Response(stream, {
			headers: SSE_HEADERS,
		})
	})

	return app
}

export { chatRequestSchema }
