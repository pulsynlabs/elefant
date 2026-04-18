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
	const CORS_HEADERS = {
		'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
		'Access-Control-Max-Age': '86400',
	} as const

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
				origin.startsWith('http://localhost') ||
				origin.startsWith('http://127.0.0.1') ||
				origin === 'tauri://localhost' ||
				origin === 'https://tauri.localhost'

			if (!isLocalOrigin) {
				set.status = 403
				return { ok: false, error: 'Origin not allowed' }
			}

			set.headers['Access-Control-Allow-Origin'] = origin
			set.headers['Vary'] = 'Origin'
			Object.assign(set.headers, CORS_HEADERS)

			// Handle preflight — return 204 immediately
			if (request.method === 'OPTIONS') {
				set.status = 204
				return ''
			}

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
