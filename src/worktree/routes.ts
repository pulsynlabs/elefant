import type { Elysia } from 'elysia'
import { z } from 'zod'

import type { Database } from '../db/database.ts'
import { getProjectById } from '../db/repo/projects.ts'
import {
	createWorktree,
	deleteWorktree,
	listWorktrees,
	pruneWorktrees,
} from './service.js'
import type { WorktreeError } from './types.js'

const CreateWorktreeBodySchema = z.object({
	targetPath: z.string().min(1),
	branch: z.string().min(1),
	base: z.string().min(1).optional(),
})

const DeleteWorktreeBodySchema = z.object({
	targetPath: z.string().min(1),
	force: z.boolean().optional(),
})

function mapErrorStatus(error: WorktreeError): number {
	if (error.code === 'not_a_repo') {
		return 400
	}

	if (error.code === 'worktree_exists' || error.code === 'branch_exists' || error.code === 'path_conflict') {
		return 409
	}

	if (error.code === 'dirty_worktree') {
		return 409
	}

	if (error.code === 'git_unavailable') {
		return 503
	}

	return 500
}

function projectPathFromId(db: Database, projectId: string) {
	const project = getProjectById(db, projectId)
	if (!project.ok) {
		return {
			ok: false as const,
			error: {
				code: 'FILE_NOT_FOUND',
				message: project.error.message,
			},
		}
	}

	return { ok: true as const, data: project.data.path }
}

export function mountWorktreeRoutes(app: Elysia, deps: { db: Database }): Elysia {
	app.get('/api/projects/:projectId/worktrees', async ({ params, set }) => {
		const projectPath = projectPathFromId(deps.db, params.projectId)
		if (!projectPath.ok) {
			set.status = 404
			return { ok: false, error: projectPath.error }
		}

		const result = await listWorktrees(projectPath.data)
		if (!result.ok) {
			set.status = mapErrorStatus(result.error)
			return { ok: false, error: result.error }
		}

		return { ok: true, data: result.data }
	})

	app.post('/api/projects/:projectId/worktrees', async ({ params, body, set }) => {
		const parsedBody = CreateWorktreeBodySchema.safeParse(body)
		if (!parsedBody.success) {
			set.status = 400
			return {
				ok: false,
				error: {
					code: 'VALIDATION_ERROR',
					message: parsedBody.error.message,
				},
			}
		}

		const projectPath = projectPathFromId(deps.db, params.projectId)
		if (!projectPath.ok) {
			set.status = 404
			return { ok: false, error: projectPath.error }
		}

		const result = await createWorktree({
			projectPath: projectPath.data,
			targetPath: parsedBody.data.targetPath,
			branch: parsedBody.data.branch,
			base: parsedBody.data.base,
		})

		if (!result.ok) {
			set.status = mapErrorStatus(result.error)
			return { ok: false, error: result.error }
		}

		set.status = 201
		return { ok: true, data: result.data }
	})

	app.delete('/api/projects/:projectId/worktrees', async ({ params, body, set }) => {
		const parsedBody = DeleteWorktreeBodySchema.safeParse(body)
		if (!parsedBody.success) {
			set.status = 400
			return {
				ok: false,
				error: {
					code: 'VALIDATION_ERROR',
					message: parsedBody.error.message,
				},
			}
		}

		const projectPath = projectPathFromId(deps.db, params.projectId)
		if (!projectPath.ok) {
			set.status = 404
			return { ok: false, error: projectPath.error }
		}

		const result = await deleteWorktree({
			projectPath: projectPath.data,
			targetPath: parsedBody.data.targetPath,
			force: parsedBody.data.force,
		})

		if (!result.ok) {
			set.status = mapErrorStatus(result.error)
			return { ok: false, error: result.error }
		}

		return { ok: true, data: null }
	})

	app.post('/api/projects/:projectId/worktrees/prune', async ({ params, set }) => {
		const projectPath = projectPathFromId(deps.db, params.projectId)
		if (!projectPath.ok) {
			set.status = 404
			return { ok: false, error: projectPath.error }
		}

		const result = await pruneWorktrees(projectPath.data)
		if (!result.ok) {
			set.status = mapErrorStatus(result.error)
			return { ok: false, error: result.error }
		}

		return { ok: true, data: null }
	})

	return app
}
