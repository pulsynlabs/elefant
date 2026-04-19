import { describe, expect, it } from 'bun:test'

import { HookRegistry } from '../../hooks/registry.ts'
import { createRun } from '../../runs/dal.js'
import { RunRegistry } from '../../runs/registry.ts'
import type { RunContext } from '../../runs/types.js'
import { ok } from '../../types/result.ts'
import type { Message } from '../../types/providers.js'
import { Database } from '../../db/database.ts'
import { createTaskTool, type TaskToolDeps } from './index.js'

interface BuiltDeps {
	deps: TaskToolDeps
	database: Database
	runRegistry: RunRegistry
	publishedEvents: Array<{ projectId: string; sessionId: string; type: string; data: unknown }>
	adapterCalls: Message[][]
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

function waitFor<T>(check: () => T | undefined, timeoutMs = 500): Promise<T> {
	const startedAt = Date.now()

	return new Promise((resolve, reject) => {
		const tick = (): void => {
			const value = check()
			if (value !== undefined) {
				resolve(value)
				return
			}

			if (Date.now() - startedAt >= timeoutMs) {
				reject(new Error('Timed out waiting for expected condition'))
				return
			}

			setTimeout(tick, 5)
		}

		tick()
	})
}

function buildDeps(options?: {
	maxTaskDepth?: number
	maxChildren?: number
	currentDepth?: number
	blockingAdapter?: boolean
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
	const adapterCalls: Message[][] = []
	const parentController = new AbortController()

	const adapter = {
		name: 'stub-provider',
		sendMessage: async function* (
			messages: Message[],
		): AsyncGenerator<{ type: 'done'; finishReason: 'stop' }> {
			adapterCalls.push(messages)

			if (options?.blockingAdapter) {
				await new Promise<void>((resolve) => {
					if (parentController.signal.aborted) {
						resolve()
						return
					}

					parentController.signal.addEventListener('abort', () => resolve(), { once: true })
				})
				return
			}

			yield {
				type: 'done',
				finishReason: 'stop',
			}
		},
	}

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
		providerRouter: {
			getAdapter: () => ok(adapter),
		} as unknown as TaskToolDeps['providerRouter'],
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
		adapterCalls,
		parentController,
	}
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

	it('does not apply depth guard when maxTaskDepth is undefined', async () => {
		const { deps, database } = buildDeps({ currentDepth: 10 })
		const tool = createTaskTool(deps)

		const result = await tool.execute({
			description: 'no depth limit test',
			prompt: 'do something',
			agent_type: 'researcher',
		})

		expect(result.ok).toBe(true)
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

	it('creates a run row in DB with parentRunId = currentRun.runId', async () => {
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
		database.close()
	})

	it('publishes agent_run.spawned SSE event before returning', async () => {
		const { deps, publishedEvents, database } = buildDeps()
		const tool = createTaskTool(deps)

		await tool.execute({
			description: 'sse test',
			prompt: 'do something',
			agent_type: 'researcher',
		})

		const spawned = publishedEvents.find((event) => event.type === 'agent_run.spawned')
		expect(spawned).toBeDefined()
		database.close()
	})

	it('returns correct JSON payload with spawned status', async () => {
		const { deps, database } = buildDeps()
		const tool = createTaskTool(deps)

		const result = await tool.execute({
			description: 'return shape test',
			prompt: 'do something',
			agent_type: 'researcher',
		})

		expect(result.ok).toBe(true)
		if (!result.ok) return

		const payload = JSON.parse(result.data) as {
			runId: string
			status: string
			agentType: string
			parentRunId: string
		}

		expect(payload.status).toBe('spawned')
		expect(payload.agentType).toBe('researcher')
		expect(payload.parentRunId).toBe('parent-run-id')
		expect(typeof payload.runId).toBe('string')
		expect(payload.runId.length).toBeGreaterThan(0)
		database.close()
	})

	it('child parentRunId is derived from currentRun.runId, not from any param', async () => {
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
		database.close()
	})

	it('aborting parent run via registry cascades to registered child', async () => {
		const { deps, runRegistry, parentController, database } = buildDeps({ blockingAdapter: true })
		const tool = createTaskTool(deps)

		runRegistry.registerRun(deps.currentRun.runId, {
			controller: parentController,
			parentRunId: undefined,
			startedAt: new Date(),
			questionEmitter: () => undefined,
			agentType: 'orchestrator',
			title: 'Parent',
		})

		const result = await tool.execute({
			description: 'cascade abort test',
			prompt: 'do something',
			agent_type: 'researcher',
		})

		expect(result.ok).toBe(true)
		if (!result.ok) return

		const payload = JSON.parse(result.data) as { runId: string }
		const childEntry = runRegistry.getRun(payload.runId)
		expect(childEntry).toBeDefined()
		if (!childEntry) return

		runRegistry.abortRun(deps.currentRun.runId)
		expect(childEntry.controller.signal.aborted).toBe(true)
		database.close()
	})

	it('context_mode none produces 2 initial messages: delegation system + user prompt', async () => {
		const { deps, adapterCalls, database } = buildDeps({
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
		const firstCall = await waitFor(() => adapterCalls.at(0))

		expect(firstCall.length).toBe(2)
		expect(firstCall[0]?.role).toBe('system')
		expect(firstCall[0]?.content).toContain('<delegation_context>')
		expect(firstCall[1]).toEqual({ role: 'user', content: 'my prompt' })
		database.close()
	})
})
