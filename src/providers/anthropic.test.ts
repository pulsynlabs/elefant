import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { AnthropicAdapter } from './anthropic.ts'
import type { ProviderConfig } from '../types/providers.ts'
import type { ToolDefinition } from '../types/tools.ts'
import type { StreamEvent } from './types.ts'
import { ok } from '../types/result.ts'

const ANTHROPIC_CONFIG: ProviderConfig = {
	name: 'anthropic-main',
	baseURL: 'https://api.anthropic.com',
	apiKey: 'sk-ant-test',
	model: 'claude-3-7-sonnet-latest',
	format: 'anthropic',
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

async function collectEvents(adapter: AnthropicAdapter): Promise<StreamEvent[]> {
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

describe('AnthropicAdapter', () => {
	const originalFetch = globalThis.fetch

	beforeEach(() => {
		globalThis.fetch = originalFetch
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	it('streams text deltas and emits done on message_stop', async () => {
		globalThis.fetch = withMockPreconnect(
			async () =>
				createSseResponse([
					'event: content_block_delta\ndata: {"type":"text_delta","text":"Hi"}\n\n',
					'event: message_stop\ndata: {}\n\n',
				]),
			originalFetch,
		)

		const adapter = new AnthropicAdapter(ANTHROPIC_CONFIG)
		const events = await collectEvents(adapter)

		expect(events).toEqual([
			{ type: 'text_delta', text: 'Hi' },
			{ type: 'done', finishReason: 'stop' },
		])
	})

	it('normalizes tool_use streaming into unified tool call events', async () => {
		globalThis.fetch = withMockPreconnect(
			async () =>
				createSseResponse([
					'event: content_block_start\ndata: {"index":0,"content_block":{"type":"tool_use","id":"tool_1","name":"get_weather"}}\n\n',
					'event: content_block_delta\ndata: {"index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"San"}}\n\n',
					'event: content_block_delta\ndata: {"index":0,"delta":{"type":"input_json_delta","partial_json":" Francisco\\"}"}}\n\n',
					'event: content_block_stop\ndata: {"index":0}\n\n',
					'event: message_delta\ndata: {"delta":{"stop_reason":"tool_use"}}\n\n',
				]),
			originalFetch,
		)

		const adapter = new AnthropicAdapter(ANTHROPIC_CONFIG)
		const events = await collectEvents(adapter)

		expect(events[0]).toEqual({ type: 'tool_call_start', toolCall: { id: 'tool_1', name: 'get_weather' } })
		expect(events[1]).toEqual({ type: 'tool_call_delta', toolCallId: 'tool_1', argumentsDelta: '{"city":"San' })
		expect(events[2]).toEqual({ type: 'tool_call_delta', toolCallId: 'tool_1', argumentsDelta: ' Francisco"}' })
		expect(events[3]).toEqual({
			type: 'tool_call_complete',
			toolCall: {
				id: 'tool_1',
				name: 'get_weather',
				arguments: { city: 'San Francisco' },
			},
		})
		expect(events[4]).toEqual({ type: 'done', finishReason: 'tool_calls' })
	})

	it('maps system and tool messages into Anthropic request format', async () => {
		let capturedBody = ''
		globalThis.fetch = withMockPreconnect(
			async (_input, init) => {
				capturedBody = typeof init?.body === 'string' ? init.body : ''
				return createSseResponse(['event: message_stop\ndata: {}\n\n'])
			},
			originalFetch,
		)

		const adapter = new AnthropicAdapter(ANTHROPIC_CONFIG)
		for await (const _event of adapter.sendMessage(
			[
				{ role: 'system', content: 'Follow the style guide' },
				{ role: 'user', content: 'Run tool' },
				{ role: 'tool', content: 'tool output', toolCallId: 'tool_123' },
			],
			TEST_TOOLS,
		)) {
			// exhaust stream
		}

		const parsed = JSON.parse(capturedBody) as {
			system?: string
			messages: Array<{ role: string; content: unknown }>
		}

		expect(parsed.system).toBe('Follow the style guide')
		expect(parsed.messages[1]).toEqual({
			role: 'user',
			content: [
				{
					type: 'tool_result',
					tool_use_id: 'tool_123',
					content: 'tool output',
				},
			],
		})
	})

	it('emits typed error when provider returns non-2xx', async () => {
		globalThis.fetch = withMockPreconnect(
			async () => new Response('invalid key', { status: 403 }),
			originalFetch,
		)

		const adapter = new AnthropicAdapter(ANTHROPIC_CONFIG)
		const events = await collectEvents(adapter)

		expect(events).toHaveLength(1)
		expect(events[0].type).toBe('error')
		if (events[0].type === 'error') {
			expect(events[0].error.code).toBe('PROVIDER_ERROR')
		}
	})

	it('yields UsageEvent with input and output tokens from stream', async () => {
		globalThis.fetch = withMockPreconnect(
			async () =>
				createSseResponse([
					'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_read_input_tokens":20,"cache_creation_input_tokens":10}}}\n\n',
					'event: content_block_delta\ndata: {"type":"text_delta","text":"Hello"}\n\n',
					'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":50}}\n\n',
					'event: message_stop\ndata: {"type":"message_stop"}\n\n',
				]),
			originalFetch,
		)

		const adapter = new AnthropicAdapter(ANTHROPIC_CONFIG)
		const events = await collectEvents(adapter)

		// Find the usage event
		const usageEvent = events.find((e): e is StreamEvent & { type: 'usage' } => e.type === 'usage')

		expect(usageEvent).toBeDefined()
		expect(usageEvent?.type).toBe('usage')
		expect(usageEvent?.inputTokens).toBe(100)
		expect(usageEvent?.outputTokens).toBe(50)
		expect(usageEvent?.cacheReadTokens).toBe(20)
		expect(usageEvent?.cacheWriteTokens).toBe(10)

		// Verify other events are still present and unaffected
		expect(events.some((e) => e.type === 'text_delta' && e.text === 'Hello')).toBe(true)
		expect(events.some((e) => e.type === 'done')).toBe(true)
	})

	it('yields UsageEvent without cache fields when not provided', async () => {
		globalThis.fetch = withMockPreconnect(
			async () =>
				createSseResponse([
					'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":50}}}\n\n',
					'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":25}}\n\n',
					'event: message_stop\ndata: {"type":"message_stop"}\n\n',
				]),
			originalFetch,
		)

		const adapter = new AnthropicAdapter(ANTHROPIC_CONFIG)
		const events = await collectEvents(adapter)

		const usageEvent = events.find((e): e is StreamEvent & { type: 'usage' } => e.type === 'usage')

		expect(usageEvent).toBeDefined()
		expect(usageEvent?.inputTokens).toBe(50)
		expect(usageEvent?.outputTokens).toBe(25)
		expect(usageEvent?.cacheReadTokens).toBeUndefined()
		expect(usageEvent?.cacheWriteTokens).toBeUndefined()
	})

	it('does not yield UsageEvent when stream errors before message_stop', async () => {
		globalThis.fetch = withMockPreconnect(
			async () =>
				createSseResponse([
					'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":100}}}\n\n',
					'event: error\ndata: {"error":{"message":"Stream interrupted"}}\n\n',
				]),
			originalFetch,
		)

		const adapter = new AnthropicAdapter(ANTHROPIC_CONFIG)
		const events = await collectEvents(adapter)

		// Should have error event but no usage event
		expect(events.some((e) => e.type === 'error')).toBe(true)
		expect(events.some((e) => e.type === 'usage')).toBe(false)
	})
})
