import { describe, expect, it } from 'bun:test'

import { emit, HookRegistry } from '../hooks/index.ts'
import type { ProviderRouter } from '../providers/router.ts'
import type { ProviderAdapter, StreamEvent } from '../providers/types.ts'
import type { Message } from '../types/providers.ts'
import type { ToolDefinition } from '../types/tools.ts'
import { runAgentLoop, type ToolExecutor } from './agent-loop.ts'

function createRouter(adapter: ProviderAdapter): ProviderRouter {
	return {
		getAdapter: () => ({ ok: true, data: adapter }),
		listProviders: () => ['mock'],
	} as unknown as ProviderRouter
}

const EMPTY_TOOLS: ToolDefinition[] = []

async function collectEvents(generator: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
	const events: StreamEvent[] = []
	for await (const event of generator) {
		events.push(event)
	}
	return events
}

describe('runAgentLoop', () => {
	it('terminates on text-only response', async () => {
		const adapter: ProviderAdapter = {
			name: 'mock',
			async *sendMessage(): AsyncGenerator<StreamEvent> {
				yield { type: 'text_delta', text: 'Hello world' }
				yield { type: 'done', finishReason: 'stop' }
			},
		}

		const registry: ToolExecutor = {
			execute: async () => ({ ok: false, error: { code: 'TOOL_NOT_FOUND', message: 'unused' } }),
		}
		const events = await collectEvents(
			runAgentLoop(createRouter(adapter), registry, {
				messages: [{ role: 'user', content: 'hi' }],
				tools: EMPTY_TOOLS,
				hookRegistry: new HookRegistry(),
				conversationId: 'conv-text-only',
			}),
		)

		expect(events).toEqual([
			{ type: 'text_delta', text: 'Hello world' },
			{ type: 'done', finishReason: 'stop' },
		])
	})

	it('executes tool call and continues with tool result context', async () => {
		const calls: Message[][] = []
		let turn = 0
		const adapter: ProviderAdapter = {
			name: 'mock',
			async *sendMessage(messages): AsyncGenerator<StreamEvent> {
				calls.push(messages.map((entry) => ({ ...entry, toolCalls: entry.toolCalls ? [...entry.toolCalls] : undefined })))
				turn += 1

				if (turn === 1) {
					yield {
						type: 'tool_call_complete',
						toolCall: {
							id: 'call-1',
							name: 'mock-tool',
							arguments: { input: 'abc' },
						},
					}
					yield { type: 'done', finishReason: 'tool_calls' }
					return
				}

				yield { type: 'text_delta', text: 'Tool executed' }
				yield { type: 'done', finishReason: 'stop' }
			},
		}

		const hooks = new HookRegistry()
		const registry: ToolExecutor = {
			execute: async () => ({ ok: true, data: 'mock-output' }),
		}

		const events = await collectEvents(
			runAgentLoop(createRouter(adapter), registry, {
				messages: [{ role: 'user', content: 'run tool' }],
				tools: EMPTY_TOOLS,
				hookRegistry: hooks,
				conversationId: 'conv-tool-result',
			}),
		)

		expect(events).toEqual([
			{
				type: 'tool_call_complete',
				toolCall: {
					id: 'call-1',
					name: 'mock-tool',
					arguments: { input: 'abc' },
				},
			},
			{
				type: 'tool_result',
				toolResult: {
					toolCallId: 'call-1',
					content: 'mock-output',
					isError: false,
				},
			},
			{ type: 'text_delta', text: 'Tool executed' },
			{ type: 'done', finishReason: 'stop' },
		])

		expect(calls.length).toBe(2)
		expect(calls[1].some((entry) => entry.role === 'tool' && entry.toolCallId === 'call-1')).toBe(true)
	})

	it('emits error event when max iterations is reached', async () => {
		const adapter: ProviderAdapter = {
			name: 'mock',
			async *sendMessage(): AsyncGenerator<StreamEvent> {
				yield {
					type: 'tool_call_complete',
					toolCall: {
						id: 'loop-call',
						name: 'loop-tool',
						arguments: {},
					},
				}
				yield { type: 'done', finishReason: 'tool_calls' }
			},
		}

		const registry: ToolExecutor = {
			execute: async () => ({ ok: true, data: 'ok' }),
		}

		const events = await collectEvents(
			runAgentLoop(createRouter(adapter), registry, {
				messages: [{ role: 'user', content: 'loop forever' }],
				tools: EMPTY_TOOLS,
				maxIterations: 2,
				hookRegistry: new HookRegistry(),
				conversationId: 'conv-max-iterations',
			}),
		)

		const last = events[events.length - 1]
		expect(last.type).toBe('error')
		if (last.type === 'error') {
			expect(last.error.message).toContain('Max iterations reached')
		}
	})

	it('fires hooks at expected points', async () => {
		const hooks = new HookRegistry()
		const fired: string[] = []

		hooks.register('message:before', async () => {
			fired.push('message:before')
		})
		hooks.register('message:after', async () => {
			fired.push('message:after')
		})
		hooks.register('tool:before', async () => {
			fired.push('tool:before')
		})
		hooks.register('tool:after', async () => {
			fired.push('tool:after')
		})

		let turn = 0
		const adapter: ProviderAdapter = {
			name: 'mock',
			async *sendMessage(): AsyncGenerator<StreamEvent> {
				turn += 1
				if (turn === 1) {
					yield {
						type: 'tool_call_complete',
						toolCall: {
							id: 'hook-call',
							name: 'hook-tool',
							arguments: {},
						},
					}
					yield { type: 'done', finishReason: 'tool_calls' }
					return
				}

				yield { type: 'done', finishReason: 'stop' }
			},
		}

		const registry: ToolExecutor = {
			execute: async (_name, args) => {
				const hookArgs = typeof args === 'object' && args !== null
					? (args as Record<string, unknown>)
					: {}

				await emit(hooks, 'tool:before', {
					toolName: 'hook-tool',
					args: hookArgs,
					conversationId: 'conv-hooks',
				})

				await emit(hooks, 'tool:after', {
					toolName: 'hook-tool',
					args: hookArgs,
					result: {
						toolCallId: 'hook-call',
						content: 'ok',
						isError: false,
					},
					durationMs: 1,
					conversationId: 'conv-hooks',
				})

				return { ok: true, data: 'ok' }
			},
		}

		await collectEvents(
			runAgentLoop(createRouter(adapter), registry, {
				messages: [{ role: 'user', content: 'hooks' }],
				tools: EMPTY_TOOLS,
				hookRegistry: hooks,
				conversationId: 'conv-hooks',
			}),
		)

		expect(fired).toEqual([
			'message:before',
			'message:after',
			'tool:before',
			'tool:after',
			'message:before',
			'message:after',
		])
	})

	it('keeps hook conversation ids isolated across parallel runs', async () => {
		const hooks = new HookRegistry()
		const hookConversationIds: string[] = []

		hooks.register('tool:before', async (payload) => {
			hookConversationIds.push(payload.conversationId)
		})

		const adapter: ProviderAdapter = {
			name: 'mock',
			async *sendMessage(): AsyncGenerator<StreamEvent> {
				yield {
					type: 'tool_call_complete',
					toolCall: {
						id: 'parallel-call',
						name: 'parallel-tool',
						arguments: {},
					},
				}
				yield { type: 'done', finishReason: 'tool_calls' }
			},
		}

		const registry: ToolExecutor = {
			execute: async (_name, args) => {
				const hookArgs = typeof args === 'object' && args !== null
					? (args as Record<string, unknown>)
					: {}

				await emit(hooks, 'tool:before', {
					toolName: 'parallel-tool',
					args: hookArgs,
					conversationId:
						typeof hookArgs.conversationId === 'string'
							? hookArgs.conversationId
							: 'missing-conversation-id',
				})

				return { ok: true, data: 'ok' }
			},
		}

		await Promise.all([
			collectEvents(
				runAgentLoop(createRouter(adapter), registry, {
					messages: [{ role: 'user', content: 'run a' }],
					tools: EMPTY_TOOLS,
					hookRegistry: hooks,
					maxIterations: 1,
					conversationId: 'conv-a',
				}),
			),
			collectEvents(
				runAgentLoop(createRouter(adapter), registry, {
					messages: [{ role: 'user', content: 'run b' }],
					tools: EMPTY_TOOLS,
					hookRegistry: hooks,
					maxIterations: 1,
					conversationId: 'conv-b',
				}),
			),
		])

		expect(hookConversationIds).toContain('conv-a')
		expect(hookConversationIds).toContain('conv-b')
	})

	it('uses per-run question emitters for concurrent loops', async () => {
		const adapter: ProviderAdapter = {
			name: 'mock',
			async *sendMessage(): AsyncGenerator<StreamEvent> {
				yield {
					type: 'tool_call_complete',
					toolCall: {
						id: 'question-call',
						name: 'question',
						arguments: {},
					},
				}
				yield { type: 'done', finishReason: 'tool_calls' }
			},
		}

		const emittedA: string[] = []
		const emittedB: string[] = []

		const registry: ToolExecutor = {
			execute: async (_name, args) => {
				const toolArgs = typeof args === 'object' && args !== null
					? (args as {
						_questionEmitter?: (payload: {
							questionId: string
							question: string
							header: string
							options: Array<{ label: string; description?: string }>
							multiple: boolean
							conversationId?: string
						}) => void
						conversationId?: string
					})
					: {}

				toolArgs._questionEmitter?.({
					questionId: 'q-1',
					question: 'Select option',
					header: 'Header',
					options: [{ label: 'One' }],
					multiple: false,
					conversationId: toolArgs.conversationId,
				})

				return { ok: true, data: 'ok' }
			},
		}

		await Promise.all([
			collectEvents(
				runAgentLoop(createRouter(adapter), registry, {
					messages: [{ role: 'user', content: 'run question a' }],
					tools: EMPTY_TOOLS,
					hookRegistry: new HookRegistry(),
					maxIterations: 1,
					conversationId: 'conv-question-a',
					questionEmitter: (payload) => {
						emittedA.push(payload.conversationId ?? 'missing')
					},
				}),
			),
			collectEvents(
				runAgentLoop(createRouter(adapter), registry, {
					messages: [{ role: 'user', content: 'run question b' }],
					tools: EMPTY_TOOLS,
					hookRegistry: new HookRegistry(),
					maxIterations: 1,
					conversationId: 'conv-question-b',
					questionEmitter: (payload) => {
						emittedB.push(payload.conversationId ?? 'missing')
					},
				}),
			),
		])

		expect(emittedA).toEqual(['conv-question-a'])
		expect(emittedB).toEqual(['conv-question-b'])
	})
})
