import type { Elysia } from 'elysia'

import type { HookRegistry } from '../hooks/index.ts'
import type { ProviderRouter } from '../providers/router.ts'
import type { ToolRegistry } from '../tools/registry.ts'
import type { Database } from '../db/database.ts'
import { createConversationRoute } from './conversation.ts'
import { createConfigRoutes } from './config-routes.ts'
import { ConfigManager } from '../config/index.ts'
import { getProjectById } from '../db/repo/projects.ts'
import { err, ok } from '../types/result.ts'

export function registerServerRoutes(
	app: Elysia,
	providerRouter: ProviderRouter,
	toolRegistry: ToolRegistry,
	hookRegistry: HookRegistry,
	db: Database,
): Elysia {
	const configManager = new ConfigManager({
		projectPathResolver: (projectId) => {
			const project = getProjectById(db, projectId)
			if (!project.ok) {
				return err(project.error)
			}

			return ok(project.data.path)
		},
	})

	createConfigRoutes(app as unknown as Elysia, providerRouter, configManager)
	return createConversationRoute(app, providerRouter, toolRegistry, hookRegistry)
}
