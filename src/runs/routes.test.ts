import { afterEach, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { Database } from '../db/database.ts'
import { HookRegistry } from '../hooks/index.ts'
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
})
