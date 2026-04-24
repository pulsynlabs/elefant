import { describe, expect, it, spyOn } from 'bun:test'

import { HookRegistry } from '../../hooks/registry.ts'
import { createRun } from '../../runs/dal.js'
import { RunRegistry } from '../../runs/registry.ts'
import type { RunContext } from '../../runs/types.js'
import { ok } from '../../types/result.ts'
import type { Message } from '../../types/providers.js'
import { Database } from '../../db/database.js'
import { createTaskTool, type TaskToolDeps } from './index.js'
import { listMessages } from '../../runs/messages.js'
import * as agentLoopModule from '../../server/agent-loop.js'

interface BuiltDeps {
	deps: TaskToolDeps
	database: Database
	runRegistry: RunRegistry
	publishedEvents: Array<{ projectId: string; sessionId: string; type: string; data: unknown }>
	parentController: AbortController
}

function insertProjectAndSession(database: Database, projectId: string, sessionId: string): void {
	database.db.run('INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)', [
		projectId,
		'task-tool project',
		'/tmp/task-tool-project',
		null,
	])
	database.db.run(
		'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
		[sessionId, projectId, null, 'execute', 'running', new Date().toISOString(), null],
	)
}

function buildDeps(options?: {
	maxTaskDepth?: number
	maxChildren?: number
	currentDepth?: number
	sessionMessages?: Message[]
}): BuiltDeps {
	const database = new Database(':memory:')
	const projectId = crypto.randomUUID()
	const sessionId = crypto.randomUUID()
	insertProjectAndSession(database, projectId, sessionId)

	const databaseWithSessionReader = database as Database & {
		getSessionMessages?: (_sessionId: string) => Message[]
	}
	databaseWithSessionReader.getSessionMessages = () => options?.sessionMessages ?? []

	const runRegistry = new RunRegistry()
	const publishedEvents: Array<{ projectId: string; sessionId: string; type: string; data: unknown }> = []
	const parentController = new AbortController()

	const currentRun: RunContext = {
		runId: 'parent-run-id',
		parentRunId: undefined,
		depth: options?.currentDepth ?? 0,
		agentType: 'orchestrator',
		title: 'Parent run',
		sessionId,
		projectId,
		signal: parentController.signal,
	}

	const createdParent = createRun(database, {
		run_id: currentRun.runId,
		session_id: currentRun.sessionId,
		project_id: currentRun.projectId,
		parent_run_id: null,
		agent_type: currentRun.agentType,
		title: currentRun.title,
		status: 'running',
		context_mode: 'none',
	})
	if (!createdParent.ok) {
		throw new Error(`Failed to seed parent run: ${createdParent.error.message}`)
	}

	const deps: TaskToolDeps = {
		database,
		runRegistry,
		sseManager: {
			publish: (projectId: string, sessionId: string, type: string, data: unknown): void => {
				publishedEvents.push({ projectId, sessionId, type, data })
			},
		} as TaskToolDeps['sseManager'],
		providerRouter: {} as unknown as TaskToolDeps['providerRouter'],
		hookRegistry: new HookRegistry() as unknown as TaskToolDeps['hookRegistry'],
		configManager: {
			resolve: async () =>
				ok({
					maxTaskDepth: options?.maxTaskDepth,
					maxChildren: options?.maxChildren,
				}),
		} as unknown as TaskToolDeps['configManager'],
		toolRegistry: {
			getAll: () => [],
			execute: async () => ok(''),
		} as unknown as TaskToolDeps['toolRegistry'],
		currentRun,
	}

	return {
		deps,
		database,
		runRegistry,
		publishedEvents,
		parentController,
	}
}

// Helper to create mock agent loop events
type MockAgentLoopEvent =
	| { type: 'text_delta'; text: string }
	| { type: 'done' }
	| { type: 'tool_call_complete'; toolCall: { id: string; name: string; arguments: Record<string, unknown> } }
	| { type: 'tool_result'; toolResult: { toolCallId: string; content: string } }
	| { type: 'error'; error: { message: string } }

