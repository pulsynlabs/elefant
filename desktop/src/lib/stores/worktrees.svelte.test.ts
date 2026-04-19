import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import type { WorktreeSummary } from '$lib/types/worktree.js'
import { worktreesStore } from './worktrees.svelte.js'

const ORIGINAL_FETCH = globalThis.fetch

const PROJECT_ID = 'project-1'

const EXISTING_WORKTREE: WorktreeSummary = {
	path: '/tmp/existing',
	head: 'abc123',
	branch: 'main',
	isDetached: false,
	isBare: false,
	isLocked: false,
	isPrunable: false,
	isDirty: false,
}

beforeEach(() => {
	worktreesStore.resetWorktreesStore()
	worktreesStore._setWorktrees(PROJECT_ID, [EXISTING_WORKTREE])
})

afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH
	worktreesStore.resetWorktreesStore()
})

describe('worktreesStore', () => {
	it('create keeps optimistic entry on success', async () => {
		globalThis.fetch = mock(async () => {
			return new Response(
				JSON.stringify({
					ok: true,
					data: {
						path: '/tmp/new-worktree',
						head: 'def456',
						branch: 'feature/success',
						isDetached: false,
						isBare: false,
						isLocked: false,
						isPrunable: false,
						isDirty: false,
					},
				}),
				{ status: 201, headers: { 'Content-Type': 'application/json' } },
			)
		}) as unknown as typeof fetch

		const result = await worktreesStore.create(PROJECT_ID, {
			targetPath: '/tmp/new-worktree',
			branch: 'feature/success',
		})

		expect(result).not.toBeNull()
		expect(worktreesStore.byProjectId[PROJECT_ID][0].path).toBe('/tmp/new-worktree')
		expect(worktreesStore.lastError).toBeNull()
	})

	it('delete rolls back on server error', async () => {
		globalThis.fetch = mock(async () => {
			return new Response(
				JSON.stringify({
					ok: false,
					error: {
						code: 'dirty_worktree',
						message: 'Worktree has uncommitted changes',
					},
				}),
				{ status: 409, headers: { 'Content-Type': 'application/json' } },
			)
		}) as unknown as typeof fetch

		const deleted = await worktreesStore.delete(PROJECT_ID, EXISTING_WORKTREE.path)

		expect(deleted).toBe(false)
		expect(worktreesStore.byProjectId[PROJECT_ID]).toHaveLength(1)
		expect(worktreesStore.byProjectId[PROJECT_ID][0].path).toBe(EXISTING_WORKTREE.path)
		expect(worktreesStore.lastError).toContain('dirty')
	})
})
