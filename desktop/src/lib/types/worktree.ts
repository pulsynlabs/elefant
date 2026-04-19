export interface WorktreeSummary {
	path: string
	head: string
	branch: string | null
	isDetached: boolean
	isBare: boolean
	isLocked: boolean
	lockReason?: string
	isPrunable: boolean
	isDirty: boolean
}

export interface WorktreeError {
	code: string
	message: string
	stderr?: string
	exitCode?: number
}

export type WorktreeDaemonResult<T> =
	| { ok: true; data: T }
	| { ok: false; error: WorktreeError | string }

export interface CreateWorktreeInput {
	targetPath: string
	branch: string
	base?: string
}
