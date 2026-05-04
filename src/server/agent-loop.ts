import { emit, type HookRegistry } from '../hooks/index.ts'
import type { CompactionManager } from '../compaction/manager.ts'
import {
	createMcpToolDefinitions,
	isAlwaysLoadTool,
	isMcpToolDefinition,
} from '../mcp/adapter.ts'
import { shouldUseSelectiveLoading } from '../mcp/budget.ts'
import { buildMcpManifest } from '../mcp/manifest.ts'
import { createMcpSearchToolsTool } from '../mcp/meta-tools.ts'
import type { MCPManager } from '../mcp/manager.ts'
import type { ToolWithMeta } from '../mcp/types.ts'
import type { PermissionGate } from '../permissions/gate.ts'
import type { ProviderRouter } from '../providers/router.ts'
import type { StreamEvent, UsageEvent } from '../providers/types.ts'
import { clearRunEventSequence, publishRunEvent, publishStatusChange } from '../runs/events.ts'
import type { RunContext } from '../runs/types.ts'
import { buildSystemPrompt, type WorkflowPromptState } from '../compaction/system-prompt-builder.ts'
import { createQuestionEmitter, type QuestionEmitter } from '../tools/question/emitter.ts'
import type { SliderEmitter } from '../tools/interactive/types.ts'
import type { MetadataEmitter } from '../tools/task/metadata-emitter.ts'
import type { ElefantError } from '../types/errors.ts'
import { type Message } from '../types/providers.ts'
import type { Result } from '../types/result.ts'
import type { ToolCall, ToolDefinition, ToolResult } from '../types/tools.ts'
import type { SseManager } from '../transport/sse-manager.ts'
import { fileChangeTracker, normalizePath, type FileChange } from './file-changes.ts'
import { estimateMessageTokens } from '../utils/tokens.ts'
import commandsRegistry from '../commands/workflow/COMMANDS_REGISTRY.json'
import { parseSlashCommand } from './slash-commands.ts'
import { filterToolsForSessionOverlay, mcpSessionOverlay } from './mcp-session-overlay.ts'
import { sessionTodoTracker, type TodoItem, type TodoStatus } from './session-todos.ts'
import { tokenCounter } from './token-counter.ts'

export interface ToolExecutor {
	execute(name: string, args: unknown): Promise<Result<string, ElefantError>>
}

export interface AgentLoopOptions {
	messages: Message[]
	tools: ToolDefinition[]
	state?: unknown
	provider?: string
	maxIterations?: number
	contextWindowTokens?: number
	maxTokens?: number
	temperature?: number
	topP?: number
	timeoutMs?: number
	hookRegistry: HookRegistry
	permissions?: PermissionGate
	compaction?: CompactionManager
	runContext: RunContext
	questionEmitter?: QuestionEmitter
	sliderEmitter?: SliderEmitter
	metadataEmitter?: MetadataEmitter
	sseManager?: SseManager
	projectRoot?: string
	commandsDir?: string
	mcpManager?: MCPManager
	mcpTokenBudgetPercent?: number
}

interface EffectiveMcpTools {
	tools: ToolDefinition[]
	manifest: string
	selective: boolean
}

function createEffectiveToolSet(tools: ToolDefinition[], runContext: RunContext): ToolDefinition[] {
	return tools.filter((tool) => {
		if (tool.alwaysLoad === true) {
			return true
		}

		if (tool.deferred !== true) {
			return true
		}

		return runContext.discoveredTools.has(tool.name)
	})
}

function createToolResult(toolCallId: string, content: string, isError: boolean): ToolResult {
	return {
		toolCallId,
		content,
		isError,
	}
}

function cloneMessages(messages: Message[]): Message[] {
	return messages.map((message) => ({
		...message,
		toolCalls: message.toolCalls ? [...message.toolCalls] : undefined,
	}))
}

