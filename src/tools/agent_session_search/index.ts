import type { Database } from '../../db/database.js'
import { getRun } from '../../runs/dal.js'
import { queryMessages } from '../../runs/messages.js'
import type { RunContext } from '../../runs/types.js'
import type { ElefantError } from '../../types/errors.js'
import { err, ok, type Result } from '../../types/result.js'
import type { ToolDefinition } from '../../types/tools.js'

export interface AgentSessionSearchDeps {
	database: Database
	currentRun: RunContext
}

export interface AgentSessionSearchParams {
	run_id: string
	role?: 'system' | 'user' | 'assistant' | 'tool_call' | 'tool_result'
	query?: string
	limit?: number
}

export function createAgentSessionSearchTool(
	deps: AgentSessionSearchDeps,
): ToolDefinition<AgentSessionSearchParams, string> {
	return {
		name: 'agent_session_search',
		description: `Search the persisted message history of a completed child agent run.
Returns messages matching the optional role and content filters.
Only works for child runs that belong to the same session as the current run.
Use after task tool completes to inspect what the child agent said and did.`,
		deferred: true,
		parameters: {
			run_id: {
				type: 'string',
				required: true,
				description: 'The runId of the child run to search (returned by the task tool)',
			},
			role: {
				type: 'string',
				required: false,
				description: 'Filter by message role: system, user, assistant, tool_call, or tool_result',
			},
			query: {
				type: 'string',
				required: false,
				description: 'Case-insensitive substring to search for in message content',
			},
			limit: {
				type: 'number',
				required: false,
				default: 50,
				description: 'Maximum number of messages to return (default 50, max 200)',
			},
		},
		execute: async (params: AgentSessionSearchParams): Promise<Result<string, ElefantError>> => {
			const { database, currentRun } = deps

			// Validate run exists
			const runResult = getRun(database, params.run_id)
			if (!runResult.ok) {
				return err({
					code: 'FILE_NOT_FOUND',
					message: `Run ${params.run_id} not found`,
				})
			}

			const targetRun = runResult.data

			// Security: only allow searching runs in the same session
			if (targetRun.session_id !== currentRun.sessionId) {
				return err({
					code: 'PERMISSION_DENIED',
					message: `Cross-session search forbidden: run ${params.run_id} belongs to session ${targetRun.session_id}`,
				})
			}

			// Query messages with filters
			const messages = queryMessages(database, {
				run_id: params.run_id,
				role: params.role,
				query: params.query,
				limit: params.limit,
			})

			// Build response with content preview truncated to 200 chars
			const responseMessages = messages.map((m) => ({
				seq: m.seq,
				role: m.role,
				content_preview: m.content.slice(0, 200),
				tool_name: m.tool_name,
				created_at: m.created_at,
			}))

			return ok(
				JSON.stringify({
					messages: responseMessages,
					total: responseMessages.length,
					run_id: params.run_id,
				}),
			)
		},
	}
}
