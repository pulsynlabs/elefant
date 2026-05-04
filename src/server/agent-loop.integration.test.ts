import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { HookRegistry } from '../hooks/index.ts'
import { AnthropicCompatibleAdapter } from '../providers/anthropic.ts'
import { OpenAIAdapter } from '../providers/openai.ts'
import type { ProviderRouter } from '../providers/router.ts'
import type { ProviderAdapter, StreamEvent } from '../providers/types.ts'
import type { RunContext } from '../runs/types.ts'
import type { Message, ProviderConfig } from '../types/providers.ts'
import type { ToolDefinition } from '../types/tools.ts'
import { ok } from '../types/result.ts'
import { runAgentLoop, type ToolExecutor } from './agent-loop.ts'

function createRouter(adapter: ProviderAdapter): ProviderRouter {
	return {
		getAdapter: () => ({ ok: true, data: adapter }),
		listProviders: () => ['mock'],
	} as unknown as ProviderRouter
}

function createRunContext(runId: string): RunContext {
	return {
		runId,
		parentRunId: undefined,
		depth: 0,
		agentType: 'test-agent',
		title: 'deferred-tool-integration',
		sessionId: `session-${runId}`,
		projectId: 'project-test',
		signal: new AbortController().signal,
		discoveredTools: new Set<string>(),
	}
}

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

type MockFetchFunction = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>

function withMockPreconnect(mockFetch: MockFetchFunction, originalFetch: typeof fetch): typeof fetch {
	return Object.assign(mockFetch, { preconnect: originalFetch.preconnect }) as unknown as typeof fetch
}

async function collectEvents(generator: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
	const events: StreamEvent[] = []
	for await (const event of generator) {
		events.push(event)
	}
	return events
}

function createDeferredFixture(runId: string) {
	const runContext = createRunContext(runId)

	const tools: ToolDefinition[] = [
		{
			name: 'tool_search',
			description: 'Search available tools by keyword',
			parameters: {
				query: { type: 'string', required: true },
			},
			execute: async () => ok('unused in integration test'),
		},
		{
			name: 'compact_builtin',
			description: 'Always-available compact tool',
			parameters: {},
			execute: async () => ok('compact ok'),
		},
		{
			name: 'mcp_git_tool',
			description: 'Deferred MCP git tool',
			deferred: true,
			parameters: {
				repo: { type: 'string', required: false },
			},
			execute: async () => ok('git tool ok'),
		},
	]

	const registry: ToolExecutor = {
		execute: async (name) => {
			if (name === 'tool_search') {
				runContext.discoveredTools.add('mcp_git_tool')
				return ok(JSON.stringify({ matches: ['mcp_git_tool'] }))
			}

			if (name === 'mcp_git_tool') {
				return ok('git tool invocation succeeded')
			}

			if (name === 'compact_builtin') {
				return ok('compact ok')
			}

			return {
				ok: false,
				error: { code: 'TOOL_NOT_FOUND', message: `Unknown tool: ${name}` },
			}
		},
	}

	return { runContext, tools, registry }
}

