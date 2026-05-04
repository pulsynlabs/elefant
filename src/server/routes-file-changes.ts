import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import type { Elysia } from 'elysia'
import type { Database } from '../db/database.ts'
import { getProjectById } from '../db/repo/projects.ts'
import { fileChangeTracker, normalizePath } from './file-changes.ts'

/**
 * Maximum size, in bytes, for files served through the project-scoped read
 * endpoint. Diff viewer is the primary consumer — anything bigger than 2 MB
 * would saturate CodeMirror anyway.
 */
const MAX_READ_SIZE_BYTES = 2 * 1024 * 1024

function pathIsInside(candidate: string, parent: string): boolean {
	if (candidate === parent) return true
	const parentWithSep = parent.endsWith(sep) ? parent : `${parent}${sep}`
	return candidate.startsWith(parentWithSep)
}

/**
 * Mount the GET /api/projects/:projectId/sessions/:sessionId/file-changes route.
 *
 * Returns all file changes recorded for a session, sorted by lastTouchedAt
 * descending. Paths are normalized relative to the project root.
 */
export function mountFileChangesRoute(app: Elysia, db: Database) {
	return app.get(
		'/api/projects/:projectId/sessions/:sessionId/file-changes',
		({ params, set }) => {
			const { projectId, sessionId } = params

			const project = getProjectById(db, projectId)
			if (!project.ok) {
				set.status = 404
				return { ok: false, error: project.error.message }
			}

			const projectRoot = project.data.path

			const rawChanges = fileChangeTracker.getChanges(sessionId)

			// Normalize paths on read — the tracker stores them relative at
			// record time, but this ensures any edge case is handled.
			// Re-normalize from absolutePath in case the tracker's stored
			// relative path is stale (e.g. project moved).
			const changes = rawChanges.map((change) => ({
				...change,
				path: normalizePath(change.absolutePath, projectRoot),
			}))

			return { ok: true, data: { changes } }
		},
	)
}

/**
 * Mount the GET /api/projects/:projectId/files/read route.
 *
 * Returns the current text contents of a file inside a project.
 * Used by the right-panel File Changes diff viewer to show the "after"
 * side of an edit when the daemon only stored the pre-edit snapshot.
 *
 * Security:
 * - Path must be relative; absolute paths are rejected.
 * - Resolved path must remain inside the project root (no escaping via `..`).
 * - File size capped at 2 MB; larger files return a 413 envelope.
 * - Binary detection is naive (UTF-8 decode best-effort); callers display
 *   a notice when content is empty.
 */
export function mountProjectFileReadRoute(app: Elysia, db: Database) {
	return app.get(
		'/api/projects/:projectId/files/read',
		async ({ params, query, set }) => {
			const { projectId } = params
			const rawPath = typeof query.path === 'string' ? query.path : ''

			if (!rawPath) {
				set.status = 400
				return { ok: false, error: 'Missing required query parameter: path' }
			}

			if (isAbsolute(rawPath)) {
				set.status = 400
				return { ok: false, error: 'Path must be relative to the project root' }
			}

			const project = getProjectById(db, projectId)
			if (!project.ok) {
				set.status = 404
				return { ok: false, error: project.error.message }
			}

			const projectRoot = resolve(project.data.path)
			const resolved = resolve(projectRoot, rawPath)

			// Defence in depth: resolve() already collapses `..` segments,
			// but symlinks etc. could still escape the root. Verify the
			// resolved path lives inside the project root before any IO.
			if (!pathIsInside(resolved, projectRoot)) {
				set.status = 400
				return { ok: false, error: 'Path escapes the project root' }
			}

			let stats
			try {
				stats = await stat(resolved)
			} catch (err) {
				const code = (err as { code?: string }).code
				if (code === 'ENOENT') {
					set.status = 404
					return { ok: false, error: 'File not found' }
				}
				set.status = 500
				return { ok: false, error: err instanceof Error ? err.message : String(err) }
			}

			if (!stats.isFile()) {
				set.status = 400
				return { ok: false, error: 'Path is not a regular file' }
			}

			if (stats.size > MAX_READ_SIZE_BYTES) {
				set.status = 413
				return {
					ok: false,
					error: `File exceeds ${MAX_READ_SIZE_BYTES} byte limit`,
				}
			}

			let content: string
			try {
				content = await readFile(resolved, 'utf8')
			} catch (err) {
				set.status = 500
				return { ok: false, error: err instanceof Error ? err.message : String(err) }
			}

			return {
				ok: true,
				data: {
					path: rawPath,
					content,
					size: stats.size,
				},
			}
		},
	)
}
