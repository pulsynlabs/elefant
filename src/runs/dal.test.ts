import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { Database } from '../db/database.ts'
import {
	createRun,
	getRun,
	listChildRunsByParent,
	listRunsBySession,
	markRunEnded,
	updateRunStatus,
} from './dal.ts'

const tempDirs: string[] = []

function createTempDbPath(): string {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-runs-dal-'))
	tempDirs.push(dir)
	return join(dir, 'db.sqlite')
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true })
	}
})

function insertProjectAndSession(database: Database): { projectId: string; sessionId: string } {
	const projectId = crypto.randomUUID()
	const sessionId = crypto.randomUUID()
	database.db.run('INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)', [
		projectId,
		'Runs project',
		`/tmp/runs-project-${projectId}`,
		null,
	])
	database.db.run(
		'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
		[sessionId, projectId, null, 'execute', 'running', new Date().toISOString(), null],
	)

	return { projectId, sessionId }
}

describe('runs/dal', () => {
	it('supports create/read/update round-trip for agent runs', () => {
		const database = new Database(createTempDbPath())

		const { projectId, sessionId } = insertProjectAndSession(database)

		const created = createRun(database, {
			run_id: crypto.randomUUID(),
			session_id: sessionId,
			project_id: projectId,
			parent_run_id: null,
			agent_type: 'executor',
			title: 'Background run',
			context_mode: 'snapshot',
		})
		expect(created.ok).toBe(true)
		if (!created.ok) {
			database.close()
			return
		}

		const fetched = getRun(database, created.data.run_id)
		expect(fetched.ok).toBe(true)
		if (fetched.ok) {
			expect(fetched.data.status).toBe('running')
			expect(fetched.data.context_mode).toBe('snapshot')
		}

		const listed = listRunsBySession(database, sessionId)
		expect(listed.ok).toBe(true)
		if (listed.ok) {
			expect(listed.data.length).toBe(1)
			expect(listed.data[0]?.run_id).toBe(created.data.run_id)
		}

		const updated = updateRunStatus(database, created.data.run_id, 'error', 'provider failed')
		expect(updated.ok).toBe(true)
		if (updated.ok) {
			expect(updated.data.status).toBe('error')
			expect(updated.data.error_message).toBe('provider failed')
		}

		const ended = markRunEnded(database, created.data.run_id, 'cancelled')
		expect(ended.ok).toBe(true)
		if (ended.ok) {
			expect(ended.data.status).toBe('cancelled')
			expect(ended.data.ended_at).toBeTruthy()
		}

		const table = database.db
			.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_runs'")
			.get() as { name: string } | null
		expect(table?.name).toBe('agent_runs')

		database.close()
	})

	it('stores and retrieves orchestrator_prompt', () => {
		const database = new Database(createTempDbPath())
		const { projectId, sessionId } = insertProjectAndSession(database)

		const prompt = 'Research Pulsyn comprehensively and return a summary.'
		const created = createRun(database, {
			run_id: crypto.randomUUID(),
			session_id: sessionId,
			project_id: projectId,
			parent_run_id: null,
			agent_type: 'researcher',
			title: 'Research Pulsyn',
			context_mode: 'none',
			orchestrator_prompt: prompt,
		})
		expect(created.ok).toBe(true)
		if (!created.ok) {
			database.close()
			return
		}

		const fetched = getRun(database, created.data.run_id)
		expect(fetched.ok).toBe(true)
		if (fetched.ok) {
			expect(fetched.data.orchestrator_prompt).toBe(prompt)
		}

		const listed = listRunsBySession(database, sessionId)
		expect(listed.ok).toBe(true)
		if (listed.ok) {
			expect(listed.data[0]?.orchestrator_prompt).toBe(prompt)
		}

		database.close()
	})

	it('returns empty list when parent run has no children', () => {
		const database = new Database(createTempDbPath())
		const { projectId, sessionId } = insertProjectAndSession(database)

		const parentRunId = crypto.randomUUID()
		const parent = createRun(database, {
			run_id: parentRunId,
			session_id: sessionId,
			project_id: projectId,
			parent_run_id: null,
			agent_type: 'orchestrator',
			title: 'Parent run',
			context_mode: 'snapshot',
		})
		expect(parent.ok).toBe(true)

		const children = listChildRunsByParent(database, parentRunId, sessionId)
		expect(children.ok).toBe(true)
		if (children.ok) {
			expect(children.data).toEqual([])
		}

		database.close()
	})

	it('returns a single direct child for a parent within the same session', () => {
		const database = new Database(createTempDbPath())
		const { projectId, sessionId } = insertProjectAndSession(database)

		const parentRunId = crypto.randomUUID()
		createRun(database, {
			run_id: parentRunId,
			session_id: sessionId,
			project_id: projectId,
			parent_run_id: null,
			agent_type: 'orchestrator',
			title: 'Parent run',
			context_mode: 'snapshot',
		})

		const childRunId = crypto.randomUUID()
		createRun(database, {
			run_id: childRunId,
			session_id: sessionId,
			project_id: projectId,
			parent_run_id: parentRunId,
			agent_type: 'executor',
			title: 'Child run',
			context_mode: 'inherit_session',
		})

		const children = listChildRunsByParent(database, parentRunId, sessionId)
		expect(children.ok).toBe(true)
		if (children.ok) {
			expect(children.data).toHaveLength(1)
			expect(children.data[0]?.run_id).toBe(childRunId)
			expect(children.data[0]?.parent_run_id).toBe(parentRunId)
		}

		database.close()
	})

	it('returns multiple direct children ordered by created_at then run_id and excludes grandchildren', () => {
		const database = new Database(createTempDbPath())
		const { projectId, sessionId } = insertProjectAndSession(database)

		const parentRunId = 'parent-run'
		createRun(database, {
			run_id: parentRunId,
			session_id: sessionId,
			project_id: projectId,
			parent_run_id: null,
			agent_type: 'orchestrator',
			title: 'Parent run',
			context_mode: 'snapshot',
		})

		const sameTimestamp = '2026-04-19T10:00:00.000Z'
		const laterTimestamp = '2026-04-19T10:00:01.000Z'

		createRun(database, {
			run_id: 'child-b',
			session_id: sessionId,
			project_id: projectId,
			parent_run_id: parentRunId,
			agent_type: 'executor',
			title: 'Child B',
			context_mode: 'snapshot',
			created_at: sameTimestamp,
			started_at: sameTimestamp,
		})
		createRun(database, {
			run_id: 'child-a',
			session_id: sessionId,
			project_id: projectId,
			parent_run_id: parentRunId,
			agent_type: 'executor',
			title: 'Child A',
			context_mode: 'snapshot',
			created_at: sameTimestamp,
			started_at: sameTimestamp,
		})
		createRun(database, {
			run_id: 'child-c',
			session_id: sessionId,
			project_id: projectId,
			parent_run_id: parentRunId,
			agent_type: 'executor',
			title: 'Child C',
			context_mode: 'snapshot',
			created_at: laterTimestamp,
			started_at: laterTimestamp,
		})

		createRun(database, {
			run_id: 'grandchild-of-a',
			session_id: sessionId,
			project_id: projectId,
			parent_run_id: 'child-a',
			agent_type: 'executor',
			title: 'Grandchild',
			context_mode: 'snapshot',
		})

		const children = listChildRunsByParent(database, parentRunId, sessionId)
		expect(children.ok).toBe(true)
		if (children.ok) {
			expect(children.data.map((run) => run.run_id)).toEqual(['child-a', 'child-b', 'child-c'])
		}

		database.close()
	})

	it('excludes children from other sessions even when parent_run_id matches', () => {
		const database = new Database(createTempDbPath())
		const { projectId, sessionId: sessionAId } = insertProjectAndSession(database)
		const { sessionId: sessionBId } = insertProjectAndSession(database)

		const sharedParentRunId = 'shared-parent-run-id'
		createRun(database, {
			run_id: sharedParentRunId,
			session_id: sessionAId,
			project_id: projectId,
			parent_run_id: null,
			agent_type: 'orchestrator',
			title: 'Shared Parent',
			context_mode: 'snapshot',
		})

		createRun(database, {
			run_id: 'child-in-session-a',
			session_id: sessionAId,
			project_id: projectId,
			parent_run_id: sharedParentRunId,
			agent_type: 'executor',
			title: 'Child A',
			context_mode: 'snapshot',
		})

		createRun(database, {
			run_id: 'child-in-session-b',
			session_id: sessionBId,
			project_id: projectId,
			parent_run_id: sharedParentRunId,
			agent_type: 'executor',
			title: 'Child B',
			context_mode: 'snapshot',
		})

		const children = listChildRunsByParent(database, sharedParentRunId, sessionAId)
		expect(children.ok).toBe(true)
		if (children.ok) {
			expect(children.data).toHaveLength(1)
			expect(children.data[0]?.run_id).toBe('child-in-session-a')
		}

		database.close()
	})
})
