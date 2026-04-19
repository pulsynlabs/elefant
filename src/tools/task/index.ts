import type { ConfigManager } from '../../config/loader.js'
import type { Database } from '../../db/database.js'
import type { HookRegistry } from '../../hooks/index.js'
import type { ProviderRouter } from '../../providers/router.js'
import { buildInitialMessages } from '../../runs/context.js'
import { createRun, markRunEnded } from '../../runs/dal.js'
import { publishRunEvent } from '../../runs/events.js'
import type { RunRegistry } from '../../runs/registry.js'
import type { RunContext } from '../../runs/types.js'
import { runAgentLoop } from '../../server/agent-loop.js'
import { createQuestionEmitter } from '../question/emitter.js'
import type { ToolRegistry } from '../registry.js'
import type { ElefantError } from '../../types/errors.js'
import type { Message } from '../../types/providers.js'
import { err, ok, type Result } from '../../types/result.js'
import type { ToolDefinition } from '../../types/tools.js'
import type { SseManager } from '../../transport/sse-manager.js'

export interface TaskToolDeps {
	database: Database
	runRegistry: RunRegistry
	sseManager: SseManager
	providerRouter: ProviderRouter
	hookRegistry: HookRegistry
	configManager: ConfigManager
	toolRegistry: ToolRegistry
	currentRun: RunContext
}

export interface TaskParams {
	description: string
	prompt: string
	agent_type: string
	context_mode?: 'none' | 'inherit_session' | 'snapshot'
}

export const DEFAULT_MAX_CHILDREN = 4

function readOptionalNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function createTaskTool(deps: TaskToolDeps): ToolDefinition<TaskParams, string> {
	return {
		name: 'task',
		description: `Spawn a child agent run asynchronously and return immediately.
Returns { runId, status: "spawned", agentType, parentRunId }.
Use wait_on_run to block until the child completes.
The child runs concurrently in the background.
parentRunId is always set to the current run's ID — you cannot override it.
Depth and concurrency limits are enforced by agent configuration.`,
		parameters: {
			description: {
				type: 'string',
				required: true,
				description: 'Short label for the child run (shown in UI and logs)',
			},
			prompt: {
				type: 'string',
				required: true,
				description: 'The full task prompt for the child agent',
			},
			agent_type: {
				type: 'string',
				required: true,
				description: 'Agent type identifier (must match a profile in agent config)',
			},
			context_mode: {
				type: 'string',
				required: false,
				default: 'none',
				description:
					'Context inheritance: "none" (prompt only), "snapshot" (frozen session history), "inherit_session" (live session history)',
			},
		},
		execute: async (params: TaskParams): Promise<Result<string, ElefantError>> => {
			const {
				database,
				runRegistry,
				sseManager,
				providerRouter,
				hookRegistry,
				configManager,
				toolRegistry,
				currentRun,
			} = deps

			const configResult = await configManager.resolve(params.agent_type, currentRun.projectId)
			const resolvedConfig = configResult.ok ? configResult.data : null
			const resolvedConfigRecord =
				resolvedConfig && typeof resolvedConfig === 'object'
					? (resolvedConfig as unknown as Record<string, unknown>)
					: null

			// TODO(task-9.4): remove dynamic field access once schema adds explicit fields.
			const maxDepth = readOptionalNumber(resolvedConfigRecord?.maxTaskDepth)
			if (maxDepth !== undefined && (currentRun.depth ?? 0) >= maxDepth) {
				return err({
					code: 'VALIDATION_ERROR',
					message: `Agent depth limit reached: current depth ${currentRun.depth ?? 0} >= maxTaskDepth ${maxDepth} for agent type "${params.agent_type}"`,
				})
			}

			const maxChildren = readOptionalNumber(resolvedConfigRecord?.maxChildren) ?? DEFAULT_MAX_CHILDREN
			const currentChildren = runRegistry.getChildRunIds(currentRun.runId)
			if (currentChildren.length >= maxChildren) {
				return err({
					code: 'VALIDATION_ERROR',
					message: `Concurrent child limit reached: ${currentChildren.length} active children >= maxChildren ${maxChildren} for run "${currentRun.runId}"`,
				})
			}

			const childRunId = crypto.randomUUID()
			const childController = new AbortController()
			const childCtx: RunContext = {
				runId: childRunId,
				parentRunId: currentRun.runId,
				agentType: params.agent_type,
				title: params.description,
				sessionId: currentRun.sessionId,
				projectId: currentRun.projectId,
				signal: childController.signal,
				depth: (currentRun.depth ?? 0) + 1,
			}

			const contextMode = params.context_mode ?? 'none'
			const delegationSystemContent = [
				'<delegation_context>',
				`  parent_run_id: ${currentRun.runId}`,
				`  root_session_id: ${currentRun.sessionId}`,
				`  project_id: ${currentRun.projectId}`,
				`  agent_type: ${params.agent_type}`,
				`  description: ${params.description}`,
				`  context_mode: ${contextMode}`,
				`  depth: ${childCtx.depth}`,
				'  You are a delegated child agent run.',
				'  Focus only on the delegated task.',
				'  Return a concise, actionable result for the parent run.',
				'</delegation_context>',
			].join('\n')

			const delegationSystemMsg = {
				role: 'system' as const,
				content: delegationSystemContent,
			}

			let contextMessages: Message[] = []
			if (contextMode === 'inherit_session' || contextMode === 'snapshot') {
				const source = buildInitialMessages({
					contextMode,
					sessionId: currentRun.sessionId,
					db: {
						getSessionMessages: (_sessionId: string): Message[] => {
							const withReader = database as unknown as {
								getSessionMessages?: (sessionId: string) => Message[]
							}
							return withReader.getSessionMessages?.(_sessionId) ?? []
						},
					},
				})
				contextMessages = source.getMessages()
			}

			const userPromptMsg = {
				role: 'user' as const,
				content: params.prompt,
			}
			const initialMessages: Message[] = [delegationSystemMsg, ...contextMessages, userPromptMsg]

			// Only set parent_run_id when the parent is itself a persisted agent
			// run (i.e. spawned via the agent-runs REST endpoint and present in
			// the agent_runs table). Chat sessions use a synthetic runId of the
			// form "chat:<sessionId>:<uuid>" that is never inserted into the DB,
			// so passing it as parent_run_id would violate the FK constraint.
			const persistedParentRunId = currentRun.runId.startsWith('chat:')
				? null
				: currentRun.runId

			// Persist to DB when we have real FK-valid session/project IDs.
			// Chat sessions use synthetic IDs (projectId='chat') that aren't in
			// the DB — in that case we skip persistence and run in-memory only.
			// The child agent still executes; it just won't appear in the runs list.
			const hasPersistableContext =
				currentRun.projectId !== 'chat' &&
				currentRun.sessionId !== 'chat' &&
				!currentRun.projectId.startsWith('chat:') &&
				!currentRun.sessionId.startsWith('chat:')

			if (hasPersistableContext) {
				const createResult = createRun(database, {
					run_id: childRunId,
					session_id: currentRun.sessionId,
					project_id: currentRun.projectId,
					parent_run_id: persistedParentRunId,
					agent_type: params.agent_type,
					title: params.description,
					status: 'running',
					context_mode: contextMode,
					started_at: new Date().toISOString(),
				})
				if (!createResult.ok) {
					// Log but don't abort — child can still run without a DB row
					console.error(`[task] createRun failed (non-fatal): ${createResult.error.message}`)
				}
			}

			runRegistry.registerRun(childRunId, {
				controller: childController,
				parentRunId: currentRun.runId,
				startedAt: new Date(),
				questionEmitter: createQuestionEmitter(childRunId, () => undefined),
				agentType: params.agent_type,
				title: params.description,
			})

			runRegistry.registerChildren(currentRun.runId, childRunId)

			publishRunEvent(childCtx, sseManager, 'agent_run.spawned', {
				contextMode,
				parentRunId: currentRun.runId,
			})

			void (async () => {
				let endStatus: 'done' | 'error' = 'done'
				let errorMessage: string | undefined

				try {
					for await (const _ of runAgentLoop(providerRouter, toolRegistry, {
						messages: initialMessages,
						tools: toolRegistry.getAll(),
						hookRegistry,
						runContext: childCtx,
						sseManager,
					})) {
						// Intentionally drain events; runAgentLoop publishes via SSE internally.
					}
					publishRunEvent(childCtx, sseManager, 'agent_run.done', { runId: childRunId })
				} catch (e) {
					endStatus = 'error'
					errorMessage = e instanceof Error ? e.message : String(e)
					publishRunEvent(childCtx, sseManager, 'agent_run.error', { runId: childRunId, message: errorMessage })
				} finally {
					markRunEnded(database, childRunId, endStatus, errorMessage)
					runRegistry.forgetRun(childRunId)
				}
			})()

			return ok(
				JSON.stringify({
					runId: childRunId,
					status: 'spawned',
					agentType: params.agent_type,
					parentRunId: currentRun.runId,
				}),
			)
		},
	}
}