describe('runAgentLoop deferred discovery integration', () => {
	const originalFetch = globalThis.fetch

	beforeEach(() => {
		globalThis.fetch = originalFetch
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	it('anthropic path: deferred tool appears only after tool_search discovery', async () => {
		const requestBodies: Array<Record<string, unknown>> = []
		let turn = 0

		globalThis.fetch = withMockPreconnect(
			async (_url, init) => {
				const rawBody = typeof init?.body === 'string' ? init.body : '{}'
				requestBodies.push(JSON.parse(rawBody) as Record<string, unknown>)
				turn += 1

				if (turn === 1) {
					return createSseResponse([
						'event: content_block_start\ndata: {"index":0,"content_block":{"type":"tool_use","id":"search-1","name":"tool_search"}}\n\n',
						'event: content_block_delta\ndata: {"index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\":\\"git\\"}"}}\n\n',
						'event: content_block_stop\ndata: {"index":0}\n\n',
						'event: message_delta\ndata: {"delta":{"stop_reason":"tool_use"}}\n\n',
					])
				}

				if (turn === 2) {
					return createSseResponse([
						'event: content_block_start\ndata: {"index":0,"content_block":{"type":"tool_use","id":"git-1","name":"mcp_git_tool"}}\n\n',
						'event: content_block_delta\ndata: {"index":0,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n',
						'event: content_block_stop\ndata: {"index":0}\n\n',
						'event: message_delta\ndata: {"delta":{"stop_reason":"tool_use"}}\n\n',
					])
				}

				return createSseResponse([
					'event: content_block_delta\ndata: {"type":"text_delta","text":"done"}\n\n',
					'event: message_stop\ndata: {}\n\n',
				])
			},
			originalFetch,
		)

		const config: ProviderConfig = {
			name: 'anthropic-main',
			baseURL: 'https://api.anthropic.com',
			apiKey: 'sk-ant-test',
			model: 'claude-3-7-sonnet-latest',
			format: 'anthropic',
		}

		const { runContext, tools, registry } = createDeferredFixture('anthropic-deferred-flow')
		const adapter = new AnthropicCompatibleAdapter(config)

		const events = await collectEvents(
			runAgentLoop(createRouter(adapter), registry, {
				messages: [{ role: 'user', content: 'discover git tool then run it' }],
				tools,
				hookRegistry: new HookRegistry(),
				runContext,
			}),
		)

		expect(requestBodies.length).toBeGreaterThanOrEqual(2)
		const turn1Tools = (requestBodies[0]?.tools as Array<{ name: string }> | undefined) ?? []
		const turn2Tools = (requestBodies[1]?.tools as Array<{ name: string }> | undefined) ?? []

		expect(turn1Tools.map((tool) => tool.name)).not.toContain('mcp_git_tool')
		expect(turn2Tools.map((tool) => tool.name)).toContain('mcp_git_tool')
		expect(events).toContainEqual({
			type: 'tool_result',
			toolResult: {
				toolCallId: 'git-1',
				content: 'git tool invocation succeeded',
				isError: false,
			},
		})
	})

	it('openai-compatible path: deferred tool appears only after tool_search discovery', async () => {
		const requestBodies: Array<Record<string, unknown>> = []
		let turn = 0

		globalThis.fetch = withMockPreconnect(
			async (_url, init) => {
				const rawBody = typeof init?.body === 'string' ? init.body : '{}'
				requestBodies.push(JSON.parse(rawBody) as Record<string, unknown>)
				turn += 1

				if (turn === 1) {
					return createSseResponse([
						'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"search-1","function":{"name":"tool_search","arguments":"{\\"query\\":\\"git\\"}"}}]},"finish_reason":null}]}\n\n',
						'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
					])
				}

				if (turn === 2) {
					return createSseResponse([
						'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"git-1","function":{"name":"mcp_git_tool","arguments":"{}"}}]},"finish_reason":null}]}\n\n',
						'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
					])
				}

				return createSseResponse([
					'data: {"choices":[{"delta":{"content":"done"},"finish_reason":null}]}\n\n',
					'data: [DONE]\n\n',
				])
			},
			originalFetch,
		)

		const config: ProviderConfig = {
			name: 'openai-main',
			baseURL: 'https://api.openai.com/v1',
			apiKey: 'sk-test',
			model: 'gpt-4o-mini',
			format: 'openai',
		}

		const { runContext, tools, registry } = createDeferredFixture('openai-deferred-flow')
		const adapter = new OpenAIAdapter(config)

		const events = await collectEvents(
			runAgentLoop(createRouter(adapter), registry, {
				messages: [{ role: 'user', content: 'discover git tool then run it' }],
				tools,
				hookRegistry: new HookRegistry(),
				runContext,
			}),
		)

		expect(requestBodies.length).toBeGreaterThanOrEqual(2)
		const turn1Tools = (requestBodies[0]?.tools as Array<{ function?: { name?: string } }> | undefined) ?? []
		const turn2Tools = (requestBodies[1]?.tools as Array<{ function?: { name?: string } }> | undefined) ?? []

		expect(turn1Tools.map((tool) => tool.function?.name)).not.toContain('mcp_git_tool')
		expect(turn2Tools.map((tool) => tool.function?.name)).toContain('mcp_git_tool')
		expect(events).toContainEqual({
			type: 'tool_result',
			toolResult: {
				toolCallId: 'git-1',
				content: 'git tool invocation succeeded',
				isError: false,
			},
		})
	})
})
