import { relative } from 'node:path'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChangeType = 'created' | 'modified' | 'deleted'

export interface FileChange {
	/** Path relative to the project root */
	path: string
	changeType: ChangeType
	/** Absolute path on disk at the time of change */
	absolutePath: string
	/** Timestamp when last touched (Date.now()) */
	lastTouchedAt: number
	/** Content BEFORE the edit (best-effort; only set for 'modified' changes) */
	snapshot?: string
}

// ─── Internal Map Types ───────────────────────────────────────────────────────

type SessionFileChanges = Map<string, FileChange>

// ─── FileChangeTracker ────────────────────────────────────────────────────────

/**
 * In-memory ledger of file create/modify/delete events keyed by sessionId.
 * Entries are derived from tool calls, not filesystem watchers.
 *
 * Each session is capped at 1000 entries — when exceeded, the oldest entry
 * (by lastTouchedAt) is evicted.
 */
export class FileChangeTracker {
	private static readonly MAX_PER_SESSION = 1000

	private changes = new Map<string, SessionFileChanges>()

	/**
	 * Record a file change for a given session.
	 * If the same path already has a recorded change, the newer changeType
	 * takes precedence unless it would downgrade from 'created' to 'modified'.
	 */
	recordChange(sessionId: string, change: FileChange): void {
		let session = this.changes.get(sessionId)
		if (!session) {
			session = new Map()
			this.changes.set(sessionId, session)
		}

		const existing = session.get(change.path)

		// Never downgrade a 'created' to 'modified' — the first sighting of
		// a file in a session is its creation as far as this tracker is concerned.
		if (existing?.changeType === 'created' && change.changeType === 'modified') {
			// Still update lastTouchedAt so the entry stays fresh
			existing.lastTouchedAt = change.lastTouchedAt
			return
		}

		// A subsequent creation (e.g. tool that deletes then re-creates)
		// should overwrite any prior state.
		session.set(change.path, change)
		this.enforceCap(session)
	}

	/**
	 * Return all recorded changes for a session, sorted by lastTouchedAt
	 * descending (most recent first). Returns an empty array if the session
	 * has no recorded changes or does not exist.
	 */
	getChanges(sessionId: string): FileChange[] {
		const session = this.changes.get(sessionId)
		if (!session || session.size === 0) return []
		return [...session.values()].sort((a, b) => b.lastTouchedAt - a.lastTouchedAt)
	}

	/**
	 * Remove all tracked changes for a session.
	 */
	clearSession(sessionId: string): void {
		this.changes.delete(sessionId)
	}

	// ── Private helpers ──────────────────────────────────────────────────────

	/**
	 * Enforce the per-session cap by evicting the oldest entry.
	 */
	private enforceCap(session: SessionFileChanges): void {
		if (session.size <= FileChangeTracker.MAX_PER_SESSION) return

		let oldestKey: string | undefined
		let oldestTime = Infinity

		for (const [key, change] of session) {
			if (change.lastTouchedAt < oldestTime) {
				oldestTime = change.lastTouchedAt
				oldestKey = key
			}
		}

		if (oldestKey !== undefined) {
			session.delete(oldestKey)
		}
	}
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const fileChangeTracker = new FileChangeTracker()

// ─── Path Helpers ─────────────────────────────────────────────────────────────

/**
 * Normalize an absolute path to be relative to the project root.
 * Returns the relative path string. If absolutePath is already relative
 * or outside projectRoot, path.relative handles it naturally.
 */
export function normalizePath(absolutePath: string, projectRoot: string): string {
	return relative(projectRoot, absolutePath)
}
