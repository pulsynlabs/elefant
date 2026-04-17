import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { OpenAIAdapter } from './openai.ts'
import type { ProviderConfig } from '../types/providers.ts'
import type { ToolDefinition } from '../types/tools.ts'
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

async function collectEvents(adapter: OpenAIAdapter): Promise<Array<{ type: string } & Record<string, unknown>>> {
	const events: Array<{ type: string } & Record<string, unknown>> = []
	for await (const event of adapter.sendMessage([{ role: 'user', content: 'hello' }], TEST_TOOLS)) {
		events.push(event as { type: string } & Record<string, unknown>)
	}
	return events
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
		globalThis.fetch = async () =>
			createSseResponse([
				'data: {"choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}\n\n',
				'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":null}]}\n\n',
				'data: [DONE]\n\n',
			])

		const adapter = new OpenAIAdapter(OPENAI_CONFIG)
		const events = await collectEvents(adapter)

		expect(events).toHaveLength(3)
		expect(events[0]).toEqual({ type: 'text_delta', text: 'Hel' })
		expect(events[1]).toEqual({ type: 'text_delta', text: 'lo' })
		expect(events[2]).toEqual({ type: 'done', finishReason: 'stop' })
	})

	it('accumulates streamed tool call arguments and emits completion', async () => {
		globalThis.fetch = async () =>
			createSseResponse([
				'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":"{\\"city\\":\\"San"}}]},"finish_reason":null}]}\n\n',
				'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":" Francisco\\"}"}}]},"finish_reason":null}]}\n\n',
				'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
			])

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
		globalThis.fetch = async () =>
			new Response('upstream denied', {
				status: 401,
			})

		const adapter = new OpenAIAdapter(OPENAI_CONFIG)
		const events = await collectEvents(adapter)

		expect(events).toHaveLength(1)
		expect(events[0].type).toBe('error')
		expect((events[0].error as { code: string }).code).toBe('PROVIDER_ERROR')
	})

	it('emits typed error when chunk is malformed JSON', async () => {
		globalThis.fetch = async () => createSseResponse(['data: {not-json}\n\n'])

		const adapter = new OpenAIAdapter(OPENAI_CONFIG)
		const events = await collectEvents(adapter)

		expect(events).toHaveLength(1)
		expect(events[0].type).toBe('error')
		expect((events[0].error as { code: string }).code).toBe('PROVIDER_ERROR')
	})
})
