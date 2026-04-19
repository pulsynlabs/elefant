import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { Database } from '../../db/database.ts'
import { createRun } from '../../runs/dal.js'
import type { RunContext } from '../../runs/types.js'
import { createWaitOnRunTool, type WaitOnRunResult } from './index.js'

interface Fixture {
	database: Database
	projectId: string
	sessionId: string
}

let fixture: Fixture

function createFixture(): Fixture {
	const database = new Database(':memory:')
	const projectId = crypto.randomUUID()
	const sessionId = crypto.randomUUID()

	database.db.run('INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)', [
		projectId,
		'wait-on-run project',
		'/tmp/wait-on-run-project',
		null,
	])
	database.db.run(
		'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
		[sessionId, projectId, null, 'execute', 'running', new Date().toISOString(), null],
	)

	return { database, projectId, sessionId }
}

function insertRun(
	database: Database,
	input: {
		runId: string
		sessionId: string
		projectId: string
		status: 'running' | 'done' | 'error' | 'cancelled'
		errorMessage?: string | null
	},
): void {
	const created = createRun(database, {
		run_id: input.runId,
		session_id: input.sessionId,
		project_id: input.projectId,
		parent_run_id: null,
		agent_type: 'executor',
		title: 'child run',
		status: input.status,
		context_mode: 'none',
		error_message: input.errorMessage ?? null,
	})

	if (!created.ok) {
		throw new Error(`Failed to create run for test: ${created.error.message}`)
	}
}

function makeCurrentRun(sessionId: string, signal: AbortSignal): RunContext {
	return {
		runId: crypto.randomUUID(),
		depth: 0,
		agentType: 'executor',
		title: 'parent run',
		sessionId,
		projectId: fixture.projectId,
		signal,
	}
}

function parseResult(json: string): WaitOnRunResult {
	return JSON.parse(json) as WaitOnRunResult
}

describe('wait_on_run tool', () => {
	beforeEach(() => {
		fixture = createFixture()
	})

	afterEach(() => {
		fixture.database.close()
	})

	it('resolves with done status when run is already terminal', async () => {
		const runId = crypto.randomUUID()
		insertRun(fixture.database, {
			runId,
			sessionId: fixture.sessionId,
			projectId: fixture.projectId,
			status: 'done',
		})

		const tool = createWaitOnRunTool({
			database: fixture.database,
			currentRun: makeCurrentRun(fixture.sessionId, new AbortController().signal),
		})

		const result = await tool.execute({ run_id: runId })
		expect(result.ok).toBe(true)
		if (!result.ok) return

		const payload = parseResult(result.data)
		expect(payload.runId).toBe(runId)
		expect(payload.status).toBe('done')
		expect(payload.errorMessage).toBeNull()
		expect(payload.durationMs).toBeGreaterThanOrEqual(0)
	})

	it('resolves with error status and error message', async () => {
		const runId = crypto.randomUUID()
		insertRun(fixture.database, {
			runId,
			sessionId: fixture.sessionId,
			projectId: fixture.projectId,
			status: 'error',
			errorMessage: 'something broke',
		})

		const tool = createWaitOnRunTool({
			database: fixture.database,
			currentRun: makeCurrentRun(fixture.sessionId, new AbortController().signal),
		})

		const result = await tool.execute({ run_id: runId })
		expect(result.ok).toBe(true)
		if (!result.ok) return

		const payload = parseResult(result.data)
		expect(payload.status).toBe('error')
		expect(payload.errorMessage).toBe('something broke')
	})

	it('returns timeout status when child run does not reach terminal state in time', async () => {
		const runId = crypto.randomUUID()
		insertRun(fixture.database, {
			runId,
			sessionId: fixture.sessionId,
			projectId: fixture.projectId,
			status: 'running',
		})

		const tool = createWaitOnRunTool({
			database: fixture.database,
			currentRun: makeCurrentRun(fixture.sessionId, new AbortController().signal),
		})

		const start = Date.now()
		const result = await tool.execute({ run_id: runId, timeout_ms: 100 })
		const wallMs = Date.now() - start

		expect(result.ok).toBe(true)
		if (!result.ok) return

		const payload = parseResult(result.data)
		expect(payload.status).toBe('timeout')
		expect(payload.errorMessage).toBeNull()
		expect(wallMs).toBeLessThan(2_000)
	})

	it('returns err when run_id is not found', async () => {
		const tool = createWaitOnRunTool({
			database: fixture.database,
			currentRun: makeCurrentRun(fixture.sessionId, new AbortController().signal),
		})

		const result = await tool.execute({ run_id: 'nonexistent-id' })
		expect(result.ok).toBe(false)
		if (result.ok) return

		expect(result.error.code).toBe('NOT_FOUND')
		expect(result.error.message).toContain('nonexistent-id')
	})

	it('returns err when parent signal is already aborted', async () => {
		const runId = crypto.randomUUID()
		insertRun(fixture.database, {
			runId,
			sessionId: fixture.sessionId,
			projectId: fixture.projectId,
			status: 'running',
		})

		const controller = new AbortController()
		controller.abort()

		const tool = createWaitOnRunTool({
			database: fixture.database,
			currentRun: makeCurrentRun(fixture.sessionId, controller.signal),
		})

		const result = await tool.execute({ run_id: runId })
		expect(result.ok).toBe(false)
		if (result.ok) return

		expect(result.error.code).toBe('ABORTED')
		expect(result.error.message.toLowerCase()).toContain('aborted')
	})

	it('handles huge timeout input without hanging when run is already done (timeout cap path)', async () => {
		const runId = crypto.randomUUID()
		insertRun(fixture.database, {
			runId,
			sessionId: fixture.sessionId,
			projectId: fixture.projectId,
			status: 'done',
		})

		const tool = createWaitOnRunTool({
			database: fixture.database,
			currentRun: makeCurrentRun(fixture.sessionId, new AbortController().signal),
		})

		const start = Date.now()
		const result = await tool.execute({ run_id: runId, timeout_ms: 999_999 })
		const wallMs = Date.now() - start

		expect(result.ok).toBe(true)
		if (!result.ok) return

		const payload = parseResult(result.data)
		expect(payload.status).toBe('done')
		expect(wallMs).toBeLessThan(500)
	})
})
