import type { Elysia } from 'elysia'

import type { ProviderRouter } from '../providers/router.ts'
import { createConversationRoute } from './conversation.ts'

export function registerServerRoutes(app: Elysia, providerRouter: ProviderRouter): Elysia {
	return createConversationRoute(app, providerRouter)
}
