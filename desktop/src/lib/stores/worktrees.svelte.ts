import { DAEMON_URL } from '$lib/daemon/client.js'
import type {
	CreateWorktreeInput,
	WorktreeDaemonResult,
	WorktreeSummary,
} from '$lib/types/worktree.js'

let byProjectId = $state<Record<string, WorktreeSummary[]>>({})
let activeWorktreeId = $state<string | null>(null)
let isLoadingByProject = $state<Record<string, boolean>>({})
let lastError = $state<string | null>(null)

function clearError(): void {
	lastError = null
}

function setError(message: string): void {
	lastError = message
	console.error('[worktrees]', message)
}

function resolveErrorMessage(error: unknown): string {
	if (typeof error === 'string') {
		return error
	}

	if (
		typeof error === 'object' &&
		error !== null &&
		'message' in error &&
		typeof error.message === 'string'
	) {
		return error.message
	}

	return 'Unknown worktree error'
}

async function readResult<T>(response: Response, label: string): Promise<T> {
	if (!response.ok) {
		const text = await response.text().catch(() => '')
		try {
			const parsed = JSON.parse(text) as WorktreeDaemonResult<T>
			if (!parsed.ok) {
				throw new Error(resolveErrorMessage(parsed.error))
			}
		} catch {
			throw new Error(`${label}: HTTP ${response.status}`)
		}
	}

	const parsed = (await response.json()) as WorktreeDaemonResult<T>
	if (!parsed.ok) {
		throw new Error(resolveErrorMessage(parsed.error))
	}

	return parsed.data
}

export async function refresh(projectId: string): Promise<void> {
	isLoadingByProject = { ...isLoadingByProject, [projectId]: true }
	clearError()

	try {
		const response = await fetch(
			`${DAEMON_URL}/api/projects/${encodeURIComponent(projectId)}/worktrees`,
			{ headers: { Accept: 'application/json' } },
		)

		const data = await readResult<WorktreeSummary[]>(
			response,
			`GET /api/projects/${projectId}/worktrees`,
		)

		byProjectId = { ...byProjectId, [projectId]: data }
	} catch (error) {
		setError(error instanceof Error ? error.message : 'Failed to refresh worktrees')
	} finally {
		isLoadingByProject = { ...isLoadingByProject, [projectId]: false }
	}
}

export async function create(projectId: string, opts: CreateWorktreeInput): Promise<WorktreeSummary | null> {
	clearError()

	const optimistic: WorktreeSummary = {
		path: opts.targetPath,
		head: '',
		branch: opts.branch,
		isDetached: false,
		isBare: false,
		isLocked: false,
		isPrunable: false,
		isDirty: false,
	}

	const previous = byProjectId[projectId] ?? []
	byProjectId = {
		...byProjectId,
		[projectId]: [optimistic, ...previous],
	}

	try {
		const response = await fetch(
			`${DAEMON_URL}/api/projects/${encodeURIComponent(projectId)}/worktrees`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(opts),
			},
		)

		const created = await readResult<WorktreeSummary>(
			response,
			`POST /api/projects/${projectId}/worktrees`,
		)

		const updated = (byProjectId[projectId] ?? []).map((entry) =>
			entry.path === opts.targetPath ? created : entry,
		)
		byProjectId = { ...byProjectId, [projectId]: updated }
		return created
	} catch (error) {
		byProjectId = { ...byProjectId, [projectId]: previous }
		setError(error instanceof Error ? error.message : 'Failed to create worktree')
		return null
	}
}

export async function remove(projectId: string, targetPath: string, force = false): Promise<boolean> {
	clearError()

	const previous = byProjectId[projectId] ?? []
	const filtered = previous.filter((entry) => entry.path !== targetPath)
	byProjectId = { ...byProjectId, [projectId]: filtered }

	if (activeWorktreeId === targetPath) {
		activeWorktreeId = filtered[0]?.path ?? null
	}

	try {
		const response = await fetch(
			`${DAEMON_URL}/api/projects/${encodeURIComponent(projectId)}/worktrees`,
			{
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ targetPath, force }),
			},
		)

		await readResult<null>(response, `DELETE /api/projects/${projectId}/worktrees`)
		return true
	} catch (error) {
		byProjectId = { ...byProjectId, [projectId]: previous }
		setError(error instanceof Error ? error.message : 'Failed to delete worktree')
		return false
	}
}

export async function prune(projectId: string): Promise<boolean> {
	clearError()

	try {
		const response = await fetch(
			`${DAEMON_URL}/api/projects/${encodeURIComponent(projectId)}/worktrees/prune`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			},
		)

		await readResult<null>(response, `POST /api/projects/${projectId}/worktrees/prune`)
		await refresh(projectId)
		return true
	} catch (error) {
		setError(error instanceof Error ? error.message : 'Failed to prune worktrees')
		return false
	}
}

export function setActiveWorktree(worktreePath: string | null): void {
	activeWorktreeId = worktreePath
}

export function resetWorktreesStore(): void {
	byProjectId = {}
	activeWorktreeId = null
	isLoadingByProject = {}
	lastError = null
}

export function _setWorktrees(projectId: string, worktrees: WorktreeSummary[]): void {
	byProjectId = { ...byProjectId, [projectId]: worktrees }
}

export const worktreesStore = {
	get byProjectId() {
		return byProjectId
	},
	get activeWorktreeId() {
		return activeWorktreeId
	},
	get isLoadingByProject() {
		return isLoadingByProject
	},
	get lastError() {
		return lastError
	},
	refresh,
	create,
	delete: remove,
	prune,
	setActiveWorktree,
	resetWorktreesStore,
	_setWorktrees,
}
