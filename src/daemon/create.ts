import type { ElefantConfig } from '../config/index.ts'
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
import { createPhaseAllowListFromSpecTools, createSpecPhaseGateHandler } from '../hooks/spec-phase-gate.ts'
import { createPkbContextTransformHandler } from '../hooks/pkb-context-transform.ts'
import { instantiateSpecTools } from '../tools/spec/index.ts'
import { sessionManager } from '../tools/shell/index.js'
import { ElefantWsServer } from '../transport/ws-server.ts'
import { SseManager } from '../transport/sse-manager.ts'
import { registerSpecModeEventPublisher } from '../transport/spec-mode-events.ts'
import type { ElefantError } from '../types/errors.ts'
import { err, ok, type Result } from '../types/result.ts'
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
		createPkbContextTransformHandler({ projectPath: projectInfo.projectPath }),
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

	// Permission gate for tool-call approval
	const permissions = new PermissionGate(context, ws)
	context.permissions = permissions

	// Context compaction manager
	const compaction = new CompactionManager(context)
	context.compaction = compaction

	const app = createApp(providerRouter, toolRegistry, hookRegistry, db, ws, sse, stateManager)

	ws.startHeartbeat()

	hookRegistry.register('shutdown', async () => {
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
			await pluginLoader.unloadAll()
			ws.stopHeartbeat()
			sse.destroy()
			await app.stop()
			db.close()
		},
	})
}
