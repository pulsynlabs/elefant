import { resolve } from 'node:path'

import { err, ok } from '../types/result.js'
import { runGit } from './git.js'
import { parsePorcelainStatus, parseWorktreeList } from './parse.js'
import type { WorktreeError, WorktreeResult, WorktreeSummary } from './types.js'

function toWorktreeError(error: {
	code: string
	message: string
	stderr?: string
	exitCode?: number
}): WorktreeError {
	return {
		code: error.code as WorktreeError['code'],
		message: error.message,
		stderr: error.stderr,
		exitCode: error.exitCode,
	}
}

function mapCreateError(error: WorktreeError): WorktreeError {
	const stderr = error.stderr ?? ''

	if (/already checked out/i.test(stderr)) {
		return { ...error, code: 'branch_exists' }
	}

	if (/a branch named .* already exists/i.test(stderr)) {
		return { ...error, code: 'branch_exists' }
	}

	if (/already exists/i.test(stderr)) {
		return { ...error, code: 'worktree_exists' }
	}

	if (/already a worktree/i.test(stderr)) {
		return { ...error, code: 'path_conflict' }
	}

	return error
}

export async function listWorktrees(projectPath: string): Promise<WorktreeResult<WorktreeSummary[]>> {
	const listed = await runGit(['worktree', 'list', '--porcelain'], {
		cwd: projectPath,
	})

	if (!listed.ok) {
		return err(toWorktreeError(listed.error))
	}

	const summaries = parseWorktreeList(listed.data.stdout)

	for (let index = 0; index < summaries.length; index += 1) {
		const current = summaries[index]
		if (current.isBare || current.isPrunable) {
			continue
		}

		const status = await runGit(['status', '--porcelain'], {
			cwd: current.path,
		})

		if (!status.ok) {
			return err(toWorktreeError(status.error))
		}

		const parsed = parsePorcelainStatus(status.data.stdout)
		summaries[index] = {
			...current,
			isDirty: !parsed.clean,
		}
	}

	return ok(summaries)
}

export async function createWorktree(opts: {
	projectPath: string
	targetPath: string
	branch: string
	base?: string
}): Promise<WorktreeResult<WorktreeSummary>> {
	const args = ['worktree', 'add', opts.targetPath, '-b', opts.branch]
	if (opts.base) {
		args.push(opts.base)
	}

	const created = await runGit(args, { cwd: opts.projectPath })
	if (!created.ok) {
		return err(mapCreateError(toWorktreeError(created.error)))
	}

	const listed = await listWorktrees(opts.projectPath)
	if (!listed.ok) {
		return err(listed.error)
	}

	const targetPath = resolve(opts.targetPath)
	const createdSummary = listed.data.find((item) => resolve(item.path) === targetPath)

	if (!createdSummary) {
		return err({
			code: 'path_conflict',
			message: `Created worktree at ${opts.targetPath} but it was not found in list output`,
		})
	}

	return ok(createdSummary)
}

export async function deleteWorktree(opts: {
	projectPath: string
	targetPath: string
	force?: boolean
}): Promise<WorktreeResult<void>> {
	if (!opts.force) {
		const status = await runGit(['status', '--porcelain'], {
			cwd: opts.targetPath,
		})

		if (!status.ok) {
			return err(toWorktreeError(status.error))
		}

		const parsed = parsePorcelainStatus(status.data.stdout)
		if (!parsed.clean) {
			return err({
				code: 'dirty_worktree',
				message: 'Worktree has uncommitted changes',
			})
		}
	}

	const args = ['worktree', 'remove']
	if (opts.force) {
		args.push('--force')
	}
	args.push(opts.targetPath)

	const removed = await runGit(args, { cwd: opts.projectPath })
	if (!removed.ok) {
		return err(toWorktreeError(removed.error))
	}

	return ok(undefined)
}

export async function pruneWorktrees(projectPath: string): Promise<WorktreeResult<void>> {
	const pruned = await runGit(['worktree', 'prune'], { cwd: projectPath })
	if (!pruned.ok) {
		return err(toWorktreeError(pruned.error))
	}

	return ok(undefined)
}
