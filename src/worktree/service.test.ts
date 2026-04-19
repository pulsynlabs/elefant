import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
	createWorktree,
	deleteWorktree,
	listWorktrees,
	pruneWorktrees,
} from './service.js'

const tempDirs: string[] = []

function createTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix))
	tempDirs.push(dir)
	return dir
}

async function runRawGit(args: string[], cwd: string): Promise<void> {
	const process = Bun.spawn(['git', ...args], {
		cwd,
		stdout: 'pipe',
		stderr: 'pipe',
	})

	const [exitCode, stderr] = await Promise.all([
		process.exited,
		new Response(process.stderr).text(),
	])

	if (exitCode !== 0) {
		throw new Error(`git ${args.join(' ')} failed: ${stderr}`)
	}
}

async function seedRepo(baseDir: string): Promise<{ repoPath: string }> {
	const repoPath = join(baseDir, 'repo')
	await runRawGit(['init', repoPath], baseDir)

	await Bun.write(join(repoPath, 'README.md'), '# temp repo\n')
	await runRawGit(['add', 'README.md'], repoPath)
	await runRawGit(
		[
			'-c',
			'user.email=elefant@example.com',
			'-c',
			'user.name=Elefant Test',
			'commit',
			'-m',
			'initial commit',
		],
		repoPath,
	)

	return { repoPath }
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true })
	}
})

describe('worktree service', () => {
	it('supports create -> list -> delete -> prune round-trip', async () => {
		const baseDir = createTempDir('elefant-worktree-service-')
		const { repoPath } = await seedRepo(baseDir)
		const targetPath = join(baseDir, 'repo-feature')

		const created = await createWorktree({
			projectPath: repoPath,
			targetPath,
			branch: 'feature/worktree-test',
		})

		expect(created.ok).toBe(true)
		if (!created.ok) return

		expect(created.data.path).toBe(targetPath)
		expect(created.data.branch).toBe('feature/worktree-test')

		const listed = await listWorktrees(repoPath)
		expect(listed.ok).toBe(true)
		if (!listed.ok) return

		expect(listed.data.some((entry) => entry.path === targetPath)).toBe(true)

		const deleted = await deleteWorktree({ projectPath: repoPath, targetPath })
		expect(deleted.ok).toBe(true)

		expect(existsSync(targetPath)).toBe(false)

		const pruned = await pruneWorktrees(repoPath)
		expect(pruned.ok).toBe(true)
	})

	it('returns dirty_worktree when deleting without force', async () => {
		const baseDir = createTempDir('elefant-worktree-service-dirty-')
		const { repoPath } = await seedRepo(baseDir)
		const targetPath = join(baseDir, 'repo-dirty')

		const created = await createWorktree({
			projectPath: repoPath,
			targetPath,
			branch: 'feature/dirty-delete',
		})
		expect(created.ok).toBe(true)

		await Bun.write(join(targetPath, 'README.md'), '# modified\n')

		const deletedWithoutForce = await deleteWorktree({
			projectPath: repoPath,
			targetPath,
		})
		expect(deletedWithoutForce.ok).toBe(false)
		if (!deletedWithoutForce.ok) {
			expect(deletedWithoutForce.error.code).toBe('dirty_worktree')
		}

		const deletedWithForce = await deleteWorktree({
			projectPath: repoPath,
			targetPath,
			force: true,
		})
		expect(deletedWithForce.ok).toBe(true)
	})

	it('maps duplicate branch creation errors to branch_exists', async () => {
		const baseDir = createTempDir('elefant-worktree-service-branch-')
		const { repoPath } = await seedRepo(baseDir)
		const firstPath = join(baseDir, 'repo-branch-1')
		const secondPath = join(baseDir, 'repo-branch-2')

		const first = await createWorktree({
			projectPath: repoPath,
			targetPath: firstPath,
			branch: 'feature/duplicate-branch',
		})
		expect(first.ok).toBe(true)

		const second = await createWorktree({
			projectPath: repoPath,
			targetPath: secondPath,
			branch: 'feature/duplicate-branch',
		})

		expect(second.ok).toBe(false)
		if (!second.ok) {
			expect(second.error.code).toBe('branch_exists')
		}
	})

	it('returns not_a_repo when project path is not a git repository', async () => {
		const notRepoPath = createTempDir('elefant-worktree-service-not-repo-')

		const listed = await listWorktrees(notRepoPath)
		expect(listed.ok).toBe(false)
		if (!listed.ok) {
			expect(listed.error.code).toBe('not_a_repo')
		}
	})
})
