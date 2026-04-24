import type { Database } from '../db/database.js'
import type { ElefantError } from '../types/errors.js'

/**
 * Agent run message record from the database.
 */
export interface AgentRunMessage {
	id: number
	run_id: string
	seq: number
	role: 'system' | 'user' | 'assistant' | 'tool_call' | 'tool_result'
	content: string
	tool_name: string | null
	created_at: string
}

/**
 * Parameters for inserting a new message.
 */
export interface InsertMessageParams {
	run_id: string
	seq: number
	role: AgentRunMessage['role']
	content: string
	tool_name?: string | null
}

/**
 * Parameters for querying messages with optional filters.
 */
export interface QueryMessagesParams {
	run_id: string
	role?: AgentRunMessage['role']
	query?: string // case-insensitive substring match on content
	limit?: number // default 50, max 200
}

/**
 * Insert a single message into the agent_run_messages table.
 * Synchronous operation - errors are thrown to be caught by caller.
 */
export function insertMessage(db: Database, params: InsertMessageParams): void {
	const toolName = params.tool_name ?? null

	db.db.run(
		`INSERT INTO agent_run_messages (
			run_id,
			seq,
			role,
			content,
			tool_name,
			created_at
		) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
		[params.run_id, params.seq, params.role, params.content, toolName],
	)
}

/**
 * List all messages for a given run, ordered by seq ASC.
 * Returns raw array - empty result is valid (no messages yet).
 */
export function listMessages(db: Database, runId: string): AgentRunMessage[] {
	const rows = db.db
		.query(
			`SELECT id, run_id, seq, role, content, tool_name, created_at
			 FROM agent_run_messages
			 WHERE run_id = ?
			 ORDER BY seq ASC`,
		)
		.all(runId) as Array<{
			id: number
			run_id: string
			seq: number
			role: string
			content: string
			tool_name: string | null
			created_at: string
		}>

	return rows.map((row) => ({
		id: row.id,
		run_id: row.run_id,
		seq: row.seq,
		role: row.role as AgentRunMessage['role'],
		content: row.content,
		tool_name: row.tool_name,
		created_at: row.created_at,
	}))
}

/**
 * Query messages with optional filters.
 * - role filter: exact match
 * - query filter: case-insensitive substring match on content (LIKE '%query%')
 * - limit: capped at 200, default 50
 */
export function queryMessages(
	db: Database,
	params: QueryMessagesParams,
): AgentRunMessage[] {
	const limit = Math.min(params.limit ?? 50, 200)

	// Build query dynamically based on filters
	const conditions: string[] = ['run_id = ?']
	const queryParams: (string | number)[] = [params.run_id]

	if (params.role) {
		conditions.push('role = ?')
		queryParams.push(params.role)
	}

	if (params.query) {
		conditions.push('content LIKE ?')
		queryParams.push(`%${params.query}%`)
	}

	// Add limit as the last parameter
	queryParams.push(limit)

	const whereClause = conditions.join(' AND ')

	const rows = db.db
		.query(
			`SELECT id, run_id, seq, role, content, tool_name, created_at
			 FROM agent_run_messages
			 WHERE ${whereClause}
			 ORDER BY seq ASC
			 LIMIT ?`,
		)
		.all(...queryParams) as Array<{
			id: number
			run_id: string
			seq: number
			role: string
			content: string
			tool_name: string | null
			created_at: string
		}>

	return rows.map((row) => ({
		id: row.id,
		run_id: row.run_id,
		seq: row.seq,
		role: row.role as AgentRunMessage['role'],
		content: row.content,
		tool_name: row.tool_name,
		created_at: row.created_at,
	}))
}
