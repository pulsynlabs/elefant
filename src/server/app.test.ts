import { describe, expect, it, beforeAll, afterAll } from 'bun:test'

import type { ElefantConfig } from '../config/schema.ts'
import { HookRegistry } from '../hooks/index.ts'
import { ProviderRouter } from '../providers/router.ts'
import { createToolRegistry } from '../tools/registry.ts'
import { createApp } from './app.ts'
import { Database } from '../db/database.ts'

function createTestRouter(): ProviderRouter {
	const config: ElefantConfig = {
		port: 1337,
		logLevel: 'info',
		defaultProvider: 'test-provider',
		providers: [
			{
				name: 'test-provider',
				baseURL: 'https://api.openai.com/v1',
				apiKey: 'test-key',
				model: 'gpt-4o-mini',
				format: 'openai',
			},
		],
	}

	return new ProviderRouter(config)
}

function createTestApp() {
	const hooks = new HookRegistry()
	const db = new Database(':memory:')
	const app = createApp(createTestRouter(), createToolRegistry(hooks), hooks, db)
	return { app, db }
}

describe('createApp', () => {
	it('GET /health returns 200 with ok: true', async () => {
		const hooks = new HookRegistry()
		const app = createApp(createTestRouter(), createToolRegistry(hooks), hooks, new Database(':memory:'))
		const response = await app.handle(new Request('http://localhost/health'))
		const payload = await response.json() as {
			ok: boolean
			status: string
			uptime: number
			timestamp: string
		}

		expect(response.status).toBe(200)
		expect(payload.ok).toBe(true)
		expect(payload.status).toBe('running')
		expect(typeof payload.uptime).toBe('number')
		expect(typeof payload.timestamp).toBe('string')
	})

	it('GET /unknown returns 404', async () => {
		const hooks = new HookRegistry()
		const app = createApp(createTestRouter(), createToolRegistry(hooks), hooks, new Database(':memory:'))
		const response = await app.handle(new Request('http://localhost/unknown'))
		const payload = await response.json() as {
			ok: boolean
			error: string
		}

		expect(response.status).toBe(404)
		expect(payload.ok).toBe(false)
		expect(typeof payload.error).toBe('string')
	})

	it('should allow tauri://localhost origin', async () => {
		const hooks = new HookRegistry()
		const app = createApp(createTestRouter(), createToolRegistry(hooks), hooks, new Database(':memory:'))
		const response = await app.handle(
			new Request('http://localhost/health', {
				headers: { origin: 'tauri://localhost' },
			})
		)
		expect(response.headers.get('access-control-allow-origin')).toBe('tauri://localhost')
	})
})

describe('Project routes', () => {
	it('GET /api/projects returns 200 with empty array', async () => {
		const { app } = createTestApp()
		const response = await app.handle(new Request('http://localhost/api/projects'))
		const payload = await response.json() as unknown[]

		expect(response.status).toBe(200)
		expect(Array.isArray(payload)).toBe(true)
		expect(payload.length).toBe(0)
	})

	it('POST /api/projects with valid body creates project', async () => {
		const { app } = createTestApp()
		const body = JSON.stringify({ path: '/tmp/test-project' })
		const response = await app.handle(
			new Request('http://localhost/api/projects', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body,
			})
		)

		// Returns 201 on creation or 200 if idempotent
		expect([200, 201]).toContain(response.status)
		const payload = await response.json() as Record<string, unknown>
		expect(payload).toBeDefined()
	})

	it('POST /api/projects with invalid body returns 400', async () => {
		const { app } = createTestApp()
		const body = JSON.stringify({})
		const response = await app.handle(
			new Request('http://localhost/api/projects', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body,
			})
		)

		expect(response.status).toBe(400)
		const payload = await response.json() as { error: string }
		expect(payload.error).toBeDefined()
	})

	it('PUT /api/projects/:id returns 404 for non-existent project', async () => {
		const { app } = createTestApp()
		const body = JSON.stringify({ name: 'updated' })
		const response = await app.handle(
			new Request('http://localhost/api/projects/non-existent-id', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body,
			})
		)

		expect(response.status).toBe(404)
	})

	it('DELETE /api/projects/:id returns 404 for non-existent project', async () => {
		const { app } = createTestApp()
		const response = await app.handle(
			new Request('http://localhost/api/projects/non-existent-id', {
				method: 'DELETE',
			})
		)

		expect(response.status).toBe(404)
	})

	it('GET /api/projects/:id/sessions returns 404 for non-existent project', async () => {
		const { app } = createTestApp()
		const response = await app.handle(
			new Request('http://localhost/api/projects/non-existent-id/sessions')
		)

		expect(response.status).toBe(404)
	})

	it('POST /api/projects/:id/sessions returns 404 for non-existent project', async () => {
		const { app } = createTestApp()
		const response = await app.handle(
			new Request('http://localhost/api/projects/non-existent-id/sessions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			})
		)

		expect(response.status).toBe(404)
	})

	it('full CRUD lifecycle: create → list → update → delete', async () => {
		const { app } = createTestApp()

		// Create
		const createRes = await app.handle(
			new Request('http://localhost/api/projects', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ path: '/tmp/crud-test-project' }),
			})
		)
		expect([200, 201]).toContain(createRes.status)
		const created = await createRes.json() as { id: string }
		expect(created.id).toBeDefined()

		// List — should contain the created project
		const listRes = await app.handle(new Request('http://localhost/api/projects'))
		expect(listRes.status).toBe(200)
		const projects = await listRes.json() as { id: string }[]
		expect(projects.some((p) => p.id === created.id)).toBe(true)

		// Update
		const updateRes = await app.handle(
			new Request(`http://localhost/api/projects/${created.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'updated-name' }),
			})
		)
		expect(updateRes.status).toBe(200)
		const updated = await updateRes.json() as { ok: boolean }
		expect(updated.ok).toBe(true)

		// Delete
		const deleteRes = await app.handle(
			new Request(`http://localhost/api/projects/${created.id}`, {
				method: 'DELETE',
			})
		)
		expect(deleteRes.status).toBe(204)

		// Verify deletion — list should no longer contain it
		const listAfterRes = await app.handle(new Request('http://localhost/api/projects'))
		const projectsAfter = await listAfterRes.json() as { id: string }[]
		expect(projectsAfter.some((p) => p.id === created.id)).toBe(false)
	})

	it('sessions CRUD: create project → create session → list sessions', async () => {
		const { app } = createTestApp()

		// Create project first
		const createRes = await app.handle(
			new Request('http://localhost/api/projects', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ path: '/tmp/session-test-project' }),
			})
		)
		expect([200, 201]).toContain(createRes.status)
		const project = await createRes.json() as { id: string }

		// Create session
		const createSessionRes = await app.handle(
			new Request(`http://localhost/api/projects/${project.id}/sessions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			})
		)
		expect(createSessionRes.status).toBe(201)
		const session = await createSessionRes.json() as { ok: boolean; data: { id: string } }
		expect(session.ok).toBe(true)
		expect(session.data.id).toBeDefined()

		// List sessions
		const listSessionsRes = await app.handle(
			new Request(`http://localhost/api/projects/${project.id}/sessions`)
		)
		expect(listSessionsRes.status).toBe(200)
		const sessions = await listSessionsRes.json() as { ok: boolean; data: unknown[] }
		expect(sessions.ok).toBe(true)
		expect(sessions.data.length).toBe(1)
	})
})
