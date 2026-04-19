// Project and session store (Svelte 5 runes)
//
// Single source of truth for all project/session UI state in the desktop app.
// All methods call daemon HTTP endpoints and update reactive state.

import { DAEMON_URL } from '$lib/daemon/client.js';
import type { Project, Session } from '$lib/types/project.js';

let projects = $state<Project[]>([]);
let activeProjectId = $state<string | null>(null);
let sessionsByProject = $state<Record<string, Session[]>>({});
let activeSessionId = $state<string | null>(null);
let lastError = $state<string | null>(null);
let isLoading = $state(false);

const activeProject = $derived(
	activeProjectId
		? projects.find((p) => p.id === activeProjectId) ?? null
		: null
);

function clearError(): void {
	lastError = null;
}

function setError(message: string): void {
	lastError = message;
	console.error('[projects]', message);
}

async function loadProjects(): Promise<void> {
	isLoading = true;
	clearError();
	try {
		const response = await fetch(`${DAEMON_URL}/api/projects`, {
			headers: { Accept: 'application/json' },
		});
		if (!response.ok) {
			throw new Error(`GET /api/projects failed: HTTP ${response.status}`);
		}
		const data = (await response.json()) as Project[];
		projects = data;
	} catch (err) {
		setError(err instanceof Error ? err.message : 'Failed to load projects');
	} finally {
		isLoading = false;
	}
}

async function openProject(path: string, name?: string): Promise<Project> {
	clearError();
	try {
		const response = await fetch(`${DAEMON_URL}/api/projects`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ path, name }),
		});
		if (!response.ok) {
			throw new Error(`POST /api/projects failed: HTTP ${response.status}`);
		}
		const created = (await response.json()) as Project;

		// Upsert into the projects list (idempotent: may return existing row)
		const existingIndex = projects.findIndex((p) => p.id === created.id);
		if (existingIndex >= 0) {
			projects = projects.map((p, i) => (i === existingIndex ? created : p));
		} else {
			projects = [created, ...projects];
		}
		activeProjectId = created.id;
		return created;
	} catch (err) {
		setError(err instanceof Error ? err.message : 'Failed to open project');
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
		const response = await fetch(`${DAEMON_URL}/api/projects/${id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name }),
		});
		if (!response.ok) {
			throw new Error(`PUT /api/projects/${id} failed: HTTP ${response.status}`);
		}
		const updated = (await response.json()) as Project;
		projects = projects.map((p) => (p.id === id ? updated : p));
	} catch (err) {
		setError(err instanceof Error ? err.message : 'Failed to rename project');
	}
}

async function deleteProject(id: string): Promise<void> {
	clearError();
	try {
		const response = await fetch(`${DAEMON_URL}/api/projects/${id}`, {
			method: 'DELETE',
		});
		if (!response.ok) {
			throw new Error(`DELETE /api/projects/${id} failed: HTTP ${response.status}`);
		}
		projects = projects.filter((p) => p.id !== id);
		if (activeProjectId === id) {
			activeProjectId = null;
		}
		// Clean up cached sessions for this project
		const { [id]: _, ...rest } = sessionsByProject;
		sessionsByProject = rest;
	} catch (err) {
		setError(err instanceof Error ? err.message : 'Failed to delete project');
	}
}

async function loadSessions(projectId: string): Promise<void> {
	clearError();
	try {
		const response = await fetch(`${DAEMON_URL}/api/projects/${projectId}/sessions`, {
			headers: { Accept: 'application/json' },
		});
		if (!response.ok) {
			throw new Error(
				`GET /api/projects/${projectId}/sessions failed: HTTP ${response.status}`
			);
		}
		const json = (await response.json()) as { ok: true; data: Session[] } | Session[];
		// Routes wrapped in { ok, data } after the project-ui sprint; handle both shapes.
		const data = Array.isArray(json) ? json : (json as { ok: true; data: Session[] }).data;
		sessionsByProject = { ...sessionsByProject, [projectId]: data };
	} catch (err) {
		setError(err instanceof Error ? err.message : 'Failed to load sessions');
	}
}

async function createSession(projectId: string): Promise<Session> {
	clearError();
	try {
		const response = await fetch(
			`${DAEMON_URL}/api/projects/${projectId}/sessions`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			}
		);
		if (!response.ok) {
			throw new Error(
				`POST /api/projects/${projectId}/sessions failed: HTTP ${response.status}`
			);
		}
		const json = (await response.json()) as { ok: true; data: Session } | Session;
		// Routes wrapped in { ok, data } after the project-ui sprint; handle both shapes.
		const created = 'ok' in json && json.ok ? (json as { ok: true; data: Session }).data : (json as Session);
		const existing = sessionsByProject[projectId] ?? [];
		sessionsByProject = {
			...sessionsByProject,
			[projectId]: [created, ...existing],
		};
		activeSessionId = created.id;
		return created;
	} catch (err) {
		setError(err instanceof Error ? err.message : 'Failed to create session');
		throw err;
	}
}

function selectSession(sessionId: string): void {
	// Clear child run stack when switching sessions (MH2)
	// Import navigationStore dynamically to avoid circular dependency
	import('./navigation.svelte.js').then((mod) => {
		mod.navigationStore.clearChildRunStack();
	}).catch(() => {
		// Navigation store may not be initialized yet — ignore
	});
	activeSessionId = sessionId;
}

/** Reset all store state to initial values. Exported for test isolation. */
export function resetProjectsStore(): void {
	projects = [];
	activeProjectId = null;
	sessionsByProject = {};
	activeSessionId = null;
	lastError = null;
	isLoading = false;
}

/** Set projects array directly. Exported for test isolation. */
export function _setProjects(p: Project[]): void {
	projects = p;
}

/** Set active project ID directly. Exported for test isolation. */
export function _setActiveProjectId(id: string | null): void {
	activeProjectId = id;
}

/** Set sessions by project directly. Exported for test isolation. */
export function _setSessionsByProject(s: Record<string, Session[]>): void {
	sessionsByProject = s;
}

/** Set active session ID directly. Exported for test isolation. */
export function _setActiveSessionId(id: string | null): void {
	activeSessionId = id;
}

export const projectsStore = {
	get projects() {
		return projects;
	},
	get activeProjectId() {
		return activeProjectId;
	},
	get activeProject() {
		return activeProject;
	},
	get sessionsByProject() {
		return sessionsByProject;
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
	loadProjects,
	openProject,
	selectProject,
	renameProject,
	deleteProject,
	loadSessions,
	createSession,
	selectSession,
	resetProjectsStore,
	_setProjects,
	_setActiveProjectId,
	_setSessionsByProject,
	_setActiveSessionId,
};
