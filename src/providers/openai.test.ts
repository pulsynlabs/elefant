import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { OpenAIAdapter } from './openai.ts'
import type { ProviderConfig } from '../types/providers.ts'
import type { ToolDefinition } from '../types/tools.ts'
import type { StreamEvent } from './types.ts'
import { ok } from '../types/result.ts'

const OPENAI_CONFIG: ProviderConfig = {
	name: 'openai-main',
	baseURL: 'https://api.openai.com/v1',
	apiKey: 'sk-test',
	model: 'gpt-4o-mini',
	format: 'openai',
}

const TEST_TOOLS: ToolDefinition[] = [
	{
		name: 'get_weather',
		description: 'Get weather for a city',
		parameters: {
			city: {
				type: 'string',
				description: 'City name',
				required: true,
			},
		},
		execute: async () => ok('sunny'),
	},
]

function createSseResponse(chunks: string[], status = 200): Response {
	const encoder = new TextEncoder()
	let index = 0

	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (index >= chunks.length) {
				controller.close()
				return
			}

			controller.enqueue(encoder.encode(chunks[index]))
			index += 1
		},
	})

	return new Response(stream, {
		status,
		headers: {
			'Content-Type': 'text/event-stream',
		},
	})
}

async function collectEvents(adapter: OpenAIAdapter): Promise<StreamEvent[]> {
	const events: StreamEvent[] = []
	for await (const event of adapter.sendMessage([{ role: 'user', content: 'hello' }], TEST_TOOLS)) {
		events.push(event)
	}
	return events
}

type MockFetchFunction = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>

function withMockPreconnect(mockFetch: MockFetchFunction, originalFetch: typeof fetch): typeof fetch {
	return Object.assign(mockFetch, { preconnect: originalFetch.preconnect }) as unknown as typeof fetch
}

	describe('OpenAIAdapter', () => {
	const originalFetch = globalThis.fetch

	beforeEach(() => {
		globalThis.fetch = originalFetch
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	it('streams text deltas and emits done on [DONE]', async () => {
		globalThis.fetch = withMockPreconnect(
			async () =>
				createSseResponse([
					'data: {"choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}\n\n',
					'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":null}]}\n\n',
					'data: [DONE]\n\n',
				]),
			originalFetch,
		)

		const adapter = new OpenAIAdapter(OPENAI_CONFIG)
		const events = await collectEvents(adapter)

		expect(events).toHaveLength(3)
		expect(events[0]).toEqual({ type: 'text_delta', text: 'Hel' })
		expect(events[1]).toEqual({ type: 'text_delta', text: 'lo' })
		expect(events[2]).toEqual({ type: 'done', finishReason: 'stop' })
	})

	it('accumulates streamed tool call arguments and emits completion', async () => {
		globalThis.fetch = withMockPreconnect(
			async () =>
				createSseResponse([
					'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":"{\\"city\\":\\"San"}}]},"finish_reason":null}]}\n\n',
					'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":" Francisco\\"}"}}]},"finish_reason":null}]}\n\n',
					'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
				]),
			originalFetch,
		)

		const adapter = new OpenAIAdapter(OPENAI_CONFIG)
		const events = await collectEvents(adapter)

		expect(events[0]).toEqual({ type: 'tool_call_start', toolCall: { id: 'call_1', name: 'get_weather' } })
		expect(events[1]).toEqual({ type: 'tool_call_delta', toolCallId: 'call_1', argumentsDelta: '{"city":"San' })
		expect(events[2]).toEqual({ type: 'tool_call_delta', toolCallId: 'call_1', argumentsDelta: ' Francisco"}' })
		expect(events[3]).toEqual({
			type: 'tool_call_complete',
			toolCall: {
				id: 'call_1',
				name: 'get_weather',
				arguments: { city: 'San Francisco' },
			},
		})
		expect(events[4]).toEqual({ type: 'done', finishReason: 'tool_calls' })
	})

	it('emits typed error when provider returns non-2xx', async () => {
		globalThis.fetch = withMockPreconnect(
			async () =>
				new Response('upstream denied', {
					status: 401,
				}),
			originalFetch,
		)

		const adapter = new OpenAIAdapter(OPENAI_CONFIG)
		const events = await collectEvents(adapter)

		expect(events).toHaveLength(1)
		expect(events[0].type).toBe('error')
		if (events[0].type === 'error') {
			expect(events[0].error.code).toBe('PROVIDER_ERROR')
		}
	})

	it('emits typed error when chunk is malformed JSON', async () => {
		globalThis.fetch = withMockPreconnect(
			async () => createSseResponse(['data: {not-json}\n\n']),
			originalFetch,
		)

		const adapter = new OpenAIAdapter(OPENAI_CONFIG)
		const events = await collectEvents(adapter)

		expect(events).toHaveLength(1)
		expect(events[0].type).toBe('error')
		if (events[0].type === 'error') {
			expect(events[0].error.code).toBe('PROVIDER_ERROR')
		}
	})

	it('includes stream_options with include_usage in request body', async () => {
		let capturedBody: { stream_options?: { include_usage?: boolean } } | null = null

		globalThis.fetch = withMockPreconnect(
			async (_url, init) => {
				if (init?.body) {
					capturedBody = JSON.parse(init.body as string) as { stream_options?: { include_usage?: boolean } }
				}
				return createSseResponse([
					'data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n',
					'data: [DONE]\n\n',
				])
			},
			originalFetch,
		)

		const adapter = new OpenAIAdapter(OPENAI_CONFIG)
		await collectEvents(adapter)

		expect(capturedBody).not.toBeNull()
		expect(capturedBody!.stream_options).toEqual({ include_usage: true })
	})

	it('yields UsageEvent when final chunk includes usage data', async () => {
		globalThis.fetch = withMockPreconnect(
			async () =>
				createSseResponse([
					'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
					'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150,"prompt_tokens_details":{"cached_tokens":15}}}\n\n',
				]),
			originalFetch,
		)

		const adapter = new OpenAIAdapter(OPENAI_CONFIG)
		const events = await collectEvents(adapter)

		const usageEvent = events.find((e): e is StreamEvent & { type: 'usage' } => e.type === 'usage')
		expect(usageEvent).toBeDefined()
		expect(usageEvent?.type).toBe('usage')
		expect(usageEvent?.inputTokens).toBe(100)
		expect(usageEvent?.outputTokens).toBe(50)
		expect(usageEvent?.cacheReadTokens).toBe(15)
	})

	it('handles absence of usage data gracefully (no UsageEvent)', async () => {
		globalThis.fetch = withMockPreconnect(
			async () =>
				createSseResponse([
					'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
					'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
				]),
			originalFetch,
		)

		const adapter = new OpenAIAdapter(OPENAI_CONFIG)
		const events = await collectEvents(adapter)

		const usageEvent = events.find((e) => e.type === 'usage')
		expect(usageEvent).toBeUndefined()

		// Verify other events still work normally
		expect(events.some((e) => e.type === 'text_delta')).toBe(true)
		expect(events.some((e) => e.type === 'done')).toBe(true)
	})
})
