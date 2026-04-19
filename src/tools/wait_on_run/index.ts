import type { Database } from '../../db/database.js'
import { getRun } from '../../runs/dal.js'
import type { RunContext } from '../../runs/types.js'
import type { ElefantError } from '../../types/errors.js'
import { err, ok, type Result } from '../../types/result.js'
import type { ToolDefinition } from '../../types/tools.js'

export interface WaitOnRunDeps {
	database: Database
	currentRun: RunContext
}

export interface WaitOnRunParams {
	run_id: string
	timeout_ms?: number
}

export interface WaitOnRunResult {
	runId: string
	status: 'done' | 'error' | 'cancelled' | 'timeout'
	errorMessage: string | null
	durationMs: number
}

function isTerminal(status: string): status is Exclude<WaitOnRunResult['status'], 'timeout'> {
	return status === 'done' || status === 'error' || status === 'cancelled'
}

export function createWaitOnRunTool(deps: WaitOnRunDeps): ToolDefinition<WaitOnRunParams, string> {
	return {
		name: 'wait_on_run',
		description: `Block until a spawned child run reaches a terminal state (done, error, or cancelled).
Returns { runId, status, errorMessage, durationMs }.
status "timeout" means the run did not complete within timeout_ms.
Only works for runs in the same session as the current run.
Use after task tool to synchronize on child completion.`,
		parameters: {
			run_id: {
				type: 'string',
				required: true,
				description: 'The runId returned by the task tool',
			},
			timeout_ms: {
				type: 'number',
				required: false,
				default: 60000,
				description: 'Max milliseconds to wait. Default 60000ms (60s), max 300000ms (5min).',
			},
		},
		execute: async (params: WaitOnRunParams): Promise<Result<string, ElefantError>> => {
			const { database, currentRun } = deps
			const POLL_INTERVAL_MS = 500
			const MAX_TIMEOUT_MS = 300_000
			const effectiveTimeout = Math.min(params.timeout_ms ?? 60_000, MAX_TIMEOUT_MS)
			const deadline = Date.now() + effectiveTimeout
			const start = Date.now()

			const firstFetch = getRun(database, params.run_id)
			if (!firstFetch.ok) {
				return err({
					code: 'NOT_FOUND',
					message: `Run ${params.run_id} not found`,
				})
			}

			if (firstFetch.data.session_id !== currentRun.sessionId) {
				return err({
					code: 'VALIDATION_ERROR',
					message: `Cross-session wait forbidden: run ${params.run_id} belongs to session ${firstFetch.data.session_id}, current run is in session ${currentRun.sessionId}`,
				})
			}

			if (isTerminal(firstFetch.data.status)) {
				const row = firstFetch.data
				const result: WaitOnRunResult = {
					runId: row.run_id,
					status: row.status,
					errorMessage: row.error_message ?? null,
					durationMs: Date.now() - start,
				}
				return ok(JSON.stringify(result))
			}

			while (Date.now() < deadline) {
				if (currentRun.signal.aborted) {
					return err({
						code: 'ABORTED',
						message: `Parent run aborted while waiting on ${params.run_id}`,
					})
				}

				await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))

				if (Date.now() >= deadline) {
					break
				}

				const fetchResult = getRun(database, params.run_id)
				if (!fetchResult.ok) {
					const result: WaitOnRunResult = {
						runId: params.run_id,
						status: 'done',
						errorMessage: null,
						durationMs: Date.now() - start,
					}
					return ok(JSON.stringify(result))
				}

				if (isTerminal(fetchResult.data.status)) {
					const row = fetchResult.data
					const result: WaitOnRunResult = {
						runId: row.run_id,
						status: row.status,
						errorMessage: row.error_message ?? null,
						durationMs: Date.now() - start,
					}
					return ok(JSON.stringify(result))
				}
			}

			const result: WaitOnRunResult = {
				runId: params.run_id,
				status: 'timeout',
				errorMessage: null,
				durationMs: Date.now() - start,
			}
			return ok(JSON.stringify(result))
		},
	}
}
