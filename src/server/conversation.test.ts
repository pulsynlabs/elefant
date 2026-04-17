import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'

import type { ElefantError } from '../types/errors.ts'
import type { Result } from '../types/result.ts'
import type { ProviderRouter } from '../providers/router.ts'
import type { ProviderAdapter, SendMessageOptions, StreamEvent } from '../providers/types.ts'
import { createConversationRoute } from './conversation.ts'

type AdapterResult = Result<ProviderAdapter, ElefantError>

function createMockRouter(result: AdapterResult): ProviderRouter {
	return {
		getAdapter: () => result,
		listProviders: () => ['mock-provider'],
	} as unknown as ProviderRouter
}

function createAppWithRouter(router: ProviderRouter): Elysia {
	return createConversationRoute(new Elysia(), router)
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
				yield {
					type: 'tool_call_complete',
					toolCall: {
						id: 'call-1',
						name: 'read',
						arguments: { filePath: 'README.md' },
					},
				}
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
		expect(responseText).toContain('event: tool_call\ndata: {"id":"call-1","name":"read","arguments":{"filePath":"README.md"}}\n\n')
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
		const payload = await response.json() as {
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
})