function mockRunAgentLoop(events: MockAgentLoopEvent[]) {
	return spyOn(agentLoopModule, 'runAgentLoop').mockImplementation(
		async function* (
			_router: unknown,
			_registry: unknown,
			_params: unknown,
		): AsyncGenerator<MockAgentLoopEvent> {
			for (const event of events) {
				yield event as MockAgentLoopEvent
			}
		},
	)
}

describe('createTaskTool', () => {
	it('returns err when depth >= maxTaskDepth', async () => {
		const { deps, database } = buildDeps({ maxTaskDepth: 2, currentDepth: 2 })
		const tool = createTaskTool(deps)

		const result = await tool.execute({
			description: 'depth-guard test',
			prompt: 'do something',
			agent_type: 'researcher',
		})

		expect(result.ok).toBe(false)
		if (result.ok) return

		expect(result.error.code).toBe('VALIDATION_ERROR')
		expect(result.error.message.toLowerCase()).toContain('depth')

		const inserted = database.db
			.query('SELECT COUNT(*) as count FROM agent_runs WHERE parent_run_id = ?')
			.get('parent-run-id') as {
			count: number
		}
		expect(inserted.count).toBe(0)
		database.close()
	})

	it('returns err when depth >= fallback maxTaskDepth when config omits maxTaskDepth', async () => {
		const { deps, database } = buildDeps({ currentDepth: 4 })
		const tool = createTaskTool(deps)

		const result = await tool.execute({
			description: 'fallback depth limit test',
			prompt: 'do something',
			agent_type: 'researcher',
		})

		expect(result.ok).toBe(false)
		if (result.ok) return

		expect(result.error.code).toBe('VALIDATION_ERROR')
		expect(result.error.message).toContain('maxTaskDepth 4')
		database.close()
	})

	it('returns err when child count >= maxChildren', async () => {
		const { deps, runRegistry, database } = buildDeps()
		const tool = createTaskTool(deps)

		for (let i = 0; i < 4; i += 1) {
			runRegistry.registerChildren('parent-run-id', `child-${i}`)
		}

		const result = await tool.execute({
			description: 'concurrency test',
			prompt: 'do something',
			agent_type: 'researcher',
		})

		expect(result.ok).toBe(false)
		if (result.ok) return

		expect(result.error.code).toBe('VALIDATION_ERROR')
		expect(result.error.message.toLowerCase()).toContain('children')
		database.close()
	})

	it('returns success result with done status and finalMessage', async () => {
		const mockSpy = mockRunAgentLoop([
			{ type: 'text_delta', text: 'Hello' },
			{ type: 'text_delta', text: ' world' },
			{ type: 'done' },
		])

		const { deps, database } = buildDeps()
		const tool = createTaskTool(deps)

		const result = await tool.execute({
			description: 'success test',
			prompt: 'say hello',
			agent_type: 'researcher',
		})

		expect(result.ok).toBe(true)
		if (!result.ok) return

		const payload = JSON.parse(result.data) as {
			runId: string
			status: string
			agentType: string
			parentRunId: string
			durationMs: number
			result: {
				finalMessage: string
				toolCallSummary: Array<{ tool: string; count: number }>
			}
		}

		expect(payload.status).toBe('done')
		expect(payload.agentType).toBe('researcher')
		expect(payload.parentRunId).toBe('parent-run-id')
		expect(typeof payload.runId).toBe('string')
		expect(payload.runId.length).toBeGreaterThan(0)
		expect(payload.durationMs).toBeGreaterThanOrEqual(0)
		expect(payload.result).not.toBeNull()
		expect(payload.result.finalMessage).toBe('Hello world')
		expect(payload.result.toolCallSummary).toEqual([])

		mockSpy.mockRestore()
		database.close()
	})

	it('persists messages to database in sequence order', async () => {
		const mockSpy = mockRunAgentLoop([
			{ type: 'text_delta', text: 'First response' },
			{ type: 'done' },
		])

		const { deps, database } = buildDeps()
		const tool = createTaskTool(deps)

		const result = await tool.execute({
			description: 'persistence test',
			prompt: 'test persistence',
			agent_type: 'researcher',
		})

		expect(result.ok).toBe(true)
		if (!result.ok) return

		const payload = JSON.parse(result.data) as { runId: string }

		// Verify messages were persisted
		const messages = listMessages(database, payload.runId)
		expect(messages.length).toBeGreaterThan(0)

		// Check sequence ordering
		const seqs = messages.map((m) => m.seq)
		expect(seqs).toEqual([...seqs].sort((a, b) => a - b))

		// Should have system message (delegation context), user message, and assistant message
		const systemMsg = messages.find((m) => m.role === 'system')
		const userMsg = messages.find((m) => m.role === 'user')
		const assistantMsg = messages.find((m) => m.role === 'assistant')

		expect(systemMsg).toBeDefined()
		expect(systemMsg?.content).toContain('<delegation_context>')
		expect(userMsg).toBeDefined()
		expect(userMsg?.content).toBe('test persistence')
		expect(assistantMsg).toBeDefined()
		expect(assistantMsg?.content).toBe('First response')

		mockSpy.mockRestore()
		database.close()
	})

	it('returns tool call summary with correct counts', async () => {
		const mockSpy = mockRunAgentLoop([
			{ type: 'text_delta', text: 'Let me search' },
			{
				type: 'tool_call_complete',
				toolCall: { id: 'call-1', name: 'search', arguments: { query: 'test' } },
			},
			{
				type: 'tool_result',
				toolResult: { toolCallId: 'call-1', content: 'search results' },
			},
			{ type: 'done' },
		])

		const { deps, database } = buildDeps()
		const tool = createTaskTool(deps)

		const result = await tool.execute({
			description: 'tool call test',
			prompt: 'search for something',
			agent_type: 'researcher',
		})

		expect(result.ok).toBe(true)
		if (!result.ok) return

		const payload = JSON.parse(result.data) as {
			result: {
				finalMessage: string
				toolCallSummary: Array<{ tool: string; count: number }>
			}
		}

		expect(payload.result.toolCallSummary).toHaveLength(1)
		expect(payload.result.toolCallSummary[0]).toEqual({ tool: 'search', count: 1 })

		mockSpy.mockRestore()
		database.close()
	})

	it('aggregates multiple calls to same tool in summary', async () => {
		const mockSpy = mockRunAgentLoop([
			{
				type: 'tool_call_complete',
				toolCall: { id: 'call-1', name: 'search', arguments: { query: 'a' } },
			},
			{
				type: 'tool_call_complete',
				toolCall: { id: 'call-2', name: 'search', arguments: { query: 'b' } },
			},
			{
				type: 'tool_call_complete',
				toolCall: { id: 'call-3', name: 'read_file', arguments: { path: '/tmp/test' } },
			},
			{ type: 'done' },
		])

		const { deps, database } = buildDeps()
		const tool = createTaskTool(deps)

		const result = await tool.execute({
			description: 'multi tool test',
			prompt: 'do multiple things',
			agent_type: 'researcher',
		})

		expect(result.ok).toBe(true)
		if (!result.ok) return

		const payload = JSON.parse(result.data) as {
			result: {
				toolCallSummary: Array<{ tool: string; count: number }>
			}
		}

		expect(payload.result.toolCallSummary).toHaveLength(2)
		expect(payload.result.toolCallSummary).toContainEqual({ tool: 'search', count: 2 })
		expect(payload.result.toolCallSummary).toContainEqual({ tool: 'read_file', count: 1 })

		mockSpy.mockRestore()
		database.close()
	})

	it('returns error status when agent loop yields error event', async () => {
		const mockSpy = mockRunAgentLoop([{ type: 'error', error: { message: 'Something went wrong' } }])

		const { deps, database } = buildDeps()
		const tool = createTaskTool(deps)

		const result = await tool.execute({
			description: 'error test',
			prompt: 'trigger error',
			agent_type: 'researcher',
		})

		expect(result.ok).toBe(true)
		if (!result.ok) return

		const payload = JSON.parse(result.data) as {
			status: string
			result: {
				finalMessage: string
				toolCallSummary: Array<{ tool: string; count: number }>
			}
		}

		expect(payload.status).toBe('error')
		expect(payload.result.finalMessage).toBe('')
		expect(payload.result.toolCallSummary).toEqual([])

		mockSpy.mockRestore()
		database.close()
	})

	it('returns empty finalMessage when no assistant messages', async () => {
		const mockSpy = mockRunAgentLoop([{ type: 'done' }])

		const { deps, database } = buildDeps()
		const tool = createTaskTool(deps)

		const result = await tool.execute({
			description: 'no message test',
			prompt: 'do nothing',
			agent_type: 'researcher',
		})

		expect(result.ok).toBe(true)
		if (!result.ok) return

		const payload = JSON.parse(result.data) as {
			result: {
				finalMessage: string
			}
		}

		expect(payload.result.finalMessage).toBe('')

		mockSpy.mockRestore()
		database.close()
	})

	it('creates a run row in DB with parentRunId = currentRun.runId', async () => {
		const mockSpy = mockRunAgentLoop([{ type: 'done' }])

		const { deps, database } = buildDeps()
		const tool = createTaskTool(deps)

		const result = await tool.execute({
			description: 'my task',
			prompt: 'do something',
			agent_type: 'researcher',
		})

		expect(result.ok).toBe(true)
		if (!result.ok) return

		const payload = JSON.parse(result.data) as {
			runId: string
			parentRunId: string
		}
		expect(payload.parentRunId).toBe('parent-run-id')

		const row = database.db.query('SELECT * FROM agent_runs WHERE run_id = ?').get(payload.runId) as {
			parent_run_id: string | null
		}
		expect(row).toBeDefined()
		expect(row.parent_run_id).toBe('parent-run-id')

		mockSpy.mockRestore()
		database.close()
	})

	it('publishes agent_run.spawned SSE event', async () => {
		const mockSpy = mockRunAgentLoop([{ type: 'done' }])

		const { deps, publishedEvents, database } = buildDeps()
		const tool = createTaskTool(deps)

		await tool.execute({
			description: 'sse test',
			prompt: 'do something',
			agent_type: 'researcher',
		})

		const spawned = publishedEvents.find((event) => event.type === 'agent_run.spawned')
		expect(spawned).toBeDefined()

		mockSpy.mockRestore()
		database.close()
	})

	it('publishes agent_run.tool_call_metadata when tool call context is provided', async () => {
		const mockSpy = mockRunAgentLoop([{ type: 'done' }])

		const { deps, publishedEvents, database } = buildDeps()
		const tool = createTaskTool(deps)

		const result = await tool.execute({
			description: 'metadata test',
			prompt: 'do something',
			agent_type: 'researcher',
			_toolCallId: 'tool-call-123',
		} as unknown as Parameters<typeof tool.execute>[0])

		expect(result.ok).toBe(true)
		if (!result.ok) return

		const payload = JSON.parse(result.data) as { runId: string }
		const metadataEvent = publishedEvents.find((event) => event.type === 'agent_run.tool_call_metadata')
		expect(metadataEvent).toBeDefined()

		const metadata = metadataEvent?.data as {
			data: {
				toolCallId: string
				runId: string
				parentRunId: string
				agentType: string
				title: string
			}
		}

		expect(metadata.data.toolCallId).toBe('tool-call-123')
		expect(metadata.data.runId).toBe(payload.runId)
		expect(metadata.data.parentRunId).toBe('parent-run-id')
		expect(metadata.data.agentType).toBe('researcher')
		expect(metadata.data.title).toBe('metadata test')

		const dbRow = database.db
			.query('SELECT run_id FROM agent_runs WHERE run_id = ?')
			.get(metadata.data.runId) as { run_id: string } | null
		expect(dbRow).toBeDefined()
		expect(dbRow?.run_id).toBe(metadata.data.runId)

		mockSpy.mockRestore()
		database.close()
	})

	it('calls metadataEmitter callback when provided in deps', async () => {
		const mockSpy = mockRunAgentLoop([{ type: 'done' }])

		const { deps, database } = buildDeps()
		const metadataCalls: Array<{
			toolCallId: string
			runId: string
			parentRunId?: string
			agentType: string
			title: string
		}> = []

		const capturingMetadataEmitter = (payload: {
			toolCallId: string
			runId: string
			parentRunId?: string
			agentType: string
			title: string
		}): void => {
			metadataCalls.push(payload)
		}

		const depsWithEmitter: typeof deps = {
			...deps,
			metadataEmitter: capturingMetadataEmitter,
		}

		const tool = createTaskTool(depsWithEmitter)

		const result = await tool.execute({
			description: 'emitter callback test',
			prompt: 'do something',
			agent_type: 'executor',
			_toolCallId: 'tool-call-emitter-456',
		} as unknown as Parameters<typeof tool.execute>[0])

		expect(result.ok).toBe(true)
		if (!result.ok) return

		const payload = JSON.parse(result.data) as { runId: string }

		// metadataEmitter should be called exactly once
		expect(metadataCalls).toHaveLength(1)

		const emitted = metadataCalls[0]
		expect(emitted.toolCallId).toBe('tool-call-emitter-456')
		expect(emitted.runId).toBe(payload.runId)
		expect(emitted.parentRunId).toBe('parent-run-id')
		expect(emitted.agentType).toBe('executor')
		expect(emitted.title).toBe('emitter callback test')

		mockSpy.mockRestore()
		database.close()
	})

	it('does not publish agent_run.tool_call_metadata when depth validation rejects spawn', async () => {
		const { deps, publishedEvents, database } = buildDeps({ currentDepth: 4 })
		const tool = createTaskTool(deps)

		const result = await tool.execute({
			description: 'depth-rejected metadata test',
			prompt: 'do something',
			agent_type: 'researcher',
			_toolCallId: 'tool-call-depth-rejected',
		} as unknown as Parameters<typeof tool.execute>[0])

		expect(result.ok).toBe(false)
		if (result.ok) return

		expect(result.error.code).toBe('VALIDATION_ERROR')
		expect(publishedEvents.some((event) => event.type === 'agent_run.tool_call_metadata')).toBe(false)

		const inserted = database.db
			.query('SELECT COUNT(*) as count FROM agent_runs WHERE parent_run_id = ?')
			.get('parent-run-id') as { count: number }
		expect(inserted.count).toBe(0)
		database.close()
	})

	it('child parentRunId is derived from currentRun.runId, not from any param', async () => {
		const mockSpy = mockRunAgentLoop([{ type: 'done' }])

		const { deps, database } = buildDeps()
		const tool = createTaskTool(deps)

		const forgedParams = {
			description: 'forged parent run test',
			prompt: 'do something',
			agent_type: 'researcher',
			parentRunId: 'forged-parent-run-id',
		} as unknown as Parameters<typeof tool.execute>[0]

		const result = await tool.execute(forgedParams)
		expect(result.ok).toBe(true)
		if (!result.ok) return

		const payload = JSON.parse(result.data) as { runId: string }
		const row = database.db
			.query('SELECT parent_run_id FROM agent_runs WHERE run_id = ?')
			.get(payload.runId) as { parent_run_id: string | null }

		expect(row.parent_run_id).toBe(deps.currentRun.runId)

		mockSpy.mockRestore()
		database.close()
	})

	it('aborting parent run via registry cascades to registered child', async () => {
		// Create a deferred mock that allows us to control when it completes
		let continueExecution: (() => void) | null = null
		const executionPromise = new Promise<void>((resolve) => {
			continueExecution = resolve
		})

		const mockSpy = spyOn(agentLoopModule, 'runAgentLoop').mockImplementation(
			async function* (_router: unknown, _registry: unknown, _params: unknown): AsyncGenerator<MockAgentLoopEvent> {
				// Yield one event then wait for the signal to complete
				yield { type: 'text_delta', text: 'working...' }
				// Wait for the test to signal us to continue (or for abort)
				await executionPromise
				yield { type: 'done' }
			},
		)

		const { deps, runRegistry, parentController, database } = buildDeps()
		const tool = createTaskTool(deps)

		runRegistry.registerRun(deps.currentRun.runId, {
			controller: parentController,
			parentRunId: undefined,
			startedAt: new Date(),
			questionEmitter: () => undefined,
			agentType: 'orchestrator',
			title: 'Parent',
		})

		// Start the tool execution but don't await it yet
		const executePromise = tool.execute({
			description: 'cascade abort test',
			prompt: 'do something',
			agent_type: 'researcher',
		})

		// Give the tool a moment to register the child run
		await new Promise((resolve) => setTimeout(resolve, 10))

		// Get the child run ID from the registry - it should have children registered
		const childRunIds = runRegistry.getChildRunIds(deps.currentRun.runId)
		expect(childRunIds.length).toBe(1)

		const childRunId = childRunIds[0]
		const childEntry = runRegistry.getRun(childRunId)
		expect(childEntry).toBeDefined()
		if (!childEntry) {
			mockSpy.mockRestore()
			database.close()
			return
		}

		// Abort the parent - this should cascade to the child
		runRegistry.abortRun(deps.currentRun.runId)
		expect(childEntry.controller.signal.aborted).toBe(true)

		// Signal the mock to complete
		continueExecution?.()

		// Now await the result
		const result = await executePromise
		expect(result.ok).toBe(true)

		mockSpy.mockRestore()
		database.close()
	})

	it('context_mode none produces correct initial messages', async () => {
		const mockSpy = mockRunAgentLoop([{ type: 'done' }])

		const { deps, database } = buildDeps({
			sessionMessages: [{ role: 'user', content: 'historical message' }],
		})
		const tool = createTaskTool(deps)

		const result = await tool.execute({
			description: 'context mode none test',
			prompt: 'my prompt',
			agent_type: 'researcher',
			context_mode: 'none',
		})

		expect(result.ok).toBe(true)
		if (!result.ok) return

		const payload = JSON.parse(result.data) as { runId: string }
		const messages = listMessages(database, payload.runId)

		// Should have system message (delegation context) and user message
		expect(messages.length).toBeGreaterThanOrEqual(2)
		expect(messages[0]?.role).toBe('system')
		expect(messages[0]?.content).toContain('<delegation_context>')
		expect(messages[0]?.content).toContain('context_mode: none')
		expect(messages[1]?.role).toBe('user')
		expect(messages[1]?.content).toBe('my prompt')

		mockSpy.mockRestore()
		database.close()
	})

	it('returns null result for chat/ephemeral runs (non-persistable context)', async () => {
		const database = new Database(':memory:')
		const projectId = 'chat'
		const sessionId = 'chat:test-session'

		const runRegistry = new RunRegistry()
		const publishedEvents: Array<{ projectId: string; sessionId: string; type: string; data: unknown }> = []
		const parentController = new AbortController()

		const currentRun: RunContext = {
			runId: 'chat:parent-run',
			parentRunId: undefined,
			depth: 0,
			agentType: 'orchestrator',
			title: 'Parent run',
			sessionId,
			projectId,
			signal: parentController.signal,
		}

		const deps: TaskToolDeps = {
			database,
			runRegistry,
			sseManager: {
				publish: (projectId: string, sessionId: string, type: string, data: unknown): void => {
					publishedEvents.push({ projectId, sessionId, type, data })
				},
			} as TaskToolDeps['sseManager'],
			providerRouter: {} as unknown as TaskToolDeps['providerRouter'],
			hookRegistry: new HookRegistry() as unknown as TaskToolDeps['hookRegistry'],
			configManager: {
				resolve: async () => ok({}),
			} as unknown as TaskToolDeps['configManager'],
			toolRegistry: {
				getAll: () => [],
				execute: async () => ok(''),
			} as unknown as TaskToolDeps['toolRegistry'],
			currentRun,
		}

		const mockSpy = mockRunAgentLoop([{ type: 'done' }])
		const tool = createTaskTool(deps)

		const result = await tool.execute({
			description: 'chat run test',
			prompt: 'do something',
			agent_type: 'researcher',
		})

		expect(result.ok).toBe(true)
		if (!result.ok) return

		const payload = JSON.parse(result.data) as {
			status: string
			result: null | { finalMessage: string; toolCallSummary: unknown[] }
		}

		expect(payload.status).toBe('done')
		expect(payload.result).toBeNull()

		mockSpy.mockRestore()
		database.close()
	})
})
