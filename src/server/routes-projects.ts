import type { Elysia } from 'elysia';
import type { SseManager } from '../transport/sse-manager.ts';
import type { Database } from '../db/database.ts';
import { z } from 'zod';
import { basename } from 'node:path';
import { ProjectManager } from '../project/manager.ts';
import {
	getProjectById,
	getProjectByPath,
	updateProject,
	deleteProject,
	listProjects,
	insertProject,
} from '../db/repo/projects.ts';
import { insertSession, listSessionsByProject } from '../db/repo/sessions.ts';
import type { ElefantError } from '../types/errors.ts';

const ProjectCreateBodySchema = z.object({
	path: z.string().min(1),
	name: z.string().optional(),
});

function mapErrorToStatus(error: ElefantError): number {
	if (error.code === 'VALIDATION_ERROR') {
		return 400;
	}

	if (error.code === 'FILE_NOT_FOUND') {
		return 404;
	}

	return 500;
}

export function mountProjectsCreateRoute(app: Elysia, db: Database): Elysia {
	return app.post('/api/projects', async ({ body, set }) => {
		const parsed = ProjectCreateBodySchema.safeParse(body);
		if (!parsed.success) {
			set.status = 400;
			return {
				error: 'Invalid request body',
				code: 'VALIDATION_ERROR',
				details: parsed.error.issues,
			};
		}

		const { path, name } = parsed.data;
		const existing = getProjectByPath(db, path);
		if (!existing.ok) {
			set.status = mapErrorToStatus(existing.error);
			return {
				error: existing.error.message,
				code: existing.error.code,
				details: existing.error.details,
			};
		}

		if (existing.data) {
			set.status = 200;
			return existing.data;
		}

		const bootstrapResult = await ProjectManager.bootstrap(path);
		if (!bootstrapResult.ok) {
			set.status = mapErrorToStatus(bootstrapResult.error);
			return {
				error: bootstrapResult.error.message,
				code: bootstrapResult.error.code,
				details: bootstrapResult.error.details,
			};
		}

		const timestamp = new Date().toISOString();
		const insertResult = insertProject(db, {
			id: crypto.randomUUID(),
			name: (name ?? basename(path)) || path,
			path,
			description: null,
			created_at: timestamp,
			updated_at: timestamp,
		});

		if (!insertResult.ok) {
			set.status = mapErrorToStatus(insertResult.error);
			return {
				error: insertResult.error.message,
				code: insertResult.error.code,
				details: insertResult.error.details,
			};
		}

		set.status = 201;
		return insertResult.data;
	});
}

export function mountProjectEventsRoute(app: Elysia, sse: SseManager): Elysia {
	return app.get('/api/projects/:id/events', ({ params, request }) => {
		const lastEventId = request.headers.get('Last-Event-ID') ?? undefined;
		return sse.subscribe(params.id, lastEventId);
	});
}

export function mountProjectsListRoute(app: Elysia, db: Database): Elysia {
	return app.get('/api/projects', () => {
		const result = listProjects(db);
		if (result.ok) {
			return result.data;
		}
		return { error: result.error.message };
	});
}

const ProjectUpdateBodySchema = z.object({
	name: z.string().optional(),
	description: z.string().optional(),
});

export function mountProjectsUpdateRoute(app: Elysia, db: Database): Elysia {
	return app.put('/api/projects/:id', ({ params, body, set }) => {
		const parsed = ProjectUpdateBodySchema.safeParse(body);
		if (!parsed.success) {
			set.status = 400;
			return { ok: false, error: parsed.error.message };
		}

		const existing = getProjectById(db, params.id);
		if (!existing.ok) {
			set.status = 404;
			return { ok: false, error: existing.error.message };
		}

		const updated = updateProject(db, { id: params.id, ...parsed.data });
		if (!updated.ok) {
			set.status = 500;
			return { ok: false, error: updated.error.message };
		}

		return { ok: true, data: updated.data };
	});
}

export function mountProjectsDeleteRoute(app: Elysia, db: Database): Elysia {
	return app.delete('/api/projects/:id', ({ params, set }) => {
		const existing = getProjectById(db, params.id);
		if (!existing.ok) {
			set.status = 404;
			return { ok: false, error: existing.error.message };
		}

		const result = deleteProject(db, params.id);
		if (!result.ok) {
			set.status = 500;
			return { ok: false, error: result.error.message };
		}

		set.status = 204;
		return undefined;
	});
}

export function mountProjectsSessionsRoutes(app: Elysia, db: Database): Elysia {
	return app
		.get('/api/projects/:id/sessions', ({ params, set }) => {
			const project = getProjectById(db, params.id);
			if (!project.ok) {
				set.status = 404;
				return { ok: false, error: project.error.message };
			}

			const sessions = listSessionsByProject(db, params.id, 10);
			if (!sessions.ok) {
				set.status = 500;
				return { ok: false, error: sessions.error.message };
			}

			return { ok: true, data: sessions.data };
		})
		.post('/api/projects/:id/sessions', ({ params, set }) => {
			const project = getProjectById(db, params.id);
			if (!project.ok) {
				set.status = 404;
				return { ok: false, error: project.error.message };
			}

			const session = insertSession(db, {
				id: crypto.randomUUID(),
				project_id: params.id,
			});

			if (!session.ok) {
				set.status = 500;
				return { ok: false, error: session.error.message };
			}

			set.status = 201;
			return { ok: true, data: session.data };
		});
}

/**
 * Mount all project-related routes in a single call.
 * Chains create, list, update, delete, and sessions routes.
 * Note: events route requires SseManager and is mounted separately.
 */
export function mountProjectsRoutes(app: Elysia, db: Database): Elysia {
	mountProjectsCreateRoute(app, db);
	mountProjectsListRoute(app, db);
	mountProjectsUpdateRoute(app, db);
	mountProjectsDeleteRoute(app, db);
	mountProjectsSessionsRoutes(app, db);
	return app;
}
