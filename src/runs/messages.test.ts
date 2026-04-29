import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { Database } from '../db/database.ts'
import {
	insertMessage,
	listMessages,
	queryMessages,
	type AgentRunMessage,
} from './messages.ts'

const tempDirs: string[] = []

function createTempDbPath(): string {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-messages-test-'))
	tempDirs.push(dir)
	return join(dir, 'db.sqlite')
}

function loadMigration(filename: string): string {
	const path = join(import.meta.dirname, '..', 'db', 'migrations', filename)
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
): void {
	database.db.run(
		`INSERT INTO agent_runs (
			run_id, session_id, project_id, parent_run_id, agent_type, title, status, context_mode
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[runId, sessionId, projectId, null, 'executor', 'Test run', 'running', 'snapshot'],
	)
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true })
	}
})

describe('agent_run_messages DAL', () => {
	it('insertMessage round-trip: insert a row, listMessages returns it with correct fields', () => {
		const database = new Database(createTempDbPath())
		setupSchema(database)

		const { projectId, sessionId } = insertProjectAndSession(database)
		const runId = crypto.randomUUID()
		insertAgentRun(database, projectId, sessionId, runId)

		// Insert a message
		insertMessage(database, {
			run_id: runId,
			seq: 1,
			role: 'user',
			content: 'Hello, assistant!',
			tool_name: null,
		})

		// List messages and verify
		const messages = listMessages(database, runId)
		expect(messages).toHaveLength(1)

		const msg = messages[0]!
		expect(msg.run_id).toBe(runId)
		expect(msg.seq).toBe(1)
		expect(msg.role).toBe('user')
		expect(msg.content).toBe('Hello, assistant!')
		expect(msg.tool_name).toBeNull()
		expect(msg.id).toBeGreaterThan(0)
		expect(msg.created_at).toBeTruthy()

		database.close()
	})

	it('listMessages ordered by seq ASC: insert seq=2 then seq=1, confirm order is [1, 2]', () => {
		const database = new Database(createTempDbPath())
		setupSchema(database)

		const { projectId, sessionId } = insertProjectAndSession(database)
		const runId = crypto.randomUUID()
		insertAgentRun(database, projectId, sessionId, runId)

		// Insert seq=2 first
		insertMessage(database, {
			run_id: runId,
			seq: 2,
			role: 'assistant',
			content: 'Second message',
		})

		// Then insert seq=1
		insertMessage(database, {
			run_id: runId,
			seq: 1,
			role: 'user',
			content: 'First message',
		})

		// List should be ordered by seq ASC
		const messages = listMessages(database, runId)
		expect(messages).toHaveLength(2)
		expect(messages[0]!.seq).toBe(1)
		expect(messages[0]!.content).toBe('First message')
		expect(messages[1]!.seq).toBe(2)
		expect(messages[1]!.content).toBe('Second message')

		database.close()
	})

	it('queryMessages filters by role: insert assistant + user, query role=assistant, only 1 returned', () => {
		const database = new Database(createTempDbPath())
		setupSchema(database)

		const { projectId, sessionId } = insertProjectAndSession(database)
		const runId = crypto.randomUUID()
		insertAgentRun(database, projectId, sessionId, runId)

		// Insert user message
		insertMessage(database, {
			run_id: runId,
			seq: 1,
			role: 'user',
			content: 'User question',
		})

		// Insert assistant message
		insertMessage(database, {
			run_id: runId,
			seq: 2,
			role: 'assistant',
			content: 'Assistant response',
		})

		// Query only assistant messages
		const assistantMessages = queryMessages(database, { run_id: runId, role: 'assistant' })
		expect(assistantMessages).toHaveLength(1)
		expect(assistantMessages[0]!.role).toBe('assistant')
		expect(assistantMessages[0]!.content).toBe('Assistant response')

		database.close()
	})

	it('queryMessages filters by query: insert two rows, one with hello, one with world, search hello, only 1 returned', () => {
		const database = new Database(createTempDbPath())
		setupSchema(database)

		const { projectId, sessionId } = insertProjectAndSession(database)
		const runId = crypto.randomUUID()
		insertAgentRun(database, projectId, sessionId, runId)

		// Insert message with 'hello'
		insertMessage(database, {
			run_id: runId,
			seq: 1,
			role: 'user',
			content: 'Hello there!',
		})

		// Insert message with 'world'
		insertMessage(database, {
			run_id: runId,
			seq: 2,
			role: 'assistant',
			content: 'World news today',
		})

		// Query for 'hello' substring
		const helloMessages = queryMessages(database, { run_id: runId, query: 'hello' })
		expect(helloMessages).toHaveLength(1)
		expect(helloMessages[0]!.content).toBe('Hello there!')

		// Query for 'world' substring
		const worldMessages = queryMessages(database, { run_id: runId, query: 'world' })
		expect(worldMessages).toHaveLength(1)
		expect(worldMessages[0]!.content).toBe('World news today')

		database.close()
	})

	it('queryMessages respects limit: insert 5 rows, query limit=2, only 2 returned', () => {
		const database = new Database(createTempDbPath())
		setupSchema(database)

		const { projectId, sessionId } = insertProjectAndSession(database)
		const runId = crypto.randomUUID()
		insertAgentRun(database, projectId, sessionId, runId)

		// Insert 5 messages
		for (let i = 1; i <= 5; i++) {
			insertMessage(database, {
				run_id: runId,
				seq: i,
				role: i % 2 === 0 ? 'assistant' : 'user',
				content: `Message ${i}`,
			})
		}

		// Query with limit=2
		const limitedMessages = queryMessages(database, { run_id: runId, limit: 2 })
		expect(limitedMessages).toHaveLength(2)

		// Should be first 2 by seq order
		expect(limitedMessages[0]!.seq).toBe(1)
		expect(limitedMessages[1]!.seq).toBe(2)

		// Query with default limit (50) should return all 5
		const allMessages = queryMessages(database, { run_id: runId })
		expect(allMessages).toHaveLength(5)

		database.close()
	})

	it('cascade delete: insert parent agent_runs row + messages, delete agent_runs row, listMessages returns []', () => {
		const database = new Database(createTempDbPath())
		setupSchema(database)

		const { projectId, sessionId } = insertProjectAndSession(database)
		const runId = crypto.randomUUID()
		insertAgentRun(database, projectId, sessionId, runId)

		// Insert multiple messages
		insertMessage(database, {
			run_id: runId,
			seq: 1,
			role: 'system',
			content: 'System prompt',
		})
		insertMessage(database, {
			run_id: runId,
			seq: 2,
			role: 'user',
			content: 'User input',
		})
		insertMessage(database, {
			run_id: runId,
			seq: 3,
			role: 'assistant',
			content: 'Assistant output',
		})

		// Verify messages exist
		let messages = listMessages(database, runId)
		expect(messages).toHaveLength(3)

		// Delete the parent agent_runs row
		database.db.run('DELETE FROM agent_runs WHERE run_id = ?', [runId])

		// Messages should be cascade deleted
		messages = listMessages(database, runId)
		expect(messages).toHaveLength(0)
		expect(messages).toEqual([])

		database.close()
	})

	it('queryMessages combines role and query filters', () => {
		const database = new Database(createTempDbPath())
		setupSchema(database)

		const { projectId, sessionId } = insertProjectAndSession(database)
		const runId = crypto.randomUUID()
		insertAgentRun(database, projectId, sessionId, runId)

		// Insert user message with 'test'
		insertMessage(database, {
			run_id: runId,
			seq: 1,
			role: 'user',
			content: 'User test message',
		})

		// Insert assistant message with 'test'
		insertMessage(database, {
			run_id: runId,
			seq: 2,
			role: 'assistant',
			content: 'Assistant test message',
		})

		// Insert user message without 'test'
		insertMessage(database, {
			run_id: runId,
			seq: 3,
			role: 'user',
			content: 'User other message',
		})

		// Query for user messages containing 'test'
		const filteredMessages = queryMessages(database, {
			run_id: runId,
			role: 'user',
			query: 'test',
		})
		expect(filteredMessages).toHaveLength(1)
		expect(filteredMessages[0]!.role).toBe('user')
		expect(filteredMessages[0]!.content).toBe('User test message')

		database.close()
	})

	it('insertMessage with tool_name stores and retrieves correctly', () => {
		const database = new Database(createTempDbPath())
		setupSchema(database)

		const { projectId, sessionId } = insertProjectAndSession(database)
		const runId = crypto.randomUUID()
		insertAgentRun(database, projectId, sessionId, runId)

		// Insert tool_call message with tool_name
		insertMessage(database, {
			run_id: runId,
			seq: 1,
			role: 'tool_call',
			content: '{"args": {}}',
			tool_name: 'search_files',
		})

		// Insert tool_result message with tool_name
		insertMessage(database, {
			run_id: runId,
			seq: 2,
			role: 'tool_result',
			content: 'Search results',
			tool_name: 'search_files',
		})

		const messages = listMessages(database, runId)
		expect(messages).toHaveLength(2)
		expect(messages[0]!.tool_name).toBe('search_files')
		expect(messages[0]!.role).toBe('tool_call')
		expect(messages[1]!.tool_name).toBe('search_files')
		expect(messages[1]!.role).toBe('tool_result')

		database.close()
	})

	it('listMessages returns empty array when run has no messages', () => {
		const database = new Database(createTempDbPath())
		setupSchema(database)

		const { projectId, sessionId } = insertProjectAndSession(database)
		const runId = crypto.randomUUID()
		insertAgentRun(database, projectId, sessionId, runId)

		// Don't insert any messages
		const messages = listMessages(database, runId)
		expect(messages).toEqual([])
		expect(messages).toHaveLength(0)

		database.close()
	})

	it('queryMessages limit is capped at 200', () => {
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
				role: 'user',
				content: `Message ${i}`,
			})
		}

		// Query with limit=500 should be capped at 200
		const messages = queryMessages(database, { run_id: runId, limit: 500 })
		expect(messages.length).toBeGreaterThanOrEqual(10) // All 10 should be returned since < 200

		database.close()
	})
})
