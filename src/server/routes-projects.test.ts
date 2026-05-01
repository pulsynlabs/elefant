import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';

import { Database } from '../db/database.ts';
import { getProjectByPath, getProjectById, insertProject } from '../db/repo/projects.ts';
import { ProjectManager } from '../project/manager.ts';
import type { ProjectInfo } from '../project/types.ts';
import { ok } from '../types/result.ts';
import {
  mountProjectsCreateRoute,
  mountProjectsSessionsRoutes,
  mountProjectsUpdateRoute,
  mountProjectsDeleteRoute,
} from './routes-projects.ts';

const originalBootstrap = ProjectManager.bootstrap;

describe('mountProjectsCreateRoute', () => {
	let db: Database;
	let app: Elysia;
	let bootstrapCalls: string[];

	beforeEach(() => {
		db = new Database(':memory:');
		app = new Elysia();
		mountProjectsCreateRoute(app, db);
		bootstrapCalls = [];

		ProjectManager.bootstrap = async (projectPath: string) => {
			bootstrapCalls.push(projectPath);

			const info: ProjectInfo = {
				projectId: `mock-${projectPath}`,
				projectPath,
				elefantDir: `${projectPath}/.elefant`,
				dbPath: `${projectPath}/.elefant/elefant.db`,
				statePath: `${projectPath}/.elefant/state.json`,
				logsDir: `${projectPath}/.elefant/logs`,
				checkpointsDir: `${projectPath}/.elefant/checkpoints`,
				memoryDir: `${projectPath}/.elefant/memory`,
			};

			return ok(info);
		};
	});

	afterEach(() => {
		ProjectManager.bootstrap = originalBootstrap;
		db.close();
	});

	it('returns 201 and creates a project on first POST', async () => {
		const path = '/tmp/elefant-project-a';
		const response = await app.handle(
			new Request('http://localhost/api/projects', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ path, name: 'Project A' }),
			}),
		);

		const body = (await response.json()) as { id: string; name: string; path: string };

		expect(response.status).toBe(201);
		expect(body.id).toBeString();
		expect(body.name).toBe('Project A');
		expect(body.path).toBe(path);
		expect(bootstrapCalls).toEqual([path]);

		const projectInDb = getProjectByPath(db, path);
		expect(projectInDb.ok).toBe(true);
		if (projectInDb.ok) {
			expect(projectInDb.data?.id).toBe(body.id);
		}
	});

	it('returns 200 and same row for duplicate path', async () => {
		const path = '/tmp/elefant-project-b';

		const firstResponse = await app.handle(
			new Request('http://localhost/api/projects', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ path, name: 'Project B' }),
			}),
		);
		const firstBody = (await firstResponse.json()) as { id: string; path: string };

		const secondResponse = await app.handle(
			new Request('http://localhost/api/projects', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ path, name: 'Ignored on second call' }),
			}),
		);
		const secondBody = (await secondResponse.json()) as { id: string; path: string };

		expect(firstResponse.status).toBe(201);
		expect(secondResponse.status).toBe(200);
		expect(secondBody.id).toBe(firstBody.id);
		expect(secondBody.path).toBe(path);
		expect(bootstrapCalls).toEqual([path]);

		const countRow = db.db
			.query('SELECT COUNT(*) as count FROM projects WHERE path = ?')
			.get(path) as { count: number };
		expect(countRow.count).toBe(1);
	});

	it('returns 400 when path is missing', async () => {
		const response = await app.handle(
			new Request('http://localhost/api/projects', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({}),
			}),
		);

		expect(response.status).toBe(400);
		expect(bootstrapCalls).toEqual([]);
	});

	it('defaults name to basename(path) when name is omitted', async () => {
		const path = '/tmp/elefant-basename-default';

		const response = await app.handle(
			new Request('http://localhost/api/projects', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ path }),
			}),
		);

		const body = (await response.json()) as { name: string; path: string };

		expect(response.status).toBe(201);
		expect(body.path).toBe(path);
		expect(body.name).toBe('elefant-basename-default');
	});
});

