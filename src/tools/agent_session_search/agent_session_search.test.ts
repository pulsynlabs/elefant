import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { Database } from '../../db/database.ts'
import { insertMessage } from '../../runs/messages.ts'
import type { RunContext } from '../../runs/types.ts'
import { createAgentSessionSearchTool, type AgentSessionSearchDeps } from './index.ts'

const tempDirs: string[] = []

function createTempDbPath(): string {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-agent-session-search-test-'))
	tempDirs.push(dir)
	return join(dir, 'db.sqlite')
}

function loadMigration(filename: string): string {
	const path = join(import.meta.dirname, '..', '..', 'db', 'migrations', filename)
	return readFileSync(path, 'utf-8')
}

function setupSchema(database: Database): void {
	// Apply migrations in order (0001, 0002, 0003)
	const migration1 = loadMigration('0001_init.sql')
	const migration2 = loadMigration('0002_agent_runs.sql')
	const migration3 = loadMigration('0003_agent_run_messages.sql')

	database.db.run(migration1)
	database.db.run(migration2)
	database.db.run(migration3)
}

function insertProjectAndSession(database: Database): { projectId: string; sessionId: string } {
	const projectId = crypto.randomUUID()
	const sessionId = crypto.randomUUID()

	database.db.run('INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)', [
		projectId,
		'Test project',
		`/tmp/test-project-${projectId}`,
		null,
	])

	database.db.run(
		'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
		[sessionId, projectId, null, 'execute', 'running', new Date().toISOString(), null],
	)

	return { projectId, sessionId }
}

