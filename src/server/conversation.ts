import { Elysia } from 'elysia'
import { z } from 'zod'

import type { ProviderRouter } from '../providers/router.ts'
import type { ProviderAdapter, StreamEvent } from '../providers/types.ts'
import type { Message } from '../types/providers.ts'
import type { ToolDefinition } from '../types/tools.ts'
import { formatSSEEvent, formatSSEKeepalive } from './sse.ts'

const parameterDefinitionSchema = z.object({
	type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
	description: z.string().min(1),
	required: z.boolean().optional(),
	default: z.unknown().optional(),
})

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

const toolDefinitionSchema = z.object({
	name: z.string().min(1),
	description: z.string().min(1),
	parameters: z.record(z.string(), parameterDefinitionSchema).default({}),
})

const chatRequestSchema = z.object({
	messages: z.array(messageSchema).min(1),
	provider: z.string().min(1).optional(),
	tools: z.array(toolDefinitionSchema).optional().default([]),
	maxTokens: z.number().int().positive().optional(),
	temperature: z.number().min(0).max(2).optional(),
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

function createStubToolDefinition(
	tools: z.infer<typeof toolDefinitionSchema>[],
): ToolDefinition[] {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
		execute: async () => ({
			ok: false,
			error: {
				code: 'TOOL_EXECUTION_FAILED',
				message: 'Tool execution is not available in this endpoint',
				details: { toolName: tool.name },
			},
		}),
	}))
}

function encodeSSEChunk(controller: ReadableStreamDefaultController<Uint8Array>, chunk: string): void {
	controller.enqueue(textEncoder.encode(chunk))
}

function toSSEChunk(event: StreamEvent): string | null {
	if (event.type === 'text_delta') {
		return formatSSEEvent('token', { text: event.text })
	}

	if (event.type === 'tool_call_complete') {
		return formatSSEEvent('tool_call', {
			id: event.toolCall.id,
			name: event.toolCall.name,
			arguments: event.toolCall.arguments,
		})
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

function createSSEStream(adapter: ProviderAdapter, request: z.infer<typeof chatRequestSchema>): ReadableStream<Uint8Array> {
	const abortController = new AbortController()
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

			void (async () => {
				try {
					const tools = createStubToolDefinition(request.tools)
					const messages = toMessageArray(request.messages)

					for await (const streamEvent of adapter.sendMessage(messages, tools, {
						signal: abortController.signal,
						provider: request.provider,
						temperature: request.temperature,
						maxTokens: request.maxTokens,
					})) {
						if (abortController.signal.aborted) {
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
					if (!abortController.signal.aborted) {
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

export function createConversationRoute<TApp extends Elysia>(app: TApp, providerRouter: ProviderRouter): TApp {
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

		const stream = createSSEStream(adapterResult.data, parsed.data)
		return new Response(stream, {
			headers: SSE_HEADERS,
		})
	})

	return app
}

export { chatRequestSchema }
