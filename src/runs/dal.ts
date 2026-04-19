import type { Database } from '../db/database.ts'
import type { ElefantError } from '../types/errors.ts'
import { err, ok } from '../types/result.ts'
import type { Result } from '../types/result.ts'
import {
	AgentRunRowSchema,
	AgentRunStatusSchema,
	InsertAgentRunSchema,
	type AgentRunRow,
	type AgentRunStatus,
	type InsertAgentRun,
} from './types.ts'

export function createRun(db: Database, input: InsertAgentRun): Result<AgentRunRow, ElefantError> {
	const parsed = InsertAgentRunSchema.safeParse(input)
	if (!parsed.success) {
		return err({
			code: 'VALIDATION_ERROR',
			message: parsed.error.message,
			details: parsed.error,
		})
	}

	const data = parsed.data
	const now = new Date().toISOString()

	try {
		db.db.run(
			`INSERT INTO agent_runs (
				run_id,
				session_id,
				project_id,
				parent_run_id,
				agent_type,
				title,
				status,
				created_at,
				started_at,
				ended_at,
				context_mode,
				error_message
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				data.run_id,
				data.session_id,
				data.project_id,
				data.parent_run_id ?? null,
				data.agent_type,
				data.title,
				data.status,
				data.created_at ?? now,
				data.started_at ?? now,
				data.ended_at ?? null,
				data.context_mode,
				data.error_message ?? null,
			],
		)

		return getRun(db, data.run_id)
	} catch (error) {
		return err({
			code: 'TOOL_EXECUTION_FAILED',
			message: String(error),
			details: error,
		})
	}
}

export function getRun(db: Database, runId: string): Result<AgentRunRow, ElefantError> {
	try {
		const row = db.db.query('SELECT * FROM agent_runs WHERE run_id = ?').get(runId)
		if (!row) {
			return err({
				code: 'FILE_NOT_FOUND',
				message: `Run ${runId} not found`,
			})
		}

		return ok(AgentRunRowSchema.parse(row))
	} catch (error) {
		return err({
			code: 'TOOL_EXECUTION_FAILED',
			message: String(error),
			details: error,
		})
	}
}

export function listRunsBySession(
	db: Database,
	sessionId: string,
	limit = 50,
	offset = 0,
): Result<AgentRunRow[], ElefantError> {
	try {
		const rows = db.db
			.query(
				'SELECT * FROM agent_runs WHERE session_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
			)
			.all(sessionId, limit, offset)
		return ok(rows.map((row) => AgentRunRowSchema.parse(row)))
	} catch (error) {
		return err({
			code: 'TOOL_EXECUTION_FAILED',
			message: String(error),
			details: error,
		})
	}
}

export function updateRunStatus(
	db: Database,
	runId: string,
	status: AgentRunStatus,
	errorMessage: string | null = null,
): Result<AgentRunRow, ElefantError> {
	const parsedStatus = AgentRunStatusSchema.safeParse(status)
	if (!parsedStatus.success) {
		return err({
			code: 'VALIDATION_ERROR',
			message: parsedStatus.error.message,
			details: parsedStatus.error,
		})
	}

	try {
		db.db.run(
			`UPDATE agent_runs
			 SET status = ?,
			     error_message = ?,
			     started_at = CASE
			       WHEN ? = 'running' AND started_at IS NULL THEN datetime('now')
			       ELSE started_at
			     END
			 WHERE run_id = ?`,
			[status, errorMessage, status, runId],
		)

		return getRun(db, runId)
	} catch (error) {
		return err({
			code: 'TOOL_EXECUTION_FAILED',
			message: String(error),
			details: error,
		})
	}
}

export function markRunEnded(
	db: Database,
	runId: string,
	status: Extract<AgentRunStatus, 'done' | 'error' | 'cancelled'>,
	errorMessage: string | null = null,
): Result<AgentRunRow, ElefantError> {
	const parsedStatus = AgentRunStatusSchema.safeParse(status)
	if (!parsedStatus.success) {
		return err({
			code: 'VALIDATION_ERROR',
			message: parsedStatus.error.message,
			details: parsedStatus.error,
		})
	}

	try {
		db.db.run(
			'UPDATE agent_runs SET status = ?, ended_at = ?, error_message = ? WHERE run_id = ?',
			[status, new Date().toISOString(), errorMessage, runId],
		)

		return getRun(db, runId)
	} catch (error) {
		return err({
			code: 'TOOL_EXECUTION_FAILED',
			message: String(error),
			details: error,
		})
	}
}
