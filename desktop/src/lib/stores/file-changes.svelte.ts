// File-changes store (Svelte 5 runes).
//
// Tracks the per-session ledger of file create/modify/delete events the
// daemon derives from agent tool calls (Write / Edit / apply_patch).
//
// Lifecycle:
//   1. `setActiveSession(projectId, sessionId)` is called when the user
//      activates a chat session. This bootstraps from
//      `GET /api/projects/:projectId/sessions/:sessionId/file-changes`
//      and subscribes to the project's SSE event stream so future
//      `file.changed` events flow into the ledger live.
//   2. Switching to a different session clears the in-memory list and
//      re-bootstraps; switching to `null` tears the subscription down.
//   3. `fetchFileContent(projectId, path)` reads the current on-disk
//      file content for the diff "after" pane via the project-scoped
//      read route added in src/server/routes-file-changes.ts.
//
// One EventSource per active project — the connection is reused across
// session switches inside the same project to match the broader pattern
// established by `agent-runs.svelte.ts` (see "do not add a new SSE
// connection per run").

import { DAEMON_URL } from '$lib/daemon/client.js';
import { subscribeProjectEvents, type ProjectEvent } from '$lib/daemon/events.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type FileChangeType = 'created' | 'modified' | 'deleted';

/**
 * A single file change as surfaced by the daemon. Mirrors the daemon's
 * `FileChange` shape in src/server/file-changes.ts but only includes the
 * fields the UI needs.
 */
export interface FileChange {
	/** Path relative to the project root. */
	path: string;
	changeType: FileChangeType;
	/** Absolute path on disk at the time the change was recorded. */
	absolutePath?: string;
	/** Wall-clock timestamp of the most recent touch (Date.now()). */
	lastTouchedAt: number;
	/** Pre-edit content snapshot, when available (modified/deleted). */
	snapshot?: string;
}

/** Envelope returned by the bootstrap GET endpoint. */
interface FileChangesResponse {
	ok: true;
	data: { changes: FileChange[] };
}
interface DaemonErrorResponse {
	ok: false;
	error: string;
}

/** Envelope returned by the project-scoped file read endpoint. */
interface FileReadResponse {
	ok: true;
	data: { path: string; content: string; size: number };
}

// ─── Store ───────────────────────────────────────────────────────────────────

class FileChangesStore {
	/**
	 * Live list of changes for the active session. Sorted descending by
	 * `lastTouchedAt` so newest changes appear first inside their group.
	 */
	changes = $state<FileChange[]>([]);

	/** Bootstrap status — used by the UI to show a quiet loading state. */
	isLoading = $state(false);

	/** Last error from bootstrap or content fetch; cleared on next attempt. */
	lastError = $state<string | null>(null);

	// ── Internal subscription bookkeeping ───────────────────────────────────

	#activeProjectId: string | null = null;
	#activeSessionId: string | null = null;
	#unsubscribe: (() => void) | null = null;

	/**
	 * Activate the store for a given (project, session) pair.
	 *
	 * - If both ids match the currently-active session, this is a no-op.
	 * - If the project changed, the previous SSE subscription is torn down.
	 * - Calling with `(null, null)` (or any null) clears state and
	 *   unsubscribes; the panel typically does this when no session is open.
	 *
	 * Safe to call repeatedly from `$effect` blocks — it filters its own
	 * idempotency.
	 */
	setActiveSession(projectId: string | null, sessionId: string | null): void {
		// Idempotent fast path.
		if (
			projectId === this.#activeProjectId &&
			sessionId === this.#activeSessionId
		) {
			return;
		}

		const projectChanged = projectId !== this.#activeProjectId;
		this.#activeProjectId = projectId;
		this.#activeSessionId = sessionId;

		// Either id going null means we have no session to track.
		if (!projectId || !sessionId) {
			this.#teardownSubscription();
			this.changes = [];
			this.lastError = null;
			return;
		}

		// Project changed — drop the old SSE subscription so we don't
		// receive events for a stale project.
		if (projectChanged) {
			this.#teardownSubscription();
		}

		// Always reset the visible list when the session changes; events
		// for the previous session are not relevant to the new one.
		this.changes = [];
		this.lastError = null;

		void this.#bootstrap(projectId, sessionId);
		this.#ensureSubscription(projectId);
	}

