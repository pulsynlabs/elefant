import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'

import { HookRegistry } from '../hooks/index.ts'
import type { ElefantError } from '../types/errors.ts'
import type { Result } from '../types/result.ts'
import type { ProviderRouter } from '../providers/router.ts'
import type { ProviderAdapter, SendMessageOptions, StreamEvent } from '../providers/types.ts'
import { ToolRegistry } from '../tools/registry.ts'
import { createConversationRoute } from './conversation.ts'

type AdapterResult = Result<ProviderAdapter, ElefantError>

function createMockRouter(result: AdapterResult): ProviderRouter {
	return {
		getAdapter: () => result,
		listProviders: () => ['mock-provider'],
	} as unknown as ProviderRouter
}

function createAppWithRouter(router: ProviderRouter): Elysia {
	return createConversationRoute(new Elysia(), router, new ToolRegistry(new HookRegistry()), new HookRegistry())
}

function createJsonRequest(body: unknown): Request {
	return new Request('http://localhost/api/chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
}

describe('createConversationRoute', () => {
	it('streams provider events as SSE', async () => {
		const adapter: ProviderAdapter = {
			name: 'mock-provider',
			async *sendMessage(): AsyncGenerator<StreamEvent> {
				yield { type: 'text_delta', text: 'Hello' }
				yield { type: 'done', finishReason: 'stop' }
			},
		}

		const router = createMockRouter({ ok: true, data: adapter })
		const app = createAppWithRouter(router)

		const response = await app.handle(
			createJsonRequest({
				messages: [{ role: 'user', content: 'Hello' }],
			}),
		)

		expect(response.status).toBe(200)
		expect(response.headers.get('Content-Type')).toContain('text/event-stream')
		expect(response.headers.get('Cache-Control')).toBe('no-cache')
		expect(response.headers.get('Connection')).toBe('keep-alive')

		const responseText = await response.text()
		expect(responseText).toContain('event: token\ndata: {"text":"Hello"}\n\n')
		expect(responseText).toContain('event: done\ndata: {"finishReason":"stop"}\n\n')
	})

	it('returns 400 with a clear message for invalid body', async () => {
		const adapter: ProviderAdapter = {
			name: 'mock-provider',
			async *sendMessage(): AsyncGenerator<StreamEvent> {
				yield { type: 'done', finishReason: 'stop' }
			},
		}

		const app = createAppWithRouter(createMockRouter({ ok: true, data: adapter }))
		const response = await app.handle(createJsonRequest({ provider: 'mock-provider' }))
		const payload = (await response.json()) as {
			ok: boolean
			error: string
			details: unknown[]
		}

		expect(response.status).toBe(400)
		expect(payload.ok).toBe(false)
		expect(payload.error).toBe('Invalid request body')
		expect(Array.isArray(payload.details)).toBe(true)
	})

	it('aborts upstream request when client disconnects', async () => {
		let abortObserved = false
		let resolveAbort: (() => void) | null = null
		const abortPromise = new Promise<void>((resolve) => {
			resolveAbort = resolve
		})

		const adapter: ProviderAdapter = {
			name: 'mock-provider',
			async *sendMessage(
				_messages,
				_tools,
				options?: SendMessageOptions,
			): AsyncGenerator<StreamEvent> {
				if (options?.signal) {
					options.signal.addEventListener(
						'abort',
						() => {
							abortObserved = true
							resolveAbort?.()
						},
						{ once: true },
					)
				}

				yield { type: 'text_delta', text: 'streaming' }

				await new Promise<void>((resolve) => {
					if (!options?.signal) {
						resolve()
						return
					}

					if (options.signal.aborted) {
						resolve()
						return
					}

					options.signal.addEventListener('abort', () => resolve(), { once: true })
				})
			},
		}

		const app = createAppWithRouter(createMockRouter({ ok: true, data: adapter }))
		const response = await app.handle(
			createJsonRequest({
				messages: [{ role: 'user', content: 'Disconnect test' }],
			}),
		)

		const reader = response.body?.getReader()
		expect(reader).toBeDefined()

		if (!reader) {
			throw new Error('Expected stream body reader')
		}

		const firstChunk = await reader.read()
		expect(firstChunk.done).toBe(false)

		await reader.cancel('client disconnected')

		await Promise.race([
			abortPromise,
			Bun.sleep(250).then(() => {
				throw new Error('Expected upstream abort signal after client disconnect')
			}),
		])

		expect(abortObserved).toBe(true)
	})

	it('forwards temperature and topP to provider (maxTokens/timeoutMs removed — internal only)', async () => {
		let receivedOptions: SendMessageOptions | undefined

		const adapter: ProviderAdapter = {
			name: 'mock-provider',
			async *sendMessage(
				_messages,
				_tools,
				options?: SendMessageOptions,
			): AsyncGenerator<StreamEvent> {
				receivedOptions = options
				yield { type: 'text_delta', text: 'Hello' }
				yield { type: 'done', finishReason: 'stop' }
			},
		}

		const app = createAppWithRouter(createMockRouter({ ok: true, data: adapter }))
		const response = await app.handle(
			createJsonRequest({
				messages: [{ role: 'user', content: 'Hello' }],
				provider: 'mock-provider',
				temperature: 0.5,
				topP: 0.9,
			}),
		)

		expect(response.status).toBe(200)
		await response.text() // Consume stream to ensure adapter is called
		expect(receivedOptions).toBeDefined()
		// temperature and topP are still forwarded
		expect(receivedOptions?.temperature).toBe(0.5)
		expect(receivedOptions?.topP).toBe(0.9)
		// maxTokens and timeoutMs are no longer passed to providers (internal only)
		// maxTokens is now INTERNAL_ANTHROPIC_MAX_TOKENS in providers/anthropic.ts
		// timeoutMs is a provider-level concern, not passed per-call
	})

	it('emits tool_call on tool_call_start (empty args) and tool_call_update on tool_call_complete (full args)', async () => {
		// This test verifies the two-phase SSE mapping:
		// 1. tool_call_start -> tool_call (empty args for early card render)
		// 2. tool_call_complete -> tool_call_update (full args to patch the card)
		// This mirrors OpenCode's toolStart() and Claude Code's content_block_start pattern.
		const adapter: ProviderAdapter = {
			name: 'mock-provider',
			async *sendMessage(): AsyncGenerator<StreamEvent> {
				// Phase 1: Provider announces tool call start (arguments still streaming)
				yield {
					type: 'tool_call_start',
					toolCall: {
						id: 'call-123',
						name: 'task',
						arguments: {}, // Empty at start
					},
				}
				// Phase 2: Tool execution completes, full arguments available
				yield {
					type: 'tool_call_complete',
					toolCall: {
						id: 'call-123',
						name: 'task',
						arguments: { description: 'test task', agent_type: 'researcher' },
					},
				}
				// Must use finishReason: 'tool_calls' for the agent loop to process tools
				yield { type: 'done', finishReason: 'tool_calls' }
			},
		}

		const router = createMockRouter({ ok: true, data: adapter })
		const app = createAppWithRouter(router)

		const response = await app.handle(
			createJsonRequest({
				messages: [{ role: 'user', content: 'Run a task' }],
			}),
		)

		expect(response.status).toBe(200)

		const responseText = await response.text()
		// Early tool_call event has empty arguments for immediate card render
		expect(responseText).toContain('event: tool_call')
		expect(responseText).toContain('"id":"call-123"')
		expect(responseText).toContain('"name":"task"')
		// tool_call_update event has full arguments to patch the card
		expect(responseText).toContain('event: tool_call_update')
		expect(responseText).toContain('"description":"test task"')
		expect(responseText).toContain('"agent_type":"researcher"')
	})
})