function insertAgentRun(
	database: Database,
	projectId: string,
	sessionId: string,
	runId: string,
	parentRunId?: string,
): void {
	database.db.run(
		`INSERT INTO agent_runs (
			run_id, session_id, project_id, parent_run_id, agent_type, title, status, context_mode
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[runId, sessionId, projectId, parentRunId ?? null, 'executor', 'Test run', 'running', 'snapshot'],
	)
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true })
	}
})

describe('agent_session_search tool', () => {
	it('returns all messages for a run with no filters', async () => {
		const database = new Database(createTempDbPath())
		setupSchema(database)

		const { projectId, sessionId } = insertProjectAndSession(database)
		const runId = crypto.randomUUID()
		insertAgentRun(database, projectId, sessionId, runId)

		// Insert multiple messages with different roles
		insertMessage(database, { run_id: runId, seq: 1, role: 'system', content: 'System prompt' })
		insertMessage(database, { run_id: runId, seq: 2, role: 'user', content: 'Hello!' })
		insertMessage(database, { run_id: runId, seq: 3, role: 'assistant', content: 'Hi there!' })

		// Create tool with current run context
		const currentRun: RunContext = {
			runId: crypto.randomUUID(),
			sessionId,
			projectId,
			agentType: 'orchestrator',
			title: 'Parent run',
			depth: 0,
			signal: new AbortController().signal,
		}

		const deps: AgentSessionSearchDeps = { database, currentRun }
		const tool = createAgentSessionSearchTool(deps)

		// Execute tool with no filters
		const result = await tool.execute({ run_id: runId })

		expect(result.ok).toBe(true)
		if (result.ok) {
			const parsed = JSON.parse(result.data)
			expect(parsed.messages).toHaveLength(3)
			expect(parsed.total).toBe(3)
			expect(parsed.run_id).toBe(runId)

			// Verify message order and content preview
			expect(parsed.messages[0].seq).toBe(1)
			expect(parsed.messages[0].role).toBe('system')
			expect(parsed.messages[0].content_preview).toBe('System prompt')

			expect(parsed.messages[1].seq).toBe(2)
			expect(parsed.messages[1].role).toBe('user')
			expect(parsed.messages[1].content_preview).toBe('Hello!')

			expect(parsed.messages[2].seq).toBe(3)
			expect(parsed.messages[2].role).toBe('assistant')
			expect(parsed.messages[2].content_preview).toBe('Hi there!')
		}

		database.close()
	})

	it('filters by role — only assistant messages returned', async () => {
		const database = new Database(createTempDbPath())
		setupSchema(database)

		const { projectId, sessionId } = insertProjectAndSession(database)
		const runId = crypto.randomUUID()
		insertAgentRun(database, projectId, sessionId, runId)

		// Insert messages with different roles
		insertMessage(database, { run_id: runId, seq: 1, role: 'system', content: 'System prompt' })
		insertMessage(database, { run_id: runId, seq: 2, role: 'user', content: 'User question' })
		insertMessage(database, { run_id: runId, seq: 3, role: 'assistant', content: 'Assistant response 1' })
		insertMessage(database, { run_id: runId, seq: 4, role: 'user', content: 'Follow up' })
		insertMessage(database, { run_id: runId, seq: 5, role: 'assistant', content: 'Assistant response 2' })

		const currentRun: RunContext = {
			runId: crypto.randomUUID(),
			sessionId,
			projectId,
			agentType: 'orchestrator',
			title: 'Parent run',
			depth: 0,
			signal: new AbortController().signal,
		}

		const deps: AgentSessionSearchDeps = { database, currentRun }
		const tool = createAgentSessionSearchTool(deps)

		// Execute tool with role filter
		const result = await tool.execute({ run_id: runId, role: 'assistant' })

		expect(result.ok).toBe(true)
		if (result.ok) {
			const parsed = JSON.parse(result.data)
			expect(parsed.messages).toHaveLength(2)
			expect(parsed.total).toBe(2)

			// All returned messages should be assistant role
			expect(parsed.messages[0].role).toBe('assistant')
			expect(parsed.messages[0].content_preview).toBe('Assistant response 1')
			expect(parsed.messages[1].role).toBe('assistant')
			expect(parsed.messages[1].content_preview).toBe('Assistant response 2')
		}

		database.close()
	})

	it('filters by query — substring match works', async () => {
		const database = new Database(createTempDbPath())
		setupSchema(database)

		const { projectId, sessionId } = insertProjectAndSession(database)
		const runId = crypto.randomUUID()
		insertAgentRun(database, projectId, sessionId, runId)

		// Insert messages with different content
		insertMessage(database, { run_id: runId, seq: 1, role: 'user', content: 'Hello world!' })
		insertMessage(database, { run_id: runId, seq: 2, role: 'assistant', content: 'Goodbye moon!' })
		insertMessage(database, { run_id: runId, seq: 3, role: 'user', content: 'Hello again!' })

		const currentRun: RunContext = {
			runId: crypto.randomUUID(),
			sessionId,
			projectId,
			agentType: 'orchestrator',
			title: 'Parent run',
			depth: 0,
			signal: new AbortController().signal,
		}

		const deps: AgentSessionSearchDeps = { database, currentRun }
		const tool = createAgentSessionSearchTool(deps)

		// Execute tool with query filter (case-insensitive)
		const result = await tool.execute({ run_id: runId, query: 'hello' })

		expect(result.ok).toBe(true)
		if (result.ok) {
			const parsed = JSON.parse(result.data)
			expect(parsed.messages).toHaveLength(2)
			expect(parsed.total).toBe(2)

			// Both messages containing 'hello' (case-insensitive)
			expect(parsed.messages[0].content_preview).toBe('Hello world!')
			expect(parsed.messages[1].content_preview).toBe('Hello again!')
		}

		database.close()
	})

	it('combined role + query filter', async () => {
		const database = new Database(createTempDbPath())
		setupSchema(database)

		const { projectId, sessionId } = insertProjectAndSession(database)
		const runId = crypto.randomUUID()
		insertAgentRun(database, projectId, sessionId, runId)

		// Insert messages with different roles and content
		insertMessage(database, { run_id: runId, seq: 1, role: 'user', content: 'User test message' })
		insertMessage(database, { run_id: runId, seq: 2, role: 'assistant', content: 'Assistant test message' })
		insertMessage(database, { run_id: runId, seq: 3, role: 'user', content: 'User other message' })
		insertMessage(database, { run_id: runId, seq: 4, role: 'assistant', content: 'Assistant other message' })

		const currentRun: RunContext = {
			runId: crypto.randomUUID(),
			sessionId,
			projectId,
			agentType: 'orchestrator',
			title: 'Parent run',
			depth: 0,
			signal: new AbortController().signal,
		}

		const deps: AgentSessionSearchDeps = { database, currentRun }
		const tool = createAgentSessionSearchTool(deps)

		// Execute tool with both role and query filters
		const result = await tool.execute({ run_id: runId, role: 'assistant', query: 'test' })

		expect(result.ok).toBe(true)
		if (result.ok) {
			const parsed = JSON.parse(result.data)
			expect(parsed.messages).toHaveLength(1)
			expect(parsed.total).toBe(1)

			// Only the assistant message containing 'test'
			expect(parsed.messages[0].role).toBe('assistant')
			expect(parsed.messages[0].content_preview).toBe('Assistant test message')
		}

		database.close()
	})

	it('respects limit — insert 10, query limit=3, only 3 returned', async () => {
		const database = new Database(createTempDbPath())
		setupSchema(database)

		const { projectId, sessionId } = insertProjectAndSession(database)
		const runId = crypto.randomUUID()
		insertAgentRun(database, projectId, sessionId, runId)

		// Insert 10 messages
		for (let i = 1; i <= 10; i++) {
			insertMessage(database, {
				run_id: runId,
				seq: i,
				role: i % 2 === 0 ? 'assistant' : 'user',
				content: `Message ${i}`,
			})
		}

		const currentRun: RunContext = {
			runId: crypto.randomUUID(),
			sessionId,
			projectId,
			agentType: 'orchestrator',
			title: 'Parent run',
			depth: 0,
			signal: new AbortController().signal,
		}

		const deps: AgentSessionSearchDeps = { database, currentRun }
		const tool = createAgentSessionSearchTool(deps)

		// Execute tool with limit=3
		const result = await tool.execute({ run_id: runId, limit: 3 })

		expect(result.ok).toBe(true)
		if (result.ok) {
			const parsed = JSON.parse(result.data)
			expect(parsed.messages).toHaveLength(3)
			expect(parsed.total).toBe(3)

			// Should be first 3 by seq order
			expect(parsed.messages[0].seq).toBe(1)
			expect(parsed.messages[1].seq).toBe(2)
			expect(parsed.messages[2].seq).toBe(3)
		}

		database.close()
	})

	it('returns error when run_id not found', async () => {
		const database = new Database(createTempDbPath())
		setupSchema(database)

		const { projectId, sessionId } = insertProjectAndSession(database)
		const nonExistentRunId = crypto.randomUUID()

		const currentRun: RunContext = {
			runId: crypto.randomUUID(),
			sessionId,
			projectId,
			agentType: 'orchestrator',
			title: 'Parent run',
			depth: 0,
			signal: new AbortController().signal,
		}

		const deps: AgentSessionSearchDeps = { database, currentRun }
		const tool = createAgentSessionSearchTool(deps)

		// Execute tool with non-existent run_id
		const result = await tool.execute({ run_id: nonExistentRunId })

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe('FILE_NOT_FOUND')
			expect(result.error.message).toContain(nonExistentRunId)
		}

		database.close()
	})

	it('returns error when run belongs to different session (cross-session denial)', async () => {
		const database = new Database(createTempDbPath())
		setupSchema(database)

		// Create first project and session (the caller's session)
		const { projectId: callerProjectId, sessionId: callerSessionId } = insertProjectAndSession(database)

		// Create second project and session (different session)
		const otherProjectId = crypto.randomUUID()
		const otherSessionId = crypto.randomUUID()

		database.db.run('INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)', [
			otherProjectId,
			'Other project',
			`/tmp/other-project-${otherProjectId}`,
			null,
		])

		database.db.run(
			'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
			[otherSessionId, otherProjectId, null, 'execute', 'running', new Date().toISOString(), null],
		)

		// Create a run in the OTHER session
		const otherRunId = crypto.randomUUID()
		insertAgentRun(database, otherProjectId, otherSessionId, otherRunId)

		// Insert a message in that run
		insertMessage(database, { run_id: otherRunId, seq: 1, role: 'user', content: 'Secret message' })

		// Create tool with caller's context (different session)
		const currentRun: RunContext = {
			runId: crypto.randomUUID(),
			sessionId: callerSessionId,
			projectId: callerProjectId,
			agentType: 'orchestrator',
			title: 'Parent run',
			depth: 0,
			signal: new AbortController().signal,
		}

		const deps: AgentSessionSearchDeps = { database, currentRun }
		const tool = createAgentSessionSearchTool(deps)

		// Try to search the run from different session
		const result = await tool.execute({ run_id: otherRunId })

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe('PERMISSION_DENIED')
			expect(result.error.message).toContain('Cross-session search forbidden')
			expect(result.error.message).toContain(otherSessionId)
		}

		database.close()
	})

	it('allows search when run is a direct child of the caller\'s run', async () => {
		const database = new Database(createTempDbPath())
		setupSchema(database)

		const { projectId, sessionId } = insertProjectAndSession(database)

		// Create parent run (the caller)
		const parentRunId = crypto.randomUUID()
		insertAgentRun(database, projectId, sessionId, parentRunId)

		// Create child run (direct child of parent)
		const childRunId = crypto.randomUUID()
		insertAgentRun(database, projectId, sessionId, childRunId, parentRunId)

		// Insert messages in child run
		insertMessage(database, { run_id: childRunId, seq: 1, role: 'system', content: 'Child system prompt' })
		insertMessage(database, { run_id: childRunId, seq: 2, role: 'assistant', content: 'Child response' })

		// Create tool with parent run as current context
		const currentRun: RunContext = {
			runId: parentRunId,
			sessionId,
			projectId,
			agentType: 'orchestrator',
			title: 'Parent run',
			depth: 0,
			signal: new AbortController().signal,
		}

		const deps: AgentSessionSearchDeps = { database, currentRun }
		const tool = createAgentSessionSearchTool(deps)

		// Execute tool to search child run (same session, should succeed)
		const result = await tool.execute({ run_id: childRunId })

		expect(result.ok).toBe(true)
		if (result.ok) {
			const parsed = JSON.parse(result.data)
			expect(parsed.messages).toHaveLength(2)
			expect(parsed.total).toBe(2)
			expect(parsed.run_id).toBe(childRunId)
		}

		database.close()
	})
})
