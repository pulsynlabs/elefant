import { Elysia } from 'elysia'

import type { HookRegistry } from '../hooks/index.ts'
import type { ProviderRouter } from '../providers/router.ts'
import type { ToolRegistry } from '../tools/registry.ts'
import type { ElefantWsServer } from '../transport/ws-server.ts'
import type { SseManager } from '../transport/sse-manager.ts'
import type { Database } from '../db/database.ts'
import { ConfigManager } from '../config/index.ts'
import { registerServerRoutes } from './routes.ts'
import { registerQuestionRoute } from '../tools/question/route.ts'
import { mountWsRoute } from './routes-ws.ts'
import { mountProjectEventsRoute, mountProjectsRoutes } from './routes-projects.ts'
import { RunRegistry } from '../runs/registry.ts'
import { mountAgentRunRoutes } from '../runs/routes.ts'
import { mountWorktreeRoutes } from '../worktree/routes.ts'
import { createConfigRoutes } from './config-routes.ts'
import { gracefulShutdown } from '../daemon/shutdown.ts'

export function createApp(
	providerRouter: ProviderRouter,
	toolRegistry: ToolRegistry,
	hookRegistry: HookRegistry,
	db: Database,
	ws?: ElefantWsServer,
	sse?: SseManager,
) {
	const CORS_HEADERS = {
		'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
		'Access-Control-Max-Age': '86400',
	} as const

	const app = new Elysia({
		serve: {
			maxRequestBodySize: 10 * 1024 * 1024,
			// Disable SO_REUSEPORT so duplicate daemon binds fail fast with EADDRINUSE
			// instead of silently sharing port 1337 across processes.
			reusePort: false,
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
			// Absolute path to the entry point so the desktop app can restart
			// the daemon without any manual path configuration.
			entryPath: import.meta.filename,
		}))

	// Graceful shutdown endpoint — called by the desktop app's daemon
	// management panel. Responds immediately with 200 then exits the process
	// so the HTTP response has time to reach the client before the socket closes.
	app.post('/api/daemon/shutdown', () => {
		setTimeout(() => {
			void gracefulShutdown('manual')
		}, 50)
		return { ok: true, message: 'Shutting down' }
	})

	// Register question tool route for HITL interactions
	registerQuestionRoute(app as unknown as Elysia)

	// Create shared run infrastructure before routes so /api/chat
	// and /api/projects/.../agent-runs share the same registry + config.
	const runRegistry = new RunRegistry()
	const configManager = new ConfigManager()

	const baseApp = registerServerRoutes(
		app as unknown as Elysia,
		providerRouter,
		toolRegistry,
		hookRegistry,
		db,
		{
			database: db,
			runRegistry,
			sseManager: sse,
			configManager,
		},
	)

	// Mount transport routes when available
	if (ws) mountWsRoute(baseApp, ws)
	if (sse) mountProjectEventsRoute(baseApp, sse)

	// Mount project CRUD routes
	mountProjectsRoutes(baseApp, db)

	// Mount agent run routes (MH3)
	mountAgentRunRoutes(baseApp, {
		db,
		providerRouter,
		toolRegistry,
		hookRegistry,
		runRegistry,
		sseManager: sse,
		configManager,
	})

	// Mount worktree management routes (MH5)
	mountWorktreeRoutes(baseApp, { db })

	// Mount agent config routes (MH4)
	createConfigRoutes(baseApp, providerRouter, configManager)

	return baseApp
}

/**
 * The fully-typed Elysia app instance with all routes.
 * Exported for Eden Treaty type inference on the client side.
 * Usage: `import type { App } from 'elefant'`
 */
export type App = ReturnType<typeof createApp>
