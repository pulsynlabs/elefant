import { afterEach, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { Database } from '../db/database.ts'
import { HookRegistry } from '../hooks/index.ts'
import type { ConfigManager } from '../config/loader.js'
import type { ProviderRouter } from '../providers/router.ts'
import type { ProviderAdapter, SendMessageOptions, StreamEvent } from '../providers/types.ts'
import { ToolRegistry } from '../tools/registry.ts'
import { SseManager } from '../transport/sse-manager.ts'
import { RunRegistry } from './registry.ts'
import { mountAgentRunRoutes } from './routes.ts'

const tempDirs: string[] = []

function createTempDbPath(): string {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-runs-routes-'))
	tempDirs.push(dir)
	return join(dir, 'db.sqlite')
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true })
	}
})

function createRouter(): ProviderRouter {
	const adapter: ProviderAdapter = {
		name: 'mock-provider',
		async *sendMessage(
			messages,
			_tools,
			options?: SendMessageOptions,
		): AsyncGenerator<StreamEvent> {
			const shouldWait = messages.some((message) => message.content.includes('[wait]'))
			if (shouldWait) {
				await new Promise<void>((resolve) => {
					if (!options?.signal) {
						setTimeout(resolve, 50)
						return
					}

					if (options.signal.aborted) {
						resolve()
						return
					}

					options.signal.addEventListener('abort', () => resolve(), { once: true })
					setTimeout(resolve, 200)
				})
			}

			yield { type: 'text_delta', text: 'ok' }
			yield { type: 'done', finishReason: 'stop' }
		},
	}

	return {
		getAdapter: () => ({ ok: true, data: adapter }),
		listProviders: () => ['mock-provider'],
	} as unknown as ProviderRouter
}

function createJsonRequest(url: string, method: string, body?: unknown): Request {
	return new Request(url, {
		method,
		headers: {
			'content-type': 'application/json',
		},
		body: body ? JSON.stringify(body) : undefined,
	})
}

function createConfigManager(): ConfigManager {
	return {
		resolve: async () =>
			({
				ok: true,
				data: {
					name: 'executor',
					provider: 'mock-provider',
					model: 'mock-model',
					timeout: null,
					maxTokens: null,
					temperature: null,
					maxTaskDepth: null,
					maxChildren: null,
					permission: null,
					modes: null,
					context: null,
				},
			}) as never,
	} as unknown as ConfigManager
}

