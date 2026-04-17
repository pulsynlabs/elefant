import type { ElefantConfig } from '../config/index.ts'
import { HookRegistry } from '../hooks/index.ts'
import { ProviderRouter } from '../providers/router.ts'
import { createApp } from '../server/app.ts'
import { createToolRegistry } from '../tools/registry.ts'
import { sessionManager } from '../tools/shell/index.js'
import type { ElefantError } from '../types/errors.ts'
import { err, ok, type Result } from '../types/result.ts'
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

	const app = createApp(providerRouter, toolRegistry, hookRegistry)

	hookRegistry.register('shutdown', async () => {
		await sessionManager.closeAll()
	})

	setGlobalHookRegistry(hookRegistry)

	return ok({
		start: async () => {
			await app.listen(config.port)
			console.error(`[elefant] Daemon listening on port ${config.port}`)
		},
		stop: async () => {
			await app.stop()
		},
	})
}