describe('mountProjectsSessionsRoutes', () => {
	let db: Database;
	let app: Elysia;
	let testProjectId: string;

	beforeEach(() => {
		db = new Database(':memory:');
		app = new Elysia();
		mountProjectsSessionsRoutes(app, db);

		// Insert a test project
		const id = crypto.randomUUID();
		db.db.run(
			'INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)',
			[id, 'Test Project', '/tmp/test-project', 'A test project'],
		);
		testProjectId = id;
	});

	afterEach(() => {
		db.close();
	});

	describe('GET /api/projects/:id/sessions', () => {
		it('returns 200 with empty array for project with no sessions', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/projects/${testProjectId}/sessions`),
			);
			const payload = (await response.json()) as { ok: boolean; data: unknown[] };

			expect(response.status).toBe(200);
			expect(payload.ok).toBe(true);
			expect(Array.isArray(payload.data)).toBe(true);
			expect(payload.data).toHaveLength(0);
		});

		it('returns 200 with sessions array for project with sessions', async () => {
			// Insert a session directly
			const sessionId = crypto.randomUUID();
			db.db.run(
				"INSERT INTO sessions (id, project_id, workflow_id, mode, phase, status, started_at, completed_at) VALUES (?, ?, ?, 'spec', ?, ?, ?, ?)",
				[sessionId, testProjectId, null, 'idle', 'pending', new Date().toISOString(), null],
			);

			const response = await app.handle(
				new Request(`http://localhost/api/projects/${testProjectId}/sessions`),
			);
			const payload = (await response.json()) as { ok: boolean; data: { mode: string }[] };

			expect(response.status).toBe(200);
			expect(payload.ok).toBe(true);
			expect(payload.data).toHaveLength(1);
			expect(payload.data[0].mode).toBe('spec');
		});

		it('returns 404 for missing project', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/projects/nonexistent-id/sessions'),
			);
			const payload = (await response.json()) as { ok: boolean; error: string };

			expect(response.status).toBe(404);
			expect(payload.ok).toBe(false);
			expect(typeof payload.error).toBe('string');
		});
	});

	describe('POST /api/projects/:id/sessions', () => {
		it('returns 201 with new session for valid project', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/projects/${testProjectId}/sessions`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({}),
				}),
			);
			const payload = (await response.json()) as {
				ok: boolean;
				data: { id: string; projectId: string; mode: string };
			};

			expect(response.status).toBe(201);
			expect(payload.ok).toBe(true);
			expect(typeof payload.data.id).toBe('string');
			expect(payload.data.projectId).toBe(testProjectId);
			expect(payload.data.mode).toBe('quick');
		});

		it('returns 201 with mode=spec when requested', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/projects/${testProjectId}/sessions`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ mode: 'spec' }),
				}),
			);
			const payload = (await response.json()) as {
				ok: boolean;
				data: { id: string; mode: string };
			};

			expect(response.status).toBe(201);
			expect(payload.ok).toBe(true);
			expect(payload.data.mode).toBe('spec');
		});

		it('returns 201 with mode=quick when requested', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/projects/${testProjectId}/sessions`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ mode: 'quick' }),
				}),
			);
			const payload = (await response.json()) as {
				ok: boolean;
				data: { id: string; mode: string };
			};

			expect(response.status).toBe(201);
			expect(payload.ok).toBe(true);
			expect(payload.data.mode).toBe('quick');
		});

		it('returns 400 when mode is invalid', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/projects/${testProjectId}/sessions`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ mode: 'invalid' }),
				}),
			);
			const payload = (await response.json()) as { error: string; message: string };

			expect(response.status).toBe(400);
			expect(payload.error).toBe('VALIDATION_ERROR');
			expect(typeof payload.message).toBe('string');
		});

		it('returns 400 when title is not a string', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/projects/${testProjectId}/sessions`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ title: 123 }),
				}),
			);
			const payload = (await response.json()) as { error: string; message: string };

			expect(response.status).toBe(400);
			expect(payload.error).toBe('VALIDATION_ERROR');
			expect(typeof payload.message).toBe('string');
		});

		it('returns 404 for missing project', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/projects/nonexistent-id/sessions', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({}),
				}),
			);
			const payload = (await response.json()) as { ok: boolean; error: string };

			expect(response.status).toBe(404);
			expect(payload.ok).toBe(false);
			expect(typeof payload.error).toBe('string');
		});
	});
});

// ─── PUT /api/projects/:id ───────────────────────────────────────────────────

describe('PUT /api/projects/:id', () => {
	let db: Database;
	let app: Elysia;
	let projectId: string;

	afterEach(() => {
		db.close();
	});

	it('returns 200 with updated project when valid id and name provided', async () => {
		db = new Database(':memory:');
		app = new Elysia();
		mountProjectsUpdateRoute(app, db);

		projectId = crypto.randomUUID();
		const inserted = insertProject(db, {
			id: projectId,
			name: 'Original Name',
			path: '/tmp/test',
		});
		expect(inserted.ok).toBe(true);

		const response = await app.handle(
			new Request(`http://localhost/api/projects/${projectId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'Updated Name' }),
			}),
		);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as { ok: boolean; data: { name: string } };
		expect(payload.ok).toBe(true);
		expect(payload.data.name).toBe('Updated Name');
	});

	it('returns 200 with updated description when provided', async () => {
		db = new Database(':memory:');
		app = new Elysia();
		mountProjectsUpdateRoute(app, db);

		projectId = crypto.randomUUID();
		insertProject(db, { id: projectId, name: 'Test', path: '/tmp/test' });

		const response = await app.handle(
			new Request(`http://localhost/api/projects/${projectId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ description: 'A new description' }),
			}),
		);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as { ok: boolean; data: { description: string | null } };
		expect(payload.ok).toBe(true);
		expect(payload.data.description).toBe('A new description');
	});

	it('returns 404 when project id does not exist', async () => {
		db = new Database(':memory:');
		app = new Elysia();
		mountProjectsUpdateRoute(app, db);

		const response = await app.handle(
			new Request('http://localhost/api/projects/nonexistent-id', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'Whatever' }),
			}),
		);

		expect(response.status).toBe(404);
		const payload = (await response.json()) as { ok: boolean; error: string };
		expect(payload.ok).toBe(false);
		expect(typeof payload.error).toBe('string');
	});
});

// ─── DELETE /api/projects/:id ────────────────────────────────────────────────

describe('DELETE /api/projects/:id', () => {
	let db: Database;
	let app: Elysia;
	let projectId: string;

	afterEach(() => {
		db.close();
	});

	it('returns 204 and removes row from DB when valid id provided', async () => {
		db = new Database(':memory:');
		app = new Elysia();
		mountProjectsDeleteRoute(app, db);

		projectId = crypto.randomUUID();
		insertProject(db, { id: projectId, name: 'To Delete', path: '/tmp/delete-me' });

		const deleteResponse = await app.handle(
			new Request(`http://localhost/api/projects/${projectId}`, {
				method: 'DELETE',
			}),
		);

		expect(deleteResponse.status).toBe(204);

		// Verify row is gone via getProjectById
		const afterDelete = getProjectById(db, projectId);
		expect(afterDelete.ok).toBe(false);
		if (afterDelete.ok) return;
		expect(afterDelete.error.code).toBe('FILE_NOT_FOUND');
	});

	it('returns 404 when project id does not exist', async () => {
		db = new Database(':memory:');
		app = new Elysia();
		mountProjectsDeleteRoute(app, db);

		const response = await app.handle(
			new Request('http://localhost/api/projects/nonexistent-id', {
				method: 'DELETE',
			}),
		);

		expect(response.status).toBe(404);
		const payload = (await response.json()) as { ok: boolean; error: string };
		expect(payload.ok).toBe(false);
		expect(typeof payload.error).toBe('string');
	});
});
