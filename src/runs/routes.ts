import type { Elysia } from 'elysia'
import { z } from 'zod'

import type { ConfigManager } from '../config/loader.js'
import type { Database } from '../db/database.ts'
import { getSessionById } from '../db/repo/sessions.ts'
import type { HookRegistry } from '../hooks/index.ts'
import type { ProviderRouter } from '../providers/router.ts'
import { runAgentLoop } from '../server/agent-loop.ts'
import { createToolRegistryForRun, type ToolRegistry } from '../tools/registry.ts'
import type { SseManager } from '../transport/sse-manager.ts'
import { createRun, getRun, listChildRunsByParent, listRunsBySession, markRunEnded } from './dal.ts'
import { buildInitialMessages } from './context.ts'
import { publishRunEvent, publishStatusChange } from './events.ts'
import type { RunRegistry } from './registry.ts'
import type { RunContext } from './types.ts'

const SpawnRunBodySchema = z.object({
	agentType: z.string().min(1),
	title: z.string().min(1),
	contextMode: z.enum(['none', 'inherit_session', 'snapshot']).default('inherit_session'),
	parentRunId: z.string().min(1).optional(),
	prompt: z.string().min(1),
})

const ListRunsQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(200).default(50),
	offset: z.coerce.number().int().min(0).default(0),
})

const ChildrenPathParamsSchema = z.object({
	id: z.string().min(1),
	sessionId: z.string().min(1),
	runId: z.string().min(1),
})

