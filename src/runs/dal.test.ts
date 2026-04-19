import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { Database } from '../db/database.ts'
import { createRun, getRun, listRunsBySession, markRunEnded, updateRunStatus } from './dal.ts'

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

describe('runs/dal', () => {
	it('supports create/read/update round-trip for agent runs', () => {
		const database = new Database(createTempDbPath())

		const projectId = crypto.randomUUID()
		const sessionId = crypto.randomUUID()
		database.db.run(
			'INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)',
			[projectId, 'Runs project', '/tmp/runs-project', null],
		)
		database.db.run(
			'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
			[sessionId, projectId, null, 'execute', 'running', new Date().toISOString(), null],
		)

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
})