function insertRun(
	database: Database,
	input: {
		runId: string
		sessionId: string
		projectId: string
		parentRunId?: string | null
		title: string
		createdAt: string
	},
): void {
	database.db.run(
		`INSERT INTO agent_runs (
			run_id,
			session_id,
			project_id,
			parent_run_id,
			agent_type,
			title,
			status,
			created_at,
			started_at,
			ended_at,
			context_mode,
			error_message
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			input.runId,
			input.sessionId,
			input.projectId,
			input.parentRunId ?? null,
			'executor',
			input.title,
			'done',
			input.createdAt,
			input.createdAt,
			input.createdAt,
			'none',
			null,
		],
	)
}

describe('mountAgentRunRoutes', () => {
	it('supports spawn, list, and detail endpoints', async () => {
		const database = new Database(createTempDbPath())
		const projectId = crypto.randomUUID()
		const sessionId = crypto.randomUUID()

		database.db.run(
			'INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)',
			[projectId, 'Routes project', '/tmp/routes-project', null],
		)
		database.db.run(
			'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
			[sessionId, projectId, null, 'execute', 'running', new Date().toISOString(), null],
		)

		const app = new Elysia()
		mountAgentRunRoutes(app, {
			db: database,
			providerRouter: createRouter(),
			toolRegistry: new ToolRegistry(new HookRegistry()),
			hookRegistry: new HookRegistry(),
			runRegistry: new RunRegistry(),
			sseManager: new SseManager(database),
			configManager: createConfigManager(),
		})

		const spawnResponse = await app.handle(
			createJsonRequest(
				`http://localhost/api/projects/${projectId}/sessions/${sessionId}/agent-runs`,
				'POST',
				{
					agentType: 'executor',
					title: 'Spawned run',
					contextMode: 'none',
					prompt: 'hello world',
				},
			),
		)

		expect(spawnResponse.status).toBe(200)
		const spawnPayload = (await spawnResponse.json()) as {
			ok: boolean
			data: { runId: string }
		}
		expect(spawnPayload.ok).toBe(true)
		expect(typeof spawnPayload.data.runId).toBe('string')

		await Bun.sleep(30)

		const listResponse = await app.handle(
			new Request(`http://localhost/api/sessions/${sessionId}/agent-runs?limit=50&offset=0`),
		)
		expect(listResponse.status).toBe(200)
		const listPayload = (await listResponse.json()) as {
			ok: boolean
			data: Array<{ run_id: string }>
		}
		expect(listPayload.ok).toBe(true)
		expect(listPayload.data.some((run) => run.run_id === spawnPayload.data.runId)).toBe(true)

		const detailResponse = await app.handle(
			new Request(`http://localhost/api/agent-runs/${spawnPayload.data.runId}`),
		)
		expect(detailResponse.status).toBe(200)
		const detailPayload = (await detailResponse.json()) as {
			ok: boolean
			data: { run: { run_id: string } }
		}
		expect(detailPayload.ok).toBe(true)
		expect(detailPayload.data.run.run_id).toBe(spawnPayload.data.runId)

		database.close()
	})

	it('cancels active runs through cancel endpoint', async () => {
		const database = new Database(createTempDbPath())
		const projectId = crypto.randomUUID()
		const sessionId = crypto.randomUUID()

		database.db.run(
			'INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)',
			[projectId, 'Cancel project', '/tmp/cancel-project', null],
		)
		database.db.run(
			'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
			[sessionId, projectId, null, 'execute', 'running', new Date().toISOString(), null],
		)

		const runRegistry = new RunRegistry()
		const app = new Elysia()
		mountAgentRunRoutes(app, {
			db: database,
			providerRouter: createRouter(),
			toolRegistry: new ToolRegistry(new HookRegistry()),
			hookRegistry: new HookRegistry(),
			runRegistry,
			sseManager: new SseManager(database),
			configManager: createConfigManager(),
		})

		const spawnResponse = await app.handle(
			createJsonRequest(
				`http://localhost/api/projects/${projectId}/sessions/${sessionId}/agent-runs`,
				'POST',
				{
					agentType: 'executor',
					title: 'Cancelable run',
					contextMode: 'none',
					prompt: '[wait] keep running',
				},
			),
		)
		const spawnPayload = (await spawnResponse.json()) as {
			ok: boolean
			data: { runId: string }
		}

		expect(spawnPayload.ok).toBe(true)
		expect(runRegistry.getRun(spawnPayload.data.runId)).toBeDefined()

		const cancelResponse = await app.handle(
			createJsonRequest(
				`http://localhost/api/agent-runs/${spawnPayload.data.runId}/cancel`,
				'POST',
				{},
			),
		)
		expect(cancelResponse.status).toBe(200)
		const cancelPayload = (await cancelResponse.json()) as {
			ok: boolean
			data: { runId: string; status: string }
		}
		expect(cancelPayload.ok).toBe(true)
		expect(cancelPayload.data.status).toBe('cancelled')

		await Bun.sleep(20)

		const detailResponse = await app.handle(
			new Request(`http://localhost/api/agent-runs/${spawnPayload.data.runId}`),
		)
		const detailPayload = (await detailResponse.json()) as {
			ok: boolean
			data: { run: { status: string } }
		}
		expect(detailPayload.ok).toBe(true)
		expect(detailPayload.data.run.status).toBe('cancelled')

		database.close()
	})

	it('returns direct children with pagination and session isolation', async () => {
		const database = new Database(createTempDbPath())
		const projectId = crypto.randomUUID()
		const sessionId = crypto.randomUUID()
		const otherSessionId = crypto.randomUUID()

		database.db.run(
			'INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)',
			[projectId, 'Children project', '/tmp/children-project', null],
		)
		database.db.run(
			'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
			[sessionId, projectId, null, 'execute', 'running', new Date().toISOString(), null],
		)
		database.db.run(
			'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
			[otherSessionId, projectId, null, 'execute', 'running', new Date().toISOString(), null],
		)

		const parentRunId = crypto.randomUUID()
		const childOne = crypto.randomUUID()
		const childTwo = crypto.randomUUID()
		const grandChild = crypto.randomUUID()
		const crossSessionChild = crypto.randomUUID()

		insertRun(database, {
			runId: parentRunId,
			sessionId,
			projectId,
			title: 'Parent',
			createdAt: '2026-04-19T10:00:00.000Z',
		})
		insertRun(database, {
			runId: childOne,
			sessionId,
			projectId,
			parentRunId,
			title: 'Child one',
			createdAt: '2026-04-19T10:01:00.000Z',
		})
		insertRun(database, {
			runId: childTwo,
			sessionId,
			projectId,
			parentRunId,
			title: 'Child two',
			createdAt: '2026-04-19T10:02:00.000Z',
		})
		insertRun(database, {
			runId: grandChild,
			sessionId,
			projectId,
			parentRunId: childOne,
			title: 'Grand child',
			createdAt: '2026-04-19T10:03:00.000Z',
		})
		insertRun(database, {
			runId: crossSessionChild,
			sessionId: otherSessionId,
			projectId,
			parentRunId,
			title: 'Cross session child',
			createdAt: '2026-04-19T10:04:00.000Z',
		})

		const app = new Elysia()
		mountAgentRunRoutes(app, {
			db: database,
			providerRouter: createRouter(),
			toolRegistry: new ToolRegistry(new HookRegistry()),
			hookRegistry: new HookRegistry(),
			runRegistry: new RunRegistry(),
			sseManager: new SseManager(database),
			configManager: createConfigManager(),
		})

		const response = await app.handle(
			new Request(
				`http://localhost/api/projects/${projectId}/sessions/${sessionId}/runs/${parentRunId}/children`,
			),
		)
		expect(response.status).toBe(200)
		const payload = (await response.json()) as {
			ok: boolean
			data: Array<{ run_id: string }>
		}
		expect(payload.ok).toBe(true)
		expect(payload.data.map((run) => run.run_id)).toEqual([childOne, childTwo])

		const paginatedResponse = await app.handle(
			new Request(
				`http://localhost/api/projects/${projectId}/sessions/${sessionId}/runs/${parentRunId}/children?limit=1&offset=1`,
			),
		)
		expect(paginatedResponse.status).toBe(200)
		const paginatedPayload = (await paginatedResponse.json()) as {
			ok: boolean
			data: Array<{ run_id: string }>
		}
		expect(paginatedPayload.ok).toBe(true)
		expect(paginatedPayload.data.map((run) => run.run_id)).toEqual([childTwo])

		database.close()
	})

	it('returns 404 when session is not found for project', async () => {
		const database = new Database(createTempDbPath())
		const projectId = crypto.randomUUID()
		const otherProjectId = crypto.randomUUID()
		const sessionId = crypto.randomUUID()
		const runId = crypto.randomUUID()

		database.db.run(
			'INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)',
			[projectId, 'Main project', '/tmp/main-project', null],
		)
		database.db.run(
			'INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)',
			[otherProjectId, 'Other project', '/tmp/other-project', null],
		)
		database.db.run(
			'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
			[sessionId, projectId, null, 'execute', 'running', new Date().toISOString(), null],
		)

		insertRun(database, {
			runId,
			sessionId,
			projectId,
			title: 'Parent',
			createdAt: '2026-04-19T10:00:00.000Z',
		})

		const app = new Elysia()
		mountAgentRunRoutes(app, {
			db: database,
			providerRouter: createRouter(),
			toolRegistry: new ToolRegistry(new HookRegistry()),
			hookRegistry: new HookRegistry(),
			runRegistry: new RunRegistry(),
			sseManager: new SseManager(database),
			configManager: createConfigManager(),
		})

		const response = await app.handle(
			new Request(
				`http://localhost/api/projects/${otherProjectId}/sessions/${sessionId}/runs/${runId}/children`,
			),
		)

		expect(response.status).toBe(404)
		const payload = (await response.json()) as {
			ok: boolean
			error: { code: string; message: string }
		}
		expect(payload.ok).toBe(false)
		expect(payload.error.code).toBe('FILE_NOT_FOUND')

		database.close()
	})

	it('returns 404 when run is not found in session', async () => {
		const database = new Database(createTempDbPath())
		const projectId = crypto.randomUUID()
		const sessionId = crypto.randomUUID()
		const otherSessionId = crypto.randomUUID()
		const runId = crypto.randomUUID()

		database.db.run(
			'INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)',
			[projectId, 'Runs project', '/tmp/runs-project', null],
		)
		database.db.run(
			'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
			[sessionId, projectId, null, 'execute', 'running', new Date().toISOString(), null],
		)
		database.db.run(
			'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
			[otherSessionId, projectId, null, 'execute', 'running', new Date().toISOString(), null],
		)

		insertRun(database, {
			runId,
			sessionId: otherSessionId,
			projectId,
			title: 'Other session run',
			createdAt: '2026-04-19T10:00:00.000Z',
		})

		const app = new Elysia()
		mountAgentRunRoutes(app, {
			db: database,
			providerRouter: createRouter(),
			toolRegistry: new ToolRegistry(new HookRegistry()),
			hookRegistry: new HookRegistry(),
			runRegistry: new RunRegistry(),
			sseManager: new SseManager(database),
			configManager: createConfigManager(),
		})

		const response = await app.handle(
			new Request(
				`http://localhost/api/projects/${projectId}/sessions/${sessionId}/runs/${runId}/children`,
			),
		)

		expect(response.status).toBe(404)
		const payload = (await response.json()) as {
			ok: boolean
			error: { code: string; message: string }
		}
		expect(payload.ok).toBe(false)
		expect(payload.error.code).toBe('FILE_NOT_FOUND')

		database.close()
	})
})