export function mountAgentRunRoutes(
	app: Elysia,
	deps: {
		db: Database
		providerRouter: ProviderRouter
		toolRegistry: ToolRegistry
		hookRegistry: HookRegistry
		runRegistry: RunRegistry
		sseManager?: SseManager
		configManager: ConfigManager
	},
): Elysia {
	app.post('/api/projects/:id/sessions/:sessionId/agent-runs', ({ params, body, set }) => {
		const parsedBody = SpawnRunBodySchema.safeParse(body)
		if (!parsedBody.success) {
			set.status = 400
			return {
				ok: false,
				error: {
					code: 'VALIDATION_ERROR',
					message: parsedBody.error.message,
				},
			}
		}

		const session = getSessionById(deps.db, params.sessionId)
		if (!session.ok || session.data.project_id !== params.id) {
			set.status = 404
			return {
				ok: false,
				error: {
					code: 'FILE_NOT_FOUND',
					message: 'Session not found for project',
				},
			}
		}

		const runId = crypto.randomUUID()
		const createResult = createRun(deps.db, {
			run_id: runId,
			session_id: params.sessionId,
			project_id: params.id,
			parent_run_id: parsedBody.data.parentRunId ?? null,
			agent_type: parsedBody.data.agentType,
			title: parsedBody.data.title,
			status: 'running',
			context_mode: parsedBody.data.contextMode,
		})

		if (!createResult.ok) {
			set.status = 500
			return {
				ok: false,
				error: {
					code: createResult.error.code,
					message: createResult.error.message,
				},
			}
		}

		const controller = new AbortController()
		const runContext: RunContext = {
			runId,
			parentRunId: parsedBody.data.parentRunId,
			depth: 0,
			agentType: parsedBody.data.agentType,
			title: parsedBody.data.title,
			sessionId: params.sessionId,
			projectId: params.id,
			signal: controller.signal,
		}

		deps.runRegistry.registerRun(runId, {
			controller,
			startedAt: new Date(),
			questionEmitter: () => undefined,
			parentRunId: parsedBody.data.parentRunId,
			agentType: parsedBody.data.agentType,
			title: parsedBody.data.title,
		})

		if (parsedBody.data.parentRunId) {
			deps.runRegistry.registerChildren(parsedBody.data.parentRunId, runId)
		}

		if (deps.sseManager) {
			publishRunEvent(runContext, deps.sseManager, 'agent_run.spawned', {
				runId,
				parentRunId: parsedBody.data.parentRunId ?? null,
				agentType: parsedBody.data.agentType,
				title: parsedBody.data.title,
			})
		}

		const initialMessageSource = buildInitialMessages({
			contextMode: parsedBody.data.contextMode,
			sessionId: params.sessionId,
			db: {
				getSessionMessages: () => [],
			},
		})

		const messages = [
			...initialMessageSource.getMessages(),
			{ role: 'user' as const, content: parsedBody.data.prompt },
		]

		// Create per-run tool registry with task and wait_on_run tools
		const runToolRegistry = createToolRegistryForRun({
			hookRegistry: deps.hookRegistry,
			database: deps.db,
			runRegistry: deps.runRegistry,
			sseManager: deps.sseManager,
			providerRouter: deps.providerRouter,
			configManager: deps.configManager,
			currentRun: runContext,
		})

		void (async () => {
			try {
				for await (const _event of runAgentLoop(deps.providerRouter, runToolRegistry, {
					messages,
					tools: runToolRegistry.getAll(),
					hookRegistry: deps.hookRegistry,
					runContext,
					sseManager: deps.sseManager,
				})) {
					// intentionally drained to execute background loop
				}

				if (controller.signal.aborted) {
					markRunEnded(deps.db, runId, 'cancelled')
				} else {
					markRunEnded(deps.db, runId, 'done')
				}
			} catch (error) {
				markRunEnded(deps.db, runId, 'error', String(error))
				if (deps.sseManager) {
					publishRunEvent(runContext, deps.sseManager, 'agent_run.error', {
						message: String(error),
					})
				}
			} finally {
				deps.runRegistry.forgetRun(runId)
			}
		})()

		return {
			ok: true,
			data: {
				runId,
			},
		}
	})

	app.get('/api/sessions/:sessionId/agent-runs', ({ params, query, set }) => {
		const parsedQuery = ListRunsQuerySchema.safeParse(query)
		if (!parsedQuery.success) {
			set.status = 400
			return {
				ok: false,
				error: {
					code: 'VALIDATION_ERROR',
					message: parsedQuery.error.message,
				},
			}
		}

		const listResult = listRunsBySession(
			deps.db,
			params.sessionId,
			parsedQuery.data.limit,
			parsedQuery.data.offset,
		)

		if (!listResult.ok) {
			set.status = 500
			return {
				ok: false,
				error: {
					code: listResult.error.code,
					message: listResult.error.message,
				},
			}
		}

		return {
			ok: true,
			data: listResult.data,
		}
	})

	app.get('/api/projects/:id/sessions/:sessionId/runs/:runId/children', ({ params, query, set }) => {
		const parsedParams = ChildrenPathParamsSchema.safeParse(params)
		if (!parsedParams.success) {
			set.status = 400
			return {
				ok: false,
				error: {
					code: 'VALIDATION_ERROR',
					message: parsedParams.error.message,
				},
			}
		}

		const parsedQuery = ListRunsQuerySchema.safeParse(query)
		if (!parsedQuery.success) {
			set.status = 400
			return {
				ok: false,
				error: {
					code: 'VALIDATION_ERROR',
					message: parsedQuery.error.message,
				},
			}
		}

		const { id, sessionId, runId } = parsedParams.data
		const session = getSessionById(deps.db, sessionId)
		if (!session.ok || session.data.project_id !== id) {
			set.status = 404
			return {
				ok: false,
				error: {
					code: 'FILE_NOT_FOUND',
					message: 'Session not found for project',
				},
			}
		}

		const run = getRun(deps.db, runId)
		if (!run.ok || run.data.session_id !== sessionId) {
			set.status = 404
			return {
				ok: false,
				error: {
					code: 'FILE_NOT_FOUND',
					message: 'Run not found for session',
				},
			}
		}

		const listResult = listChildRunsByParent(deps.db, runId, sessionId)
		if (!listResult.ok) {
			set.status = 500
			return {
				ok: false,
				error: {
					code: listResult.error.code,
					message: listResult.error.message,
				},
			}
		}

		const { limit, offset } = parsedQuery.data
		const paginatedChildren = listResult.data.slice(offset, offset + limit)

		return {
			ok: true,
			data: paginatedChildren,
		}
	})

	app.get('/api/agent-runs/:runId', ({ params, set }) => {
		const run = getRun(deps.db, params.runId)
		if (!run.ok) {
			set.status = 404
			return {
				ok: false,
				error: {
					code: run.error.code,
					message: run.error.message,
				},
			}
		}

		const liveEntry = deps.runRegistry.getRun(params.runId)
		return {
			ok: true,
			data: {
				run: run.data,
				live: liveEntry
					? {
						startedAt: liveEntry.startedAt.toISOString(),
						agentType: liveEntry.agentType,
						title: liveEntry.title,
						aborted: liveEntry.controller.signal.aborted,
					}
					: null,
			},
		}
	})

	app.post('/api/agent-runs/:runId/cancel', ({ params, set }) => {
		const run = getRun(deps.db, params.runId)
		if (!run.ok) {
			set.status = 404
			return {
				ok: false,
				error: {
					code: run.error.code,
					message: run.error.message,
				},
			}
		}

		const aborted = deps.runRegistry.abortRun(params.runId)
		if (!aborted) {
			set.status = 409
			return {
				ok: false,
				error: {
					code: 'TOOL_EXECUTION_FAILED',
					message: 'Run is not active',
				},
			}
		}

		const cancelled = markRunEnded(deps.db, params.runId, 'cancelled')
		if (!cancelled.ok) {
			set.status = 500
			return {
				ok: false,
				error: {
					code: cancelled.error.code,
					message: cancelled.error.message,
				},
			}
		}

		if (deps.sseManager) {
			const runContextForCancel = {
				runId: cancelled.data.run_id,
				parentRunId: cancelled.data.parent_run_id ?? undefined,
				agentType: cancelled.data.agent_type,
				title: cancelled.data.title,
				sessionId: cancelled.data.session_id,
				projectId: cancelled.data.project_id,
				signal: new AbortController().signal,
				depth: 0,
			}

			publishRunEvent(
				runContextForCancel,
				deps.sseManager,
				'agent_run.cancelled',
				{ reason: 'cancel endpoint called' },
			)

			// Emit status change: running -> cancelled
			publishStatusChange(deps.sseManager, {
				runId: cancelled.data.run_id,
				sessionId: cancelled.data.session_id,
				projectId: cancelled.data.project_id,
				parentRunId: cancelled.data.parent_run_id ?? undefined,
				agentType: cancelled.data.agent_type,
				title: cancelled.data.title,
				previousStatus: 'running',
				nextStatus: 'cancelled',
				reason: 'cancel endpoint called',
			})
		}

		return {
			ok: true,
			data: {
				runId: params.runId,
				status: 'cancelled',
			},
		}
	})

	return app
}
