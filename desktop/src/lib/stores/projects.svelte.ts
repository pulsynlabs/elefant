// Project and session store (Svelte 5 runes)
//
// Single source of truth for all project/session UI state in the desktop app.
// All methods call daemon HTTP endpoints and update reactive state.
//
// ## Multi-Server Namespacing (May 2026)
//
// Since multi-daemon support, all project state is namespaced by server ID.
// Internal maps (`projectsByServer`, `sessionsByServerProject`) hold data
// keyed by server ID.  The public `projects` and `sessionsByProject` getters
// return only the active server's slice, derived from `currentServerId`.
//
// Switching the active server (detected via the daemon client registry's
// subscribe callback) clears transient UI state (`activeProjectId`,
// `activeSessionId`) and reloads the project list from the new server.
//
// ## Migration Semantics
//
// Daemon project data lives server-side (each daemon has its own SQLite DB),
// so there is no frontend data migration.  The registry subscription that
// watches for active-server changes bootstraps `currentServerId` and triggers
// the initial `loadProjects()` call for the default local server.  Existing
// users upgrading from the single-daemon model see their projects load
// against the seeded local server configured by `settingsStore.init()`.

import { registry } from '$lib/daemon/registry.js';
import type { Project, Session, SessionMode } from '$lib/types/project.js';

// ---------------------------------------------------------------------------
// Internal state — namespaced by server ID
// ---------------------------------------------------------------------------

/** All project lists, keyed by server ID. */
let projectsByServer = $state<Record<string, Project[]>>({});

/** All session caches, keyed by server ID then project ID. */
let sessionsByServerProject = $state<
	Record<string, Record<string, Session[]>>
>({});

/** Which server's data is currently shown to the UI. */
let currentServerId = $state<string | null>(null);

let activeProjectId = $state<string | null>(null);
let activeSessionId = $state<string | null>(null);
let lastError = $state<string | null>(null);
let isLoading = $state(false);

// ---------------------------------------------------------------------------
// Derived values — the active server's slice of the namespaced state
// ---------------------------------------------------------------------------

/**
 * Returns the active server's project list.  Must be called inside a
 * reactive context (e.g. a store getter or `$derived`) for reactivity.
 */
function getProjects(): Project[] {
	return projectsByServer[currentServerId ?? ''] ?? [];
}

/**
 * Returns the active server's session cache.
 */
function getSessionsByProject(): Record<string, Session[]> {
	return sessionsByServerProject[currentServerId ?? ''] ?? {};
}

const activeProject = $derived(
	activeProjectId
		? getProjects().find((p) => p.id === activeProjectId) ?? null
		: null
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearError(): void {
	lastError = null;
}

function setError(message: string): void {
	lastError = message;
	console.error('[projects]', message);
}

/** Returns the active daemon client's base URL.  Throws if no active server. */
function getBaseUrl(): string {
	return registry.getActive().getBaseUrl();
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

async function loadProjects(): Promise<void> {
	isLoading = true;
	clearError();
	try {
		const baseUrl = getBaseUrl();
		const response = await fetch(`${baseUrl}/api/projects`, {
			headers: { Accept: 'application/json' },
		});
		if (!response.ok) {
			throw new Error(
				`GET /api/projects failed: HTTP ${response.status}`,
			);
		}
		const data = (await response.json()) as Project[];
		const sid = currentServerId ?? '';
		projectsByServer = { ...projectsByServer, [sid]: data };
	} catch (err) {
		setError(
			err instanceof Error ? err.message : 'Failed to load projects',
		);
	} finally {
		isLoading = false;
	}
}

async function openProject(path: string, name?: string): Promise<Project> {
	clearError();
	try {
		const baseUrl = getBaseUrl();
		const response = await fetch(`${baseUrl}/api/projects`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ path, name }),
		});
		if (!response.ok) {
			throw new Error(
				`POST /api/projects failed: HTTP ${response.status}`,
			);
		}
		const created = (await response.json()) as Project;

		const sid = currentServerId ?? '';
		const currentList = projectsByServer[sid] ?? [];

		// Upsert into the active server's project list (idempotent: may
		// return an existing row).
		const existingIndex = currentList.findIndex(
			(p) => p.id === created.id,
		);
		const updatedList =
			existingIndex >= 0
				? currentList.map((p, i) =>
						i === existingIndex ? created : p,
					)
				: [created, ...currentList];

		projectsByServer = { ...projectsByServer, [sid]: updatedList };
		activeProjectId = created.id;
		return created;
	} catch (err) {
		setError(
			err instanceof Error ? err.message : 'Failed to open project',
		);
		throw err;
	}
}

