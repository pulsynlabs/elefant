// Session Todos store (Svelte 5 runes).
//
// Tracks the read-only todo list emitted by the agent via `todowrite` tool
// calls for the currently active chat session. Bootstraps from a GET on
// session activation and stays live via the project's SSE event stream
// (`todos.updated` event with payload `{ sessionId, todos }`).
//
// The store is intentionally session-scoped: switching sessions clears the
// list and re-bootstraps so a previous session's todos never leak into the
// next. Switching projects also closes the old SSE connection (one EventSource
// per project, identical to spec-mode.svelte.ts).
//
// SPEC: MH6 — Session To-Do List tab. Read-only in v1; agent owns the data.

import { DAEMON_URL } from '$lib/daemon/client.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Status taxonomy mirrors `TodoStatus` from src/server/session-todos.ts.
 * Kept as a literal union so a renamed/added status is a TS error, not a
 * silent UI fallback.
 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface TodoItem {
	id: string;
	content: string;
	status: TodoStatus;
	priority?: 'high' | 'medium' | 'low';
	/** Daemon-assigned ordering hint; used as a stable secondary sort key. */
	position?: number;
}

interface TodosUpdatedPayload {
	sessionId: string;
	todos: TodoItem[];
}

/** Sentinel for "not currently bound to any session". */
const NO_SESSION = { projectId: null, sessionId: null } as const;

// ─── Internal state ─────────────────────────────────────────────────────────

let todos = $state<TodoItem[]>([]);
let activeProjectId = $state<string | null>(null);
let activeSessionId = $state<string | null>(null);

let sseSubscription: {
	projectId: string;
	eventSource: EventSource;
} | null = null;

// ─── Sort + filter ──────────────────────────────────────────────────────────

const ACTIVE_STATUSES: ReadonlySet<TodoStatus> = new Set(['pending', 'in_progress']);

function isActive(item: TodoItem): boolean {
	return ACTIVE_STATUSES.has(item.status);
}

/**
 * Stable sort: active items (pending, in_progress) first, then terminal
 * (completed, cancelled) at the bottom. Within each group, the agent-emitted
 * order is preserved — `position` is honored when present, with original
 * array index as the tie-breaker so ties never reshuffle on re-renders.
 */
function sortTodos(items: ReadonlyArray<TodoItem>): TodoItem[] {
	return [...items]
		.map((item, index) => ({ item, index }))
		.sort((a, b) => {
			const aActive = isActive(a.item);
			const bActive = isActive(b.item);
			if (aActive !== bActive) return aActive ? -1 : 1;

			const aPos = a.item.position ?? a.index;
			const bPos = b.item.position ?? b.index;
			if (aPos !== bPos) return aPos - bPos;
			return a.index - b.index;
		})
		.map(({ item }) => item);
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────

/**
 * Fetch the canonical todo list from the daemon. Tolerates missing/empty
 * responses — a session with no todos yet returns an empty array, which
 * the empty state UI renders.
 */
async function bootstrap(projectId: string, sessionId: string): Promise<void> {
	try {
		const url = `${DAEMON_URL}/api/projects/${encodeURIComponent(
			projectId,
		)}/sessions/${encodeURIComponent(sessionId)}/todos`;
		const response = await fetch(url, { headers: { Accept: 'application/json' } });
		if (!response.ok) {
			console.warn(
				`[session-todos] bootstrap GET failed: HTTP ${response.status} for session ${sessionId}`,
			);
			return;
		}
		const parsed = (await response.json()) as { todos?: unknown };
		// Guard against a session change racing the in-flight fetch — only
		// commit results that still match the currently-active session.
		if (activeSessionId !== sessionId) return;

		if (Array.isArray(parsed.todos)) {
			todos = sortTodos(parsed.todos.filter(isValidTodoItem));
		}
	} catch (err) {
		console.warn('[session-todos] bootstrap failed:', err);
	}
}

function isValidTodoItem(value: unknown): value is TodoItem {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	if (typeof v.id !== 'string' || typeof v.content !== 'string') return false;
	if (typeof v.status !== 'string') return false;
	return (
		v.status === 'pending' ||
		v.status === 'in_progress' ||
		v.status === 'completed' ||
		v.status === 'cancelled'
	);
}

// ─── SSE subscription ───────────────────────────────────────────────────────

/**
 * Open (or reuse) an EventSource for the project's event stream and listen
 * for `todos.updated` messages addressed to the active session.
 *
 * One connection per project — switching projects tears down the old socket
 * before opening a new one. This mirrors the pattern in spec-mode.svelte.ts.
 */
function subscribe(projectId: string): void {
	if (sseSubscription && sseSubscription.projectId === projectId) return;
	unsubscribe();

	const url = `${DAEMON_URL}/api/projects/${encodeURIComponent(projectId)}/events`;
	const es = new EventSource(url);
	sseSubscription = { projectId, eventSource: es };

	es.addEventListener('todos.updated', (event) => {
		try {
			const payload = JSON.parse((event as MessageEvent).data) as TodosUpdatedPayload;
			// Ignore events for other sessions — the project stream multiplexes
			// every session and we only care about the active one.
			if (payload.sessionId !== activeSessionId) return;
			if (!Array.isArray(payload.todos)) return;
			todos = sortTodos(payload.todos.filter(isValidTodoItem));
		} catch {
			// Malformed payload — skip without poisoning the stream.
		}
	});
}

function unsubscribe(): void {
	if (!sseSubscription) return;
	try {
		sseSubscription.eventSource.close();
	} catch {
		// already closed
	}
	sseSubscription = null;
}

// ─── Public actions ─────────────────────────────────────────────────────────

/**
 * Bind the store to a session. Pass nulls (or call `clear`) to detach.
 *
 * Idempotent: re-binding to the same (projectId, sessionId) is a no-op so
 * the TodosTab `$effect` can safely re-run without re-fetching.
 */
function setActiveSession(projectId: string | null, sessionId: string | null): void {
	if (activeProjectId === projectId && activeSessionId === sessionId) return;

	activeProjectId = projectId;
	activeSessionId = sessionId;
	todos = [];

	if (!projectId || !sessionId) {
		unsubscribe();
		return;
	}

	subscribe(projectId);
	void bootstrap(projectId, sessionId);
}

function clear(): void {
	setActiveSession(null, null);
}

// ─── Test helpers (not part of the public contract) ─────────────────────────

/** Reset all state to its initial values. */
export function resetSessionTodosStore(): void {
	unsubscribe();
	todos = [];
	activeProjectId = null;
	activeSessionId = null;
}

/** Seed the todo list directly without hitting the daemon. */
export function _seedTodos(items: TodoItem[]): void {
	todos = sortTodos(items);
}

// ─── Public store API ───────────────────────────────────────────────────────

export const sessionTodosStore = {
	/** Sorted todo list (active first, then completed/cancelled). */
	get todos(): TodoItem[] {
		return todos;
	},
	/** Total number of todos for the active session. */
	get count(): number {
		return todos.length;
	},
	/** Active (non-terminal) count — useful for tab badges. */
	get activeCount(): number {
		return todos.filter(isActive).length;
	},
	get activeProjectId(): string | null {
		return activeProjectId;
	},
	get activeSessionId(): string | null {
		return activeSessionId;
	},
	setActiveSession,
	clear,
};

// Re-export sentinel for tests that want to assert "no session bound".
export { NO_SESSION };
