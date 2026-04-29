import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
	__getFileReadCountForTests,
	buildSpecBlock,
	createCompactionBlockTransform,
} from '../compaction/blocks.ts'
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

function createRunContext(runId: string) {
	const [scope, suffix] = runId.split(':')
	return {
		runId,
		parentRunId: undefined,
		depth: 0,
		agentType: scope ?? 'test',
		title: suffix ?? 'test-run',
		sessionId: `session-${runId}`,
		projectId: 'project-test',
		signal: new AbortController().signal,
	}
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
				runContext: createRunContext('conv-text-only'),
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
				runContext: createRunContext('conv-tool-result'),
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

	it('executes tool calls concurrently when multiple are returned in one turn', async () => {
		const startTimes: Record<string, number> = {}
		const endTimes: Record<string, number> = {}
		const adapter: ProviderAdapter = {
			name: 'mock',
			async *sendMessage(): AsyncGenerator<StreamEvent> {
				yield {
					type: 'tool_call_complete',
					toolCall: { id: 'call-a', name: 'slow-a', arguments: {} },
				}
				yield {
					type: 'tool_call_complete',
					toolCall: { id: 'call-b', name: 'slow-b', arguments: {} },
				}
				yield { type: 'done', finishReason: 'tool_calls' }
			},
		}

		const registry: ToolExecutor = {
			execute: async (name) => {
				startTimes[name] = Date.now()
				await new Promise((resolve) => setTimeout(resolve, 50))
				endTimes[name] = Date.now()
				return { ok: true, data: `${name}-result` }
			},
		}

		const events = await collectEvents(
			runAgentLoop(createRouter(adapter), registry, {
				messages: [{ role: 'user', content: 'go' }],
				tools: EMPTY_TOOLS,
				hookRegistry: new HookRegistry(),
				maxIterations: 1,
				runContext: createRunContext('conv-parallel'),
			}),
		)

		expect(startTimes['slow-a']).toBeDefined()
		expect(startTimes['slow-b']).toBeDefined()
		expect(endTimes['slow-a']).toBeDefined()
		expect(endTimes['slow-b']).toBeDefined()
		expect(Math.abs(startTimes['slow-a'] - startTimes['slow-b'])).toBeLessThan(30)
		expect(events.slice(0, 4)).toEqual([
			{
				type: 'tool_call_complete',
				toolCall: { id: 'call-a', name: 'slow-a', arguments: {} },
			},
			{
				type: 'tool_result',
				toolResult: {
					toolCallId: 'call-a',
					content: 'slow-a-result',
					isError: false,
				},
			},
			{
				type: 'tool_call_complete',
				toolCall: { id: 'call-b', name: 'slow-b', arguments: {} },
			},
			{
				type: 'tool_result',
				toolResult: {
					toolCallId: 'call-b',
					content: 'slow-b-result',
					isError: false,
				},
			},
		])
	})

	it('uses UsageEvent.inputTokens for tokenCount when a usage event is received', async () => {
		const adapter: ProviderAdapter = {
			name: 'mock',
			async *sendMessage(): AsyncGenerator<StreamEvent> {
				yield { type: 'usage', inputTokens: 999, outputTokens: 100 }
				yield { type: 'text_delta', text: 'done' }
				yield { type: 'done', finishReason: 'stop' }
			},
		}

		const events = await collectEvents(
			runAgentLoop(createRouter(adapter), {
				execute: async () => ({ ok: true, data: 'ok' }),
			}, {
				messages: [{ role: 'user', content: 'go' }],
				tools: EMPTY_TOOLS,
				hookRegistry: new HookRegistry(),
				runContext: createRunContext('conv-usage-token'),
			}),
		)

		const usageEvents = events.filter((event) => event.type === 'usage')
		expect(usageEvents.length).toBe(1)
		const usageEvent = usageEvents[0]
		if (usageEvent.type === 'usage') {
			expect(usageEvent.inputTokens).toBe(999)
			expect(usageEvent.outputTokens).toBe(100)
		}
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
				runContext: createRunContext('conv-max-iterations'),
			}),
		)

		const last = events[events.length - 1]
		expect(last.type).toBe('error')
		if (last.type === 'error') {
			expect(last.error.message).toContain('Max iterations reached')
		}
	})

	it('repairs a VALIDATION_ERROR without consuming max iteration budget', async () => {
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
						toolCall: { id: 'repair-call', name: 'mock-tool', arguments: { input: 123 } },
					}
					yield { type: 'done', finishReason: 'tool_calls' }
					return
				}

				if (turn === 2) {
					yield {
						type: 'tool_call_complete',
						toolCall: { id: 'repair-call', name: 'mock-tool', arguments: { input: 'fixed' } },
					}
					yield { type: 'done', finishReason: 'tool_calls' }
					return
				}

				yield { type: 'text_delta', text: 'done' }
				yield { type: 'done', finishReason: 'stop' }
			},
		}

		let executions = 0
		const registry: ToolExecutor = {
			execute: async () => {
				executions += 1
				if (executions === 1) {
					return {
						ok: false,
						error: { code: 'VALIDATION_ERROR', message: 'input must be a string' },
					}
				}

				return { ok: true, data: 'fixed-output' }
			},
		}

		const events = await collectEvents(
			runAgentLoop(createRouter(adapter), registry, {
				messages: [{ role: 'user', content: 'repair tool' }],
				tools: EMPTY_TOOLS,
				maxIterations: 2,
				hookRegistry: new HookRegistry(),
				runContext: createRunContext('conv-validation-repair'),
			}),
		)

		expect(executions).toBe(2)
		expect(turn).toBe(3)
		expect(events[events.length - 1]).toEqual({ type: 'done', finishReason: 'stop' })
		expect(events.some((event) => event.type === 'error')).toBe(false)

		const secondCallToolMessages = calls[1].filter((message) => message.role === 'tool')
		expect(secondCallToolMessages).toEqual([
			{
				role: 'tool',
				content: 'input must be a string',
				toolCallId: 'repair-call',
			},
		])
	})

	it('counts iterations normally after VALIDATION_ERROR repair budget is exhausted', async () => {
		let turns = 0
		const adapter: ProviderAdapter = {
			name: 'mock',
			async *sendMessage(): AsyncGenerator<StreamEvent> {
				turns += 1
				yield {
					type: 'tool_call_complete',
					toolCall: { id: 'exhausted-call', name: 'mock-tool', arguments: { attempt: turns } },
				}
				yield { type: 'done', finishReason: 'tool_calls' }
			},
		}

		let executions = 0
		const registry: ToolExecutor = {
			execute: async () => {
				executions += 1
				return {
					ok: false,
					error: { code: 'VALIDATION_ERROR', message: `invalid attempt ${executions}` },
				}
			},
		}

		const events = await collectEvents(
			runAgentLoop(createRouter(adapter), registry, {
				messages: [{ role: 'user', content: 'repair until budget exhausted' }],
				tools: EMPTY_TOOLS,
				maxIterations: 1,
				hookRegistry: new HookRegistry(),
				runContext: createRunContext('conv-validation-budget'),
			}),
		)

		expect(turns).toBe(3)
		expect(executions).toBe(3)
		const validationResults = events.filter(
			(event) => event.type === 'tool_result' && event.toolResult.toolCallId === 'exhausted-call',
		)
		expect(validationResults.length).toBe(3)
		const last = events[events.length - 1]
		expect(last.type).toBe('error')
		if (last.type === 'error') {
			expect(last.error.message).toContain('Max iterations reached')
		}
	})

	it('tracks VALIDATION_ERROR repair budget per tool call id', async () => {
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
						toolCall: { id: 'repair-a', name: 'mock-tool', arguments: { value: 1 } },
					}
					yield {
						type: 'tool_call_complete',
						toolCall: { id: 'repair-b', name: 'mock-tool', arguments: { value: 2 } },
					}
					yield { type: 'done', finishReason: 'tool_calls' }
					return
				}

				yield { type: 'done', finishReason: 'stop' }
			},
		}

		const registry: ToolExecutor = {
			execute: async (_name, args) => {
				const toolArgs = typeof args === 'object' && args !== null
					? (args as Record<string, unknown>)
					: {}
				const toolCallId = typeof toolArgs._toolCallId === 'string' ? toolArgs._toolCallId : 'missing'

				return {
					ok: false,
					error: { code: 'VALIDATION_ERROR', message: `${toolCallId} is invalid` },
				}
			},
		}

		const events = await collectEvents(
			runAgentLoop(createRouter(adapter), registry, {
				messages: [{ role: 'user', content: 'repair two tools' }],
				tools: EMPTY_TOOLS,
				maxIterations: 1,
				hookRegistry: new HookRegistry(),
				runContext: createRunContext('conv-validation-per-id'),
			}),
		)

		expect(turn).toBe(2)
		expect(events[events.length - 1]).toEqual({ type: 'done', finishReason: 'stop' })
		expect(events.some((event) => event.type === 'error')).toBe(false)

		const repairContext = calls[1].filter((message) => message.role === 'tool')
		expect(repairContext).toEqual([
			{ role: 'tool', content: 'repair-a is invalid', toolCallId: 'repair-a' },
			{ role: 'tool', content: 'repair-b is invalid', toolCallId: 'repair-b' },
		])
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
				runContext: createRunContext('conv-hooks'),
			}),
		)

		expect(fired).toEqual([
			'message:before',
			'tool:before',
			'tool:after',
			'message:after',
			'message:before',
			'message:after',
		])
	})

	it('message:after receives messages including assistant and tool results', async () => {
		const hooks = new HookRegistry()
		const capturedMessages: Message[][] = []

		hooks.register('message:after', async (payload) => {
			capturedMessages.push([...payload.messages])
		})

		const adapter: ProviderAdapter = {
			name: 'mock',
			async *sendMessage(): AsyncGenerator<StreamEvent> {
				yield {
					type: 'tool_call_complete',
					toolCall: {
						id: 'call-1',
						name: 'mock-tool',
						arguments: { input: 'test' },
					},
				}
				yield { type: 'done', finishReason: 'tool_calls' }
			},
		}

		const registry: ToolExecutor = {
			execute: async () => ({ ok: true, data: 'tool-output' }),
		}

		await collectEvents(
			runAgentLoop(createRouter(adapter), registry, {
				messages: [{ role: 'user', content: 'run tool' }],
				tools: EMPTY_TOOLS,
				hookRegistry: hooks,
				runContext: createRunContext('conv-message-after-messages'),
			}),
		)

		// Should have captured messages from the first turn's message:after
		expect(capturedMessages.length).toBeGreaterThanOrEqual(1)

		// The first message:after after tool processing should include:
		// 1. Original user message
		// 2. Assistant message with toolCalls
		// 3. Tool result message
		const firstCapture = capturedMessages[0]
		expect(firstCapture.some((m) => m.role === 'user')).toBe(true)
		expect(firstCapture.some((m) => m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0)).toBe(true)
		expect(firstCapture.some((m) => m.role === 'tool' && m.toolCallId === 'call-1')).toBe(true)
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
					runContext: createRunContext('conv-a'),
				}),
			),
			collectEvents(
				runAgentLoop(createRouter(adapter), registry, {
					messages: [{ role: 'user', content: 'run b' }],
					tools: EMPTY_TOOLS,
					hookRegistry: hooks,
					maxIterations: 1,
					runContext: createRunContext('conv-b'),
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
					runContext: createRunContext('conv-question-a'),
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
					runContext: createRunContext('conv-question-b'),
					questionEmitter: (payload) => {
						emittedB.push(payload.conversationId ?? 'missing')
					},
				}),
			),
		])

		expect(emittedA).toEqual(['conv-question-a'])
		expect(emittedB).toEqual(['conv-question-b'])
	})

	it('emits system:transform per iteration and keeps transform output ephemeral', async () => {
		const hooks = new HookRegistry()
		let transformCalls = 0
		hooks.register('system:transform', (context) => {
			transformCalls += 1
			return {
				messages: [
					{ role: 'system' as const, content: `ephemeral-${transformCalls}` },
					...context.messages,
				],
			}
		})

		const capturedPayloads: Message[][] = []
		let turn = 0
		const adapter: ProviderAdapter = {
			name: 'mock',
			async *sendMessage(messages): AsyncGenerator<StreamEvent> {
				capturedPayloads.push(messages.map((entry) => ({ ...entry })))
				turn += 1
				if (turn === 1) {
					yield {
						type: 'tool_call_complete',
						toolCall: {
							id: 'ephemeral-1',
							name: 'mock-tool',
							arguments: {},
						},
					}
					yield { type: 'done', finishReason: 'tool_calls' }
					return
				}

				yield { type: 'text_delta', text: 'done' }
				yield { type: 'done', finishReason: 'stop' }
			},
		}

		const initialMessages: Message[] = [{ role: 'user', content: 'start' }]
		const initialSnapshot = JSON.stringify(initialMessages)
		const registry: ToolExecutor = {
			execute: async () => ({ ok: true, data: 'ok' }),
		}

		await collectEvents(
			runAgentLoop(createRouter(adapter), registry, {
				messages: initialMessages,
				tools: EMPTY_TOOLS,
				hookRegistry: hooks,
				runContext: createRunContext('conv-transform-ephemeral'),
			}),
		)

		expect(transformCalls).toBe(2)
		expect(capturedPayloads.length).toBe(2)
		expect(capturedPayloads[0][0]).toEqual({ role: 'system', content: 'ephemeral-1' })
		expect(capturedPayloads[1][0]).toEqual({ role: 'system', content: 'ephemeral-2' })
		expect(capturedPayloads[0].filter((message) => message.content.startsWith('ephemeral-')).length).toBe(1)
		expect(capturedPayloads[1].filter((message) => message.content.startsWith('ephemeral-')).length).toBe(1)
		expect(JSON.stringify(initialMessages)).toBe(initialSnapshot)
	})

	it('runs multiple system:transform handlers as a pipeline', async () => {
		const hooks = new HookRegistry()
		hooks.register('system:transform', (context) => ({
			messages: [{ role: 'system' as const, content: 'A' }, ...context.messages],
		}))
		hooks.register('system:transform', (context) => ({
			messages: [
				{
					role: 'system' as const,
					content: `B(saw:${context.messages[0]?.content ?? 'none'})`,
				},
				...context.messages,
			],
		}))

		const capturedPayloads: Message[][] = []
		const adapter: ProviderAdapter = {
			name: 'mock',
			async *sendMessage(messages): AsyncGenerator<StreamEvent> {
				capturedPayloads.push(messages.map((entry) => ({ ...entry })))
				yield { type: 'done', finishReason: 'stop' }
			},
		}

		await collectEvents(
			runAgentLoop(createRouter(adapter), {
				execute: async () => ({ ok: true, data: 'ok' }),
			}, {
				messages: [{ role: 'user', content: 'hello' }],
				tools: EMPTY_TOOLS,
				hookRegistry: hooks,
				runContext: createRunContext('conv-transform-pipeline'),
			}),
		)

		expect(capturedPayloads[0].map((message) => message.content)).toEqual([
			'B(saw:A)',
			'A',
			'hello',
		])
	})

	it('integration: transform fires, clamps budget, preserves ordering, and uses mtime cache', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'elefant-system-transform-integration-'))
		const specPath = join(directory, 'SPEC.md')
		writeFileSync(specPath, '# Contract\n' + 'x'.repeat(400), 'utf-8')

		const hooks = new HookRegistry()
		let transformFires = 0
		hooks.register('system:transform', (context) => {
			transformFires += 1
			return {
				messages: context.messages,
			}
		})
		hooks.register(
			'system:transform',
			createCompactionBlockTransform({
				blocks: [
					{
						name: 'cached-spec',
						render: () => buildSpecBlock(specPath),
					},
				],
				budget: 20,
			}),
		)

		const warnings: string[] = []
		const originalWarn = console.warn
		console.warn = (message?: unknown) => {
			warnings.push(String(message ?? ''))
		}

		const payloads: Message[][] = []
		let turn = 0
		const adapter: ProviderAdapter = {
			name: 'mock',
			async *sendMessage(messages): AsyncGenerator<StreamEvent> {
				payloads.push(messages.map((entry) => ({ ...entry })))
				turn += 1
				if (turn <= 2) {
					yield {
						type: 'tool_call_complete',
						toolCall: {
							id: `integration-${turn}`,
							name: 'mock-tool',
							arguments: {},
						},
					}
					yield { type: 'done', finishReason: 'tool_calls' }
					return
				}
				yield { type: 'text_delta', text: 'final' }
				yield { type: 'done', finishReason: 'stop' }
			},
		}

		const inputMessages: Message[] = [
			{ role: 'system', content: 'fixed-header' },
			{ role: 'user', content: 'run' },
		]
		const inputSnapshot = JSON.stringify(inputMessages)

		await collectEvents(
			runAgentLoop(createRouter(adapter), {
				execute: async () => ({ ok: true, data: 'ok' }),
			}, {
				messages: inputMessages,
				tools: EMPTY_TOOLS,
				hookRegistry: hooks,
				runContext: createRunContext('conv-transform-integration'),
			}),
		)

		console.warn = originalWarn
		rmSync(directory, { recursive: true, force: true })

		expect(transformFires).toBe(3)
		expect(JSON.stringify(inputMessages)).toBe(inputSnapshot)
		expect(payloads.length).toBe(3)
		expect(payloads.every((messages) => messages[0]?.role === 'system')).toBe(true)
		expect(payloads.every((messages) => messages[0]?.content === 'fixed-header')).toBe(true)
		expect(payloads.every((messages) => messages[1]?.role === 'system')).toBe(true)
		expect(payloads.every((messages) => messages[1]?.content.length <= 80)).toBe(true)
		expect(warnings.length).toBeGreaterThan(0)

		// The cached spec block render should read from disk only once for identical mtime.
		expect(__getFileReadCountForTests(specPath)).toBe(1)
	})
})
