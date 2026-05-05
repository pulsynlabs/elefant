import { ConfigManager, type ElefantConfig } from '../config/index.ts'
import {
	buildSpecModeBlock,
	buildStateBlock,
	createCompactionBlockTransform,
	type BlockBuilder,
} from '../compaction/blocks.ts'
import { CompactionManager } from '../compaction/manager.ts'
import { Database } from '../db/database.ts'
import { HookRegistry } from '../hooks/index.ts'
import { basename } from 'node:path'
import { PermissionGate } from '../permissions/gate.ts'
import { PluginLoader } from '../plugins/loader.ts'
import { ProjectManager } from '../project/manager.ts'
import type { ProjectInfo } from '../project/types.ts'
import { ProviderRouter } from '../providers/router.ts'
import { createApp } from '../server/app.ts'
import { StateManager } from '../state/manager.ts'
import { createToolRegistry } from '../tools/registry.ts'
import { createPhaseAllowListFromSpecTools, createSpecPhaseGateHandler } from '../hooks/wf-phase-gate.ts'
import { createDatetimeContextTransformHandler } from '../hooks/datetime-context-transform.ts'
import { createPkbContextTransformHandler } from '../hooks/pkb-context-transform.ts'
import { instantiateSpecTools } from '../tools/workflow/index.ts'
import { sessionManager } from '../tools/shell/index.js'
import { ElefantWsServer } from '../transport/ws-server.ts'
import { SseManager } from '../transport/sse-manager.ts'
import { registerSpecModeEventPublisher } from '../transport/spec-mode-events.ts'
import { MCPManager } from '../mcp/manager.ts'
import { MCP_EVENTS_PROJECT_ID } from '../server/mcp-routes.ts'
import type { ElefantError } from '../types/errors.ts'
import { err, ok, type Result } from '../types/result.ts'
import { createLspService } from '../lsp/index.js'
import type { DaemonContext } from './context.ts'
import { setGlobalHookRegistry } from './shutdown.ts'

export interface ElefantDaemon {
	start(): Promise<void>
	stop(): Promise<void>
}

function toConfigError(message: string, details?: unknown): ElefantError {
	return {
		code: 'CONFIG_INVALID',
		message,
		details,
	}
}

export async function createDaemon(config: ElefantConfig): Promise<Result<ElefantDaemon, ElefantError>> {
	const hookRegistry = new HookRegistry()
	const toolRegistry = createToolRegistry(hookRegistry)
	const lspService = createLspService()

	let providerRouter: ProviderRouter
	try {
		providerRouter = new ProviderRouter(config)
	} catch (error) {
		return err(
			toConfigError(
				error instanceof Error ? error.message : 'Failed to initialize provider router',
			),
		)
	}

	// A. Bootstrap .elefant/ directory
	const bootstrapResult = await ProjectManager.bootstrap(config.projectPath)
	if (!bootstrapResult.ok) {
		return err(toConfigError('Failed to bootstrap project directory', bootstrapResult.error))
	}
	const projectInfo: ProjectInfo = bootstrapResult.data

	// B. Initialize SQLite database
	const db = new Database(projectInfo.dbPath)

	// C. Initialize StateManager
	const stateManager = new StateManager(projectInfo.projectPath, {
		id: projectInfo.projectId,
		name: basename(projectInfo.projectPath),
		path: projectInfo.projectPath,
		database: db,
		hookRegistry,
	})
	hookRegistry.on(
		'tool:before',
		createSpecPhaseGateHandler(
			stateManager,
			createPhaseAllowListFromSpecTools(instantiateSpecTools()),
		),
		{ priority: 10 },
	)
	hookRegistry.on(
		'context:transform',
		createDatetimeContextTransformHandler(),
		{ priority: 5 },
	)
	hookRegistry.on(
		'context:transform',
		createPkbContextTransformHandler({ projectPath: projectInfo.projectPath }),
		{ priority: 10 },
	)
	const compactionBlock: BlockBuilder = {
		name: 'compaction-context',
		render: () => {
			const activeSpec = db.db
				.query(
					'SELECT workflow_id FROM spec_workflows WHERE project_id = ? AND is_active = 1 LIMIT 1',
				)
				.get(projectInfo.projectId) as { workflow_id: string } | null

			return activeSpec
				? buildSpecModeBlock(db, projectInfo.projectId, activeSpec.workflow_id)
				: buildStateBlock(stateManager.getState())
		},
	}
	const compactionTransform = createCompactionBlockTransform({
		blocks: [compactionBlock],
		budget: 1_500,
	})
	hookRegistry.on(
		'system:transform',
		(context) => {
			if (context.runId) {
				const run = db.db
					.query('SELECT context_mode FROM agent_runs WHERE run_id = ? LIMIT 1')
					.get(context.runId) as { context_mode: string } | null
				if (run?.context_mode === 'none') {
					return { messages: context.messages }
				}
			}

			return compactionTransform(context)
		},
		{ priority: 10 },
	)

	const contextBase = {
		config,
		hooks: hookRegistry,
		tools: toolRegistry,
		providers: providerRouter,
		project: projectInfo,
		db,
		state: stateManager,
	} as Omit<DaemonContext, 'plugins' | 'ws' | 'sse' | 'permissions' | 'compaction'>

	const context = contextBase as DaemonContext
 
	const pluginLoader = new PluginLoader(context)
	context.plugins = pluginLoader
	await pluginLoader.loadAll()

	// Transport layer: WebSocket + SSE
	const ws = new ElefantWsServer(context)
	const sse = new SseManager(db)
	context.ws = ws
	context.sse = sse
	registerSpecModeEventPublisher(hookRegistry, sse, ws)

	const mcpConfigManager = new ConfigManager()
	const mcpManager = new MCPManager(mcpConfigManager, (event) => {
		sse.publishVolatile(MCP_EVENTS_PROJECT_ID, event.type, event)
	})

	// Permission gate for tool-call approval
	const permissions = new PermissionGate(context, ws)
	context.permissions = permissions

	// Context compaction manager
	const compaction = new CompactionManager(context)
	context.compaction = compaction

	const app = createApp(providerRouter, toolRegistry, hookRegistry, db, ws, sse, stateManager, mcpManager)

	ws.startHeartbeat()

	hookRegistry.register('shutdown', async () => {
		await mcpManager.shutdown()
		await sessionManager.closeAll()
		await pluginLoader.unloadAll()
		ws.stopHeartbeat()
		sse.destroy()
		db.close()
	})

	setGlobalHookRegistry(hookRegistry)

	return ok({
		start: async () => {
			await app.listen(config.port)
			console.error(`[elefant] Daemon listening on port ${config.port}`)
		},
		stop: async () => {
			await lspService.dispose()
			await mcpManager.shutdown()
			await pluginLoader.unloadAll()
			ws.stopHeartbeat()
			sse.destroy()
			await app.stop()
			db.close()
		},
	})
}