	/**
	 * Fetch the current on-disk content of a file inside the active
	 * project. Returns `null` when the path cannot be read (missing file,
	 * size cap, network error). Errors are surfaced through `lastError`
	 * so the diff overlay can display a quiet message instead of crashing.
	 */
	async fetchFileContent(path: string): Promise<string | null> {
		const projectId = this.#activeProjectId;
		if (!projectId) return null;

		const url =
			`${DAEMON_URL}/api/projects/${encodeURIComponent(projectId)}/files/read` +
			`?path=${encodeURIComponent(path)}`;

		try {
			const response = await fetch(url, {
				headers: { Accept: 'application/json' },
			});
			const body = (await response.json()) as
				| FileReadResponse
				| DaemonErrorResponse;
			if (!response.ok || !body.ok) {
				const message =
					!body.ok && typeof body.error === 'string'
						? body.error
						: `HTTP ${response.status}`;
				this.lastError = message;
				return null;
			}
			return body.data.content;
		} catch (err) {
			this.lastError = err instanceof Error ? err.message : String(err);
			return null;
		}
	}

	/** Force a fresh bootstrap from the GET endpoint without changing session. */
	async refresh(): Promise<void> {
		if (!this.#activeProjectId || !this.#activeSessionId) return;
		await this.#bootstrap(this.#activeProjectId, this.#activeSessionId);
	}

	// ── Internals ───────────────────────────────────────────────────────────

	async #bootstrap(projectId: string, sessionId: string): Promise<void> {
		this.isLoading = true;
		this.lastError = null;
		try {
			const url =
				`${DAEMON_URL}/api/projects/${encodeURIComponent(projectId)}` +
				`/sessions/${encodeURIComponent(sessionId)}/file-changes`;
			const response = await fetch(url, {
				headers: { Accept: 'application/json' },
			});
			const body = (await response.json()) as
				| FileChangesResponse
				| DaemonErrorResponse;
			if (!response.ok || !body.ok) {
				const message =
					!body.ok && typeof body.error === 'string'
						? body.error
						: `HTTP ${response.status}`;
				this.lastError = message;
				return;
			}

			// Stale-session guard: by the time the response lands the user
			// may have switched away. Discard if so.
			if (
				this.#activeProjectId !== projectId ||
				this.#activeSessionId !== sessionId
			) {
				return;
			}

			this.changes = sortChanges(body.data.changes);
		} catch (err) {
			this.lastError = err instanceof Error ? err.message : String(err);
		} finally {
			this.isLoading = false;
		}
	}

	#ensureSubscription(projectId: string): void {
		if (this.#unsubscribe) return;
		const dispose = subscribeProjectEvents(
			String(DAEMON_URL),
			projectId,
			(event) => this.#onProjectEvent(event),
		);
		this.#unsubscribe = dispose;
	}

	#teardownSubscription(): void {
		if (this.#unsubscribe) {
			try {
				this.#unsubscribe();
			} catch {
				// EventSource cleanup is best-effort.
			}
			this.#unsubscribe = null;
		}
	}

	#onProjectEvent(event: ProjectEvent): void {
		if (event.event !== 'file.changed') return;

		// Daemon publishes { sessionId, change: FileChange } — see
		// src/server/agent-loop.ts. Defensive parsing keeps a malformed
		// payload from poisoning the live ledger.
		const payload = event.data as
			| { sessionId?: unknown; change?: unknown }
			| null;
		if (!payload || typeof payload !== 'object') return;
		if (payload.sessionId !== this.#activeSessionId) return;

		const change = payload.change;
		if (!isFileChange(change)) return;

		this.#upsertChange(change);
	}

	#upsertChange(incoming: FileChange): void {
		// Same path → replace in place; preserve stable ordering by
		// resorting once at the end. The list is short (typically dozens),
		// so a full resort is cheaper than maintaining a sorted insert.
		const next = this.changes.filter((c) => c.path !== incoming.path);
		next.push(incoming);
		this.changes = sortChanges(next);
	}

	// ─── Test helpers (not part of the public contract) ────────────────────

	/** Reset every piece of store state. Used by component tests. */
	_reset(): void {
		this.#teardownSubscription();
		this.#activeProjectId = null;
		this.#activeSessionId = null;
		this.changes = [];
		this.isLoading = false;
		this.lastError = null;
	}

	/** Seed the change list directly without hitting the daemon. */
	_seedChanges(changes: FileChange[]): void {
		this.changes = sortChanges(changes);
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isFileChange(value: unknown): value is FileChange {
	if (!value || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	if (typeof v.path !== 'string') return false;
	if (
		v.changeType !== 'created' &&
		v.changeType !== 'modified' &&
		v.changeType !== 'deleted'
	) {
		return false;
	}
	if (typeof v.lastTouchedAt !== 'number') return false;
	return true;
}

function sortChanges(changes: FileChange[]): FileChange[] {
	return [...changes].sort((a, b) => b.lastTouchedAt - a.lastTouchedAt);
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const fileChangesStore = new FileChangesStore();