async function selectProject(id: string): Promise<void> {
	activeProjectId = id;
	await loadSessions(id);
}

async function renameProject(id: string, name: string): Promise<void> {
	clearError();
	try {
		const baseUrl = getBaseUrl();
		const response = await fetch(`${baseUrl}/api/projects/${id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name }),
		});
		if (!response.ok) {
			throw new Error(
				`PUT /api/projects/${id} failed: HTTP ${response.status}`,
			);
		}
		const updated = (await response.json()) as Project;

		const sid = currentServerId ?? '';
		const currentList = projectsByServer[sid] ?? [];
		projectsByServer = {
			...projectsByServer,
			[sid]: currentList.map((p) => (p.id === id ? updated : p)),
		};
	} catch (err) {
		setError(
			err instanceof Error ? err.message : 'Failed to rename project',
		);
	}
}

async function deleteProject(id: string): Promise<void> {
	clearError();
	try {
		const baseUrl = getBaseUrl();
		const response = await fetch(`${baseUrl}/api/projects/${id}`, {
			method: 'DELETE',
		});
		if (!response.ok) {
			throw new Error(
				`DELETE /api/projects/${id} failed: HTTP ${response.status}`,
			);
		}

		const sid = currentServerId ?? '';
		const currentList = projectsByServer[sid] ?? [];
		projectsByServer = {
			...projectsByServer,
			[sid]: currentList.filter((p) => p.id !== id),
		};

		if (activeProjectId === id) {
			activeProjectId = null;
		}

		// Clean up cached sessions for this project on the active server.
		const currentSessions = sessionsByServerProject[sid] ?? {};
		const { [id]: _, ...rest } = currentSessions;
		sessionsByServerProject = {
			...sessionsByServerProject,
			[sid]: rest,
		};
	} catch (err) {
		setError(
			err instanceof Error ? err.message : 'Failed to delete project',
		);
	}
}

async function loadSessions(projectId: string): Promise<void> {
	clearError();
	try {
		const baseUrl = getBaseUrl();
		const response = await fetch(
			`${baseUrl}/api/projects/${projectId}/sessions`,
			{ headers: { Accept: 'application/json' } },
		);
		if (!response.ok) {
			throw new Error(
				`GET /api/projects/${projectId}/sessions failed: HTTP ${response.status}`,
			);
		}
		const json = (await response.json()) as
			| { ok: true; data: Session[] }
			| Session[];
		// Routes wrapped in { ok, data } after the project-ui sprint; handle
		// both shapes.
		const data = Array.isArray(json)
			? json
			: (json as { ok: true; data: Session[] }).data;

		const sid = currentServerId ?? '';
		const currentSessions = sessionsByServerProject[sid] ?? {};
		sessionsByServerProject = {
			...sessionsByServerProject,
			[sid]: { ...currentSessions, [projectId]: data },
		};
	} catch (err) {
		setError(
			err instanceof Error
				? err.message
				: 'Failed to load sessions',
		);
	}
}

async function createSession(
	projectId: string,
	options: { mode?: SessionMode } = {},
): Promise<Session> {
	clearError();
	try {
		// Only forward `mode` when it was supplied — letting the server
		// apply its own default keeps the wire payload minimal and the
		// daemon's contract authoritative.
		const body: Record<string, unknown> = {};
		if (options.mode !== undefined) body.mode = options.mode;

		const baseUrl = getBaseUrl();
		const response = await fetch(
			`${baseUrl}/api/projects/${projectId}/sessions`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			},
		);
		if (!response.ok) {
			throw new Error(
				`POST /api/projects/${projectId}/sessions failed: HTTP ${response.status}`,
			);
		}
		const json = (await response.json()) as
			| { ok: true; data: Session }
			| Session;
		// Routes wrapped in { ok, data } after the project-ui sprint; handle
		// both shapes.
		const created =
			'ok' in json && json.ok
				? (json as { ok: true; data: Session }).data
				: (json as Session);

		const sid = currentServerId ?? '';
		const currentSessions = sessionsByServerProject[sid] ?? {};
		const existing = currentSessions[projectId] ?? [];
		sessionsByServerProject = {
			...sessionsByServerProject,
			[sid]: {
				...currentSessions,
				[projectId]: [created, ...existing],
			},
		};
		activeSessionId = created.id;
		return created;
	} catch (err) {
		setError(
			err instanceof Error
				? err.message
				: 'Failed to create session',
		);
		throw err;
	}
}

function selectSession(sessionId: string): void {
	// Clear child run stack when switching sessions (MH2)
	// Import navigationStore dynamically to avoid circular dependency
	import('./navigation.svelte.js')
		.then((mod) => {
			mod.navigationStore.clearChildRunStack();
		})
		.catch(() => {
			// Navigation store may not be initialized yet — ignore
		});
	activeSessionId = sessionId;
}

// ---------------------------------------------------------------------------
// Active-server change handler
// ---------------------------------------------------------------------------

// The registry's subscribe callback fires on every health status update
// AND on `setActive()` (which calls notify).  We compare
// `registry.getActiveServerId()` with `currentServerId` to detect when
// the user actually switches the active server — clearing transient UI
// state and reloading the project list.
//
// Module-level `$effect` on `settingsStore.activeServerId` is preferred
// but unavailable here (Bun's Svelte transform does not yet support
// module-level `$effect` in `.svelte.ts` files bound for a test runner).
// The registry subscribe fallback achieves the same result.

let _registryUnsub: (() => void) | null = null;

function _ensureServerSwitchWatch(): void {
	if (_registryUnsub !== null) return;

	_registryUnsub = registry.subscribe(() => {
		const sid = registry.getActiveServerId();
		if (sid !== null && sid !== currentServerId) {
			currentServerId = sid;
			activeProjectId = null;
			activeSessionId = null;
			void loadProjects();
		}
	});
}

// Start watching on load (idempotent — `_ensureServerSwitchWatch` is
// guarded so calling it at module level is safe).
_ensureServerSwitchWatch();

// ---------------------------------------------------------------------------
// Test isolation helpers
// ---------------------------------------------------------------------------

/** Reset all store state to initial values.  Exported for test isolation. */
export function resetProjectsStore(): void {
	// Unsubscribe the registry watch so the next test can re-attach
	if (_registryUnsub) {
		_registryUnsub();
		_registryUnsub = null;
	}
	projectsByServer = {};
	sessionsByServerProject = {};
	currentServerId = null;
	activeProjectId = null;
	activeSessionId = null;
	lastError = null;
	isLoading = false;
}

/** Set projects array for the current server.  Exported for test isolation. */
export function _setProjects(p: Project[]): void {
	projectsByServer[currentServerId ?? ''] = p;
}

/** Set active project ID directly.  Exported for test isolation. */
export function _setActiveProjectId(id: string | null): void {
	activeProjectId = id;
}

/** Set sessions by project for the current server.  Exported for test isolation. */
export function _setSessionsByProject(s: Record<string, Session[]>): void {
	sessionsByServerProject[currentServerId ?? ''] = s;
}

/** Set active session ID directly.  Exported for test isolation. */
export function _setActiveSessionId(id: string | null): void {
	activeSessionId = id;
}

/** Set the current server ID.  Exported for test isolation. */
export function _setCurrentServerId(id: string | null): void {
	currentServerId = id;
}

// ---------------------------------------------------------------------------
// Public store API
// ---------------------------------------------------------------------------

export const projectsStore = {
	/** The active server's project list (reactive). */
	get projects() {
		return getProjects();
	},
	get activeProjectId() {
		return activeProjectId;
	},
	get activeProject() {
		return activeProject;
	},
	/** The active server's session cache, keyed by project ID. */
	get sessionsByProject() {
		return getSessionsByProject();
	},
	get activeSessionId() {
		return activeSessionId;
	},
	get lastError() {
		return lastError;
	},
	get isLoading() {
		return isLoading;
	},
	/** The server ID whose data is currently visible. */
	get currentServerId() {
		return currentServerId;
	},

	// Methods
	loadProjects,
	openProject,
	selectProject,
	renameProject,
	deleteProject,
	loadSessions,
	createSession,
	selectSession,

	// Test helpers
	resetProjectsStore,
	_setProjects,
	_setActiveProjectId,
	_setSessionsByProject,
	_setActiveSessionId,
	_setCurrentServerId,
};