function appendManifestToMessages(messages: Message[], manifest: string): Message[] {
	if (manifest.length === 0) {
		return messages
	}

	const cloned = cloneMessages(messages)
	const firstSystemIndex = cloned.findIndex((message) => message.role === 'system')
	if (firstSystemIndex >= 0) {
		const firstSystem = cloned[firstSystemIndex]
		cloned[firstSystemIndex] = {
			...firstSystem,
			content: `${firstSystem.content}\n\n${manifest}`,
		}
		return cloned
	}

	return [{ role: 'system', content: manifest }, ...cloned]
}

function insertSystemMessagesAfterLeadingSystem(messages: Message[], systemMessages: Message[]): Message[] {
	if (systemMessages.length === 0) {
		return messages
	}

	const cloned = cloneMessages(messages)
	let insertAt = 0
	while (insertAt < cloned.length && cloned[insertAt]?.role === 'system') {
		insertAt += 1
	}

	return [
		...cloned.slice(0, insertAt),
		...systemMessages,
		...cloned.slice(insertAt),
	]
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readStringField(value: unknown, field: string): string | undefined {
	if (!isRecord(value)) {
		return undefined
	}

	const candidate = value[field]
	return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined
}

function readNumberField(value: unknown, field: string): number | undefined {
	if (!isRecord(value)) {
		return undefined
	}

	const candidate = value[field]
	return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined
}

const VALID_TODO_STATUSES = new Set<string>(['pending', 'in_progress', 'completed', 'cancelled'])
const VALID_TODO_PRIORITIES = new Set<string>(['high', 'medium', 'low'])

function isValidTodoStatus(value: string): value is TodoStatus {
	return VALID_TODO_STATUSES.has(value)
}

function isValidTodoPriority(value: string): boolean {
	return VALID_TODO_PRIORITIES.has(value)
}

function inferSessionMode(state: unknown): 'spec' | 'quick' {
	const directMode = readStringField(state, 'mode')
	if (directMode === 'spec' || directMode === 'quick') {
		return directMode
	}

	const session = isRecord(state) ? state.session : undefined
	const sessionMode = readStringField(session, 'mode')
	if (sessionMode === 'spec' || sessionMode === 'quick') {
		return sessionMode
	}

	return readWorkflowState(state) ? 'spec' : 'quick'
}

function readWorkflowState(state: unknown): WorkflowPromptState | undefined {
	const workflow = isRecord(state) && isRecord(state.workflow) ? state.workflow : state
	const phase = readStringField(workflow, 'phase')
	if (!phase) {
		return undefined
	}

	return {
		phase,
		currentWave: readNumberField(workflow, 'currentWave'),
		totalWaves: readNumberField(workflow, 'totalWaves'),
	}
}

const systemPromptCommands = commandsRegistry.map((command) => ({
	trigger: command.trigger,
	description: command.description,
}))

function buildMcpManifestServers(manager: MCPManager, tools: ToolWithMeta[]): Array<{ name: string; tools: ToolWithMeta['tool'][]; alwaysLoad?: string[] }> {
	const grouped = new Map<string, { name: string; tools: ToolWithMeta['tool'][]; alwaysLoad: Set<string> }>()

	for (const entry of tools) {
		const server = grouped.get(entry.serverId) ?? {
			name: entry.serverName,
			tools: [],
			alwaysLoad: new Set<string>([
				...manager.getPinnedTools(entry.serverId),
				...manager.getAlwaysLoadTools(entry.serverId),
			]),
		}
		server.tools.push(entry.tool)
		if (isAlwaysLoadTool(entry.tool)) {
			server.alwaysLoad.add(entry.tool.name)
		}
		grouped.set(entry.serverId, server)
	}

	return Array.from(grouped.values()).map((server) => ({
		name: server.name,
		tools: server.tools,
		alwaysLoad: Array.from(server.alwaysLoad),
	}))
}

function createEffectiveMcpTools(options: AgentLoopOptions): EffectiveMcpTools {
	const baseTools = options.tools.filter((tool) => !isMcpToolDefinition(tool) && tool.name !== 'mcp_search_tools')
	if (!options.mcpManager) {
		return { tools: options.tools, manifest: '', selective: false }
	}

	const mcpToolsWithMeta = options.mcpManager.listAllTools()
	const sessionScopedMcpTools = filterToolsForSessionOverlay(
		mcpToolsWithMeta,
		options.runContext.sessionId,
		mcpSessionOverlay,
	)
	if (mcpToolsWithMeta.length === 0) {
		return { tools: baseTools, manifest: '', selective: false }
	}
	if (sessionScopedMcpTools.length === 0) {
		return { tools: baseTools, manifest: '', selective: false }
	}

	const mcpDefinitions = createMcpToolDefinitions(options.mcpManager, options.runContext)
	const definitionByServerAndTool = new Map<string, ToolDefinition>()
	mcpToolsWithMeta.forEach((entry, index) => {
		const definition = mcpDefinitions[index]
		if (definition) {
			definitionByServerAndTool.set(`${entry.serverId}::${entry.tool.name}`, definition)
		}
	})

	const selective = shouldUseSelectiveLoading(sessionScopedMcpTools, {
		contextWindow: options.contextWindowTokens ?? 200_000,
		tokenBudgetPercent: options.mcpTokenBudgetPercent,
	})

	if (!selective) {
		const allSessionMcpDefinitions = sessionScopedMcpTools
			.map((entry) => definitionByServerAndTool.get(`${entry.serverId}::${entry.tool.name}`))
			.filter((tool): tool is ToolDefinition => tool !== undefined)
		return { tools: [...baseTools, ...allSessionMcpDefinitions], manifest: '', selective: false }
	}

	const selectedRawNames = new Set<string>(options.runContext.discoveredTools)
	for (const entry of sessionScopedMcpTools) {
		if (isAlwaysLoadTool(entry.tool) || options.mcpManager.getPinnedTools(entry.serverId).includes(entry.tool.name) || options.mcpManager.getAlwaysLoadTools(entry.serverId).includes(entry.tool.name)) {
			selectedRawNames.add(entry.tool.name)
		}
	}

	const selectedMcpTools = Array.from(selectedRawNames)
		.flatMap((name) => sessionScopedMcpTools
			.filter((entry) => entry.tool.name === name)
			.map((entry) => definitionByServerAndTool.get(`${entry.serverId}::${entry.tool.name}`)))
		.filter((tool): tool is ToolDefinition => tool !== undefined)

	return {
		tools: [
			...baseTools,
			createMcpSearchToolsTool({
				manager: options.mcpManager,
				getRunContext: () => options.runContext,
			}) as ToolDefinition<unknown, string>,
			...selectedMcpTools,
		],
		manifest: buildMcpManifest(buildMcpManifestServers(options.mcpManager, sessionScopedMcpTools)),
		selective: true,
	}
}

function toToolArguments(
	args: unknown,
	runId: string,
	toolCallId: string,
	questionEmitter: QuestionEmitter,
	sliderEmitter: SliderEmitter,
): Record<string, unknown> {
	const baseArgs =
		typeof args === 'object' && args !== null && !Array.isArray(args)
			? (args as Record<string, unknown>)
			: {}

	return {
		...baseArgs,
		conversationId: runId,
		_toolCallId: toolCallId,
		_questionEmitter: questionEmitter,
		_sliderEmitter: sliderEmitter,
	}
}

export async function* runAgentLoop(
	router: ProviderRouter,
	registry: ToolExecutor,
	options: AgentLoopOptions,
): AsyncGenerator<StreamEvent> {
	let messages = [...options.messages]
	let iterations = 0
	let tokenCount = estimateMessageTokens(messages)
	const contextWindow = options.contextWindowTokens ?? 200_000
	const sessionId = options.runContext.sessionId
	const maxIterations = options.maxIterations ?? 50
	const repairCounts = new Map<string, number>()
	const emitRunEvent = (type: string, data: unknown): void => {
		if (!options.sseManager) {
			return
		}

		publishRunEvent(options.runContext, options.sseManager, type, data)
	}
	const emitTokenSnapshot = (
		reason: string,
		deltaTokens = 0,
	): void => {
		if (!options.sseManager) {
			return
		}

		const snapshot = tokenCounter.getSnapshot(sessionId, contextWindow)
		options.sseManager.publish(options.runContext.projectId, sessionId, 'tokens.window', {
			sessionId,
			windowTokens: snapshot.windowTokens,
			windowMax: snapshot.windowMax,
			sessionTokens: snapshot.sessionTokens,
			deltaTokens,
			reason,
			ts: new Date(snapshot.updatedAt).toISOString(),
		})
		options.sseManager.publish(options.runContext.projectId, sessionId, 'tokens.session', {
			sessionId,
			windowTokens: snapshot.windowTokens,
			windowMax: snapshot.windowMax,
			sessionTokens: snapshot.sessionTokens,
			deltaTokens,
			reason,
			ts: new Date(snapshot.updatedAt).toISOString(),
		})
		options.sseManager.publish(options.runContext.projectId, sessionId, 'tokens.breakdown', {
			sessionId,
			windowTokens: snapshot.windowTokens,
			windowMax: snapshot.windowMax,
			sessionTokens: snapshot.sessionTokens,
			breakdown: snapshot.breakdown,
			ts: new Date(snapshot.updatedAt).toISOString(),
		})
	}
	const baseQuestionEmitter = options.questionEmitter ?? (() => undefined)
	const questionEmitter: QuestionEmitter = (payload) => {
		emitRunEvent('agent_run.question', payload)
		baseQuestionEmitter(payload)
	}
	const runQuestionEmitter = createQuestionEmitter(
		options.runContext.runId,
		questionEmitter,
	)
	const baseSliderEmitter = options.sliderEmitter ?? (() => undefined)
	const sliderEmitter: SliderEmitter = (payload) => {
		emitRunEvent('agent_run.slider', payload)
		baseSliderEmitter(payload)
	}
	const runSliderEmitter: SliderEmitter = (payload) => {
		sliderEmitter({
			...payload,
			conversationId: options.runContext.runId,
		})
	}

	emitRunEvent('agent_run.spawned', {
		runId: options.runContext.runId,
		parentRunId: options.runContext.parentRunId ?? null,
		agentType: options.runContext.agentType,
		title: options.runContext.title,
	})

	// Slash command detection: check the first user message for a /spec-* command.
	// If matched, prepend the command's prompt content as a system message so the
	// orchestrator receives it as context. Non-slash messages pass through unchanged.
	if (options.commandsDir) {
		const firstUserIdx = messages.findIndex((m) => m.role === 'user')
		if (firstUserIdx >= 0) {
			const match = await parseSlashCommand(messages[firstUserIdx].content, options.commandsDir)
			if (match) {
				messages.splice(firstUserIdx, 0, {
					role: 'system',
					content: match.promptContent,
				})
			}
		}
	}

	while (iterations < maxIterations) {
		if (options.runContext.signal.aborted) {
			emitRunEvent('agent_run.cancelled', {
				reason: 'run aborted before provider call',
			})
			clearRunEventSequence(options.runContext.runId)
			return
		}

		iterations += 1
		const messageStart = Date.now()

		if (
			options.compaction &&
			options.compaction.shouldCompact(tokenCount, contextWindow)
		) {
			const compacted = await options.compaction.compact({
				messages,
				tokenCount,
				contextWindow,
				sessionId,
				conversationId: options.runContext.runId,
			})
			messages = compacted.messages
			tokenCount = compacted.tokenCountAfter
			tokenCounter.recordCompaction(sessionId, tokenCount, contextWindow)
			emitTokenSnapshot('compaction', 0)
		}

		await emit(options.hookRegistry, 'message:before', {
			messages,
			provider: options.provider ?? 'default',
			model: 'unknown',
			runId: options.runContext.runId,
			sessionId: options.runContext.sessionId,
			projectId: options.runContext.projectId,
		})

		const adapterResult = router.getAdapter(options.provider)
		if (!adapterResult.ok) {
			yield { type: 'error', error: adapterResult.error }
			return
		}

		const effectiveMcpTools = createEffectiveMcpTools(options)
		const effectiveToolSet = createEffectiveToolSet(effectiveMcpTools.tools, options.runContext)

		const pendingToolCalls: ToolCall[] = []
		let finishReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop'
		let assistantText = ''
		let lastUsage: UsageEvent | null = null

		// system/context ordering: [fixed system header] → [PKB/context transforms]
		// → [base Elefant prompt] → [system:transform blocks, deterministic] → [rest of messages].
		const contextTransform = await emit(options.hookRegistry, 'context:transform', {
			system: [],
			sessionId,
			phase: readWorkflowState(options.state)?.phase,
		})
		const baseSystemPrompt = buildSystemPrompt({
			toolRegistry: { getAll: () => effectiveMcpTools.tools },
			sessionMode: inferSessionMode(options.state),
			workflowState: readWorkflowState(options.state),
			commands: systemPromptCommands,
		})
		const outgoingMessagesBase = insertSystemMessagesAfterLeadingSystem(
			messages,
			[
				...contextTransform.system.map((content) => ({ role: 'system' as const, content })),
				{ role: 'system', content: baseSystemPrompt },
			],
		)
		const transformedContext = await emit(options.hookRegistry, 'system:transform', {
			messages: outgoingMessagesBase,
			sessionId,
			conversationId: options.runContext.runId,
			runId: options.runContext.runId,
			projectId: options.runContext.projectId,
			state: options.state ?? null,
			budgets: {
				tokens: Math.max(0, contextWindow - tokenCount),
			},
		})
		const transformedMessages =
			Array.isArray(transformedContext.messages) && transformedContext.messages.length > 0
				? transformedContext.messages
				: outgoingMessagesBase
		const outgoingMessages = effectiveMcpTools.selective
			? appendManifestToMessages(transformedMessages, effectiveMcpTools.manifest)
			: transformedMessages

		for await (const event of adapterResult.data.sendMessage(outgoingMessages, effectiveToolSet, {
			signal: options.runContext.signal,
			provider: options.provider,
			maxTokens: options.maxTokens,
			temperature: options.temperature,
			topP: options.topP,
			timeoutMs: options.timeoutMs,
		})) {
			if (options.runContext.signal.aborted) {
				emitRunEvent('agent_run.cancelled', {
					reason: 'run aborted during provider stream',
				})
				clearRunEventSequence(options.runContext.runId)
				return
			}

			if (event.type === 'tool_call_complete') {
				emitRunEvent('agent_run.tool_call', {
					toolCall: event.toolCall,
				})
				pendingToolCalls.push(event.toolCall)
				continue
			}

			if (event.type === 'text_delta') {
				const before = tokenCounter.getSnapshot(sessionId, contextWindow)
				tokenCounter.recordTextDelta(sessionId, event.text, contextWindow)
				const after = tokenCounter.getSnapshot(sessionId, contextWindow)
				emitRunEvent('agent_run.token', {
					text: event.text,
				})
				emitTokenSnapshot('stream_delta', Math.max(0, after.windowTokens - before.windowTokens))
				assistantText += event.text
				yield event
				continue
			}

			if (event.type === 'usage') {
				lastUsage = event
				tokenCounter.recordUsageSnapshot(sessionId, event.inputTokens, event.outputTokens, contextWindow)
				emitTokenSnapshot('usage_snapshot', 0)
				yield event
				continue
			}

			if (event.type === 'done') {
				finishReason = event.finishReason

				if (event.finishReason !== 'tool_calls') {
					// Run is truly finishing — emit done event and status change now.
					emitRunEvent('agent_run.done', {
						finishReason: event.finishReason,
					})

					// Emit status change: running -> done
					if (options.sseManager) {
						publishStatusChange(options.sseManager, {
							runId: options.runContext.runId,
							sessionId: options.runContext.sessionId,
							projectId: options.runContext.projectId,
							parentRunId: options.runContext.parentRunId,
							agentType: options.runContext.agentType,
							title: options.runContext.title,
							previousStatus: 'running',
							nextStatus: 'done',
							reason: `finishReason: ${event.finishReason}`,
						})
					}

					clearRunEventSequence(options.runContext.runId)
					yield event
				}
				// finishReason === 'tool_calls': intermediate turn, loop continues.
				// Do NOT emit agent_run.done — the run is not finished yet.
				continue
			}

			if (event.type === 'error') {
				emitRunEvent('agent_run.error', {
					code: event.error.code,
					message: event.error.message,
					details: event.error.details,
				})

				// Emit status change: running -> error
				if (options.sseManager) {
					publishStatusChange(options.sseManager, {
						runId: options.runContext.runId,
						sessionId: options.runContext.sessionId,
						projectId: options.runContext.projectId,
						parentRunId: options.runContext.parentRunId,
						agentType: options.runContext.agentType,
						title: options.runContext.title,
						previousStatus: 'running',
						nextStatus: 'error',
						reason: event.error.message,
					})
				}

				clearRunEventSequence(options.runContext.runId)
				yield event
				return
			}

			yield event
		}

		if (pendingToolCalls.length === 0 || finishReason !== 'tool_calls') {
			await emit(options.hookRegistry, 'message:after', {
				messages,
				provider: options.provider ?? 'default',
				model: 'unknown',
				durationMs: Date.now() - messageStart,
				runId: options.runContext.runId,
				sessionId: options.runContext.sessionId,
				projectId: options.runContext.projectId,
			})
			return
		}

		messages.push({
			role: 'assistant',
			content: assistantText,
			toolCalls: pendingToolCalls,
		})
		// Prefer real usage data from the provider; fall back to estimator.
		tokenCount = lastUsage !== null ? lastUsage.inputTokens : estimateMessageTokens(messages)

		type TaskOutput = {
			events: StreamEvent[]
			message: Message
			isRepair?: boolean
		}

		const toolTasks = pendingToolCalls.map((toolCall) =>
			(async (): Promise<TaskOutput> => {
				const taskEvents: StreamEvent[] = []
				taskEvents.push({ type: 'tool_call_complete', toolCall })

				// Permission gate check before tool execution
				if (options.permissions) {
					const permResult = await options.permissions.check(
						toolCall.name,
						toolCall.arguments as Record<string, unknown>,
						options.runContext.runId,
						{
							sessionId: options.runContext.sessionId,
							projectId: options.runContext.projectId,
							agent: options.runContext.agentType,
						},
					)

					if (!permResult.ok || !permResult.data.approved) {
						const reason = permResult.ok
							? permResult.data.reason
							: permResult.error.message
						const toolResult = createToolResult(
							toolCall.id,
							`Tool call denied: ${reason}`,
							true,
						)
						taskEvents.push({ type: 'tool_result', toolResult })

						return {
							events: taskEvents,
							message: {
								role: 'tool',
								content: toolResult.content,
								toolCallId: toolResult.toolCallId,
							},
						}
					}
				}

				// Capture before-snapshot for file-mutating tools (best-effort).
				// Must happen before execution because the tool modifies the file.
				let beforeSnapshot: string | undefined
				const toolArgs = toolCall.arguments as Record<string, unknown> | undefined
				const toolFilePath = typeof toolArgs?.filePath === 'string' ? toolArgs.filePath : undefined
				if (toolFilePath && (toolCall.name === 'write' || toolCall.name === 'edit' || toolCall.name === 'apply_patch')) {
					try {
						const existingFile = Bun.file(toolFilePath)
						if (await existingFile.exists()) {
							beforeSnapshot = await existingFile.text()
						}
					} catch {
						// best-effort — snapshot not critical
					}
				}

				const executeResult = await registry.execute(
					toolCall.name,
					toToolArguments(toolCall.arguments, options.runContext.runId, toolCall.id, runQuestionEmitter, runSliderEmitter),
				)

				if (!executeResult.ok && executeResult.error.code === 'VALIDATION_ERROR') {
					const repairCount = repairCounts.get(toolCall.id) ?? 0
					if (repairCount < 2) {
						repairCounts.set(toolCall.id, repairCount + 1)
						const toolResult = createToolResult(toolCall.id, executeResult.error.message, true)
						emitRunEvent('agent_run.tool_result', {
							toolResult,
						})
						taskEvents.push({ type: 'tool_result', toolResult })

						return {
							events: taskEvents,
							message: {
								role: 'tool',
								content: toolResult.content,
								toolCallId: toolResult.toolCallId,
							},
							isRepair: true,
						}
					}
				}

				const toolResult = createToolResult(
					toolCall.id,
					executeResult.ok ? executeResult.data : executeResult.error.message,
					!executeResult.ok,
				)
				emitRunEvent('agent_run.tool_result', {
					toolResult,
				})
				taskEvents.push({ type: 'tool_result', toolResult })

				if (toolCall.name === 'todowrite' && executeResult.ok && options.sseManager) {
					try {
						const args = toolCall.arguments as Record<string, unknown> | undefined
						const rawTodos = args?.todos
						if (Array.isArray(rawTodos)) {
							const todoItems: TodoItem[] = rawTodos
								.map((item: unknown, index: number): TodoItem | null => {
									if (typeof item !== 'object' || item === null) return null
									const obj = item as Record<string, unknown>
									const status = typeof obj.status === 'string' && isValidTodoStatus(obj.status) ? obj.status : 'pending'
									const priority = typeof obj.priority === 'string' && isValidTodoPriority(obj.priority) ? obj.priority as TodoItem['priority'] : undefined
									return {
										id: typeof obj.id === 'string' ? obj.id : crypto.randomUUID(),
										content: typeof obj.content === 'string' ? obj.content : '',
										status,
										priority,
										position: typeof obj.position === 'number' ? obj.position : index,
									}
								})
								.filter((item): item is TodoItem => item !== null)

							sessionTodoTracker.updateTodos(options.runContext.sessionId, todoItems)
							options.sseManager.publish(
								options.runContext.projectId,
								options.runContext.sessionId,
								'todos.updated',
								{ sessionId: options.runContext.sessionId, todos: todoItems },
							)
						}
					} catch (err) {
						console.warn('[elefant] Failed to track session todos:', err)
					}
				}

				// Record file changes from write/edit/apply_patch tool executions.
				if (executeResult.ok && toolFilePath && options.projectRoot) {
					const fileChangeTools = new Set(['write', 'edit', 'apply_patch'])
					if (fileChangeTools.has(toolCall.name)) {
						let changeType: FileChange['changeType']
						if (toolCall.name === 'write') {
							changeType = beforeSnapshot !== undefined ? 'modified' : 'created'
						} else {
							changeType = 'modified'
						}

						const fileChange: FileChange = {
							path: normalizePath(toolFilePath, options.projectRoot),
							changeType,
							absolutePath: toolFilePath,
							lastTouchedAt: Date.now(),
							snapshot: beforeSnapshot,
						}

						fileChangeTracker.recordChange(options.runContext.sessionId, fileChange)

						if (options.sseManager) {
							options.sseManager.publish(
								options.runContext.projectId,
								options.runContext.sessionId,
								'file.changed',
								{ sessionId: options.runContext.sessionId, change: fileChange },
							)
						}
					}
				}

				return {
					events: taskEvents,
					message: {
						role: 'tool',
						content: toolResult.content,
						toolCallId: toolResult.toolCallId,
					},
				}
			})(),
		)

		const taskOutputs = await Promise.all(toolTasks)
		const anyRepair = taskOutputs.some((output) => output.isRepair === true)

		for (const output of taskOutputs) {
			for (const event of output.events) {
				yield event
			}
			messages.push(output.message)
		}
		tokenCount = estimateMessageTokens(messages)

		await emit(options.hookRegistry, 'message:after', {
			messages,
			provider: options.provider ?? 'default',
			model: 'unknown',
			durationMs: Date.now() - messageStart,
			runId: options.runContext.runId,
			sessionId: options.runContext.sessionId,
			projectId: options.runContext.projectId,
		})

		if (anyRepair) {
			iterations -= 1
		}
	}

	yield {
		type: 'error',
		error: {
			code: 'TOOL_EXECUTION_FAILED',
			message: 'Max iterations reached',
		},
	}
	emitRunEvent('agent_run.error', {
		code: 'TOOL_EXECUTION_FAILED',
		message: 'Max iterations reached',
	})
	clearRunEventSequence(options.runContext.runId)
}
