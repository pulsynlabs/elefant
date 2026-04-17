import { Elysia } from 'elysia'

import type { HookRegistry } from '../hooks/index.ts'
import type { ProviderRouter } from '../providers/router.ts'
import type { ToolRegistry } from '../tools/registry.ts'
import { registerServerRoutes } from './routes.ts'

export function createApp(
	providerRouter: ProviderRouter,
	toolRegistry: ToolRegistry,
	hookRegistry: HookRegistry,
): Elysia {
	const app = new Elysia({
		serve: {
			maxRequestBodySize: 10 * 1024 * 1024,
		},
	})
		.onRequest(({ request, set }) => {
			set.headers['X-Content-Type-Options'] = 'nosniff'
			set.headers['X-Frame-Options'] = 'DENY'
			set.headers['Referrer-Policy'] = 'no-referrer'

			const origin = request.headers.get('origin')
			if (!origin) return

			const isLocalOrigin =
				origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')

			if (!isLocalOrigin) {
				set.status = 403
				return { ok: false, error: 'Origin not allowed' }
			}

			set.headers['Access-Control-Allow-Origin'] = origin
			set.headers['Vary'] = 'Origin'

			return
		})
		.onError(({ code, error, set }) => {
			set.status = code === 'NOT_FOUND' ? 404 : 500
			return { ok: false, error: String(error) }
		})
		.get('/health', () => ({
			ok: true,
			status: 'running',
			uptime: process.uptime(),
			timestamp: new Date().toISOString(),
		}))

	return registerServerRoutes(app as unknown as Elysia, providerRouter, toolRegistry, hookRegistry)
}
