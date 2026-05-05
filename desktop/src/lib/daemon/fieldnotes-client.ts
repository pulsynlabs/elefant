/**
 * Field Notes client — thin wrapper over `/v1/fieldnotes/*` daemon routes.
 *
 * The desktop never talks to the file system or vector index directly; every
 * operation goes through the daemon so a single source of truth (project
 * membership, traversal guards, embedding-provider state) is enforced server
 * side. This client gives the Field Notes View, Settings tab, and chat chip
 * renderer a consistent typed surface.
 *
 * The shapes here are mirrored from the server module — kept in sync by
 * convention rather than codegen because the response surface is tiny and
 * rarely changes. If a payload field is added on the daemon side, add it
 * to `./types.ts` and the rest of the UI picks it up via TypeScript
 * narrowing.
 */

import { getDaemonClient } from './client.js';
import type {
	FieldNotesFile,
	FieldNotesSearchOptions,
	FieldNotesSearchResult,
	FieldNotesStatus,
	FieldNotesTree,
} from './types.js';

// Re-export the field-notes-shaped types so callers can import everything
// related to the field-notes surface from one place. Sibling components
// (TreePane, ReaderPane, fieldnotes-store) consume these via this module
// instead of reaching into `./types.js` directly.
export type {
	FieldNotesFile,
	FieldNotesSearchMode,
	FieldNotesSearchOptions,
	FieldNotesSearchResult,
	FieldNotesStatus,
	FieldNotesTree,
	FieldNotesTreeFile,
	FieldNotesTreeSection,
} from './types.js';

function baseUrl(): string {
	return getDaemonClient().getBaseUrl();
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${baseUrl()}${path}`, {
		...init,
		headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
	});

	if (!res.ok) {
		// Try to surface the daemon error envelope; fall back to status text.
		const body = (await res.json().catch(() => null)) as
			| { error?: string; message?: string; code?: string }
			| null;
		throw new Error(body?.error ?? body?.message ?? `HTTP ${res.status}`);
	}

	return (await res.json()) as T;
}

/** Fetch the Field Notes health/status snapshot for a project. */
export async function fetchStatus(projectId: string): Promise<FieldNotesStatus> {
	const url = `/v1/fieldnotes/status?projectId=${encodeURIComponent(projectId)}`;
	return jsonFetch<FieldNotesStatus>(url);
}

/** Trigger a full reindex for a project. Returns once the daemon accepts the job. */
export async function reindex(projectId: string): Promise<{ started: boolean }> {
	return jsonFetch<{ started: boolean }>('/v1/fieldnotes/reindex', {
		method: 'POST',
		body: JSON.stringify({ projectId }),
	});
}

/**
 * Ask the daemon to launch the user's external editor on the given field
 * note. Returns the daemon's response envelope (`launched`, optional
 * `command`/`error` strings) so the UI can surface a meaningful message
 * without throwing on every editor failure.
 */
export async function openInEditor(
	projectId: string,
	filePath: string,
): Promise<{ launched: boolean; command?: string; error?: string }> {
	const res = await fetch(`${baseUrl()}/v1/fieldnotes/open-in-editor`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ projectId, path: filePath }),
	});

	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as { error?: string } | null;
		return { launched: false, error: body?.error ?? `HTTP ${res.status}` };
	}

	return (await res.json()) as { launched: boolean; command?: string; error?: string };
}

/**
 * Fetch the section/folder tree for a project's Field Notes.
 *
 * The tree is computed on-demand from disk on every call, so it always
 * reflects the latest state. Caching is the caller's responsibility (see
 * `fieldnotes-store.svelte.ts`).
 */
export async function getTree(projectId: string): Promise<FieldNotesTree> {
	const url = `/v1/fieldnotes/tree?projectId=${encodeURIComponent(projectId)}`;
	return jsonFetch<FieldNotesTree>(url);
}

/**
 * Fetch a single field note by section-relative path.
 *
 * @param meta When true, the daemon skips the markdown→HTML render and
 *   returns only the frontmatter + raw body. Useful for chip-style previews
 *   where the body isn't shown.
 */
export async function getFile(
	projectId: string,
	path: string,
	meta = false,
): Promise<FieldNotesFile> {
	const params = new URLSearchParams({ projectId, path });
	if (meta) params.set('meta', 'true');
	const url = `/v1/fieldnotes/file?${params.toString()}`;
	return jsonFetch<FieldNotesFile>(url);
}

/**
 * Run a Field Notes search.
 *
 * Defaults to `hybrid` mode server-side; pass `mode: 'keyword'` to force
 * pure ripgrep/FTS5 lookup. The daemon transparently degrades semantic /
 * hybrid to keyword when the embedding provider is `disabled`.
 *
 * Tolerates both the bare-array response (current daemon shape) and the
 * `{ results, mode_used, total }` envelope returned by the underlying
 * tool, in case the route swaps to the richer payload later.
 */
export async function search(
	projectId: string,
	query: string,
	opts: FieldNotesSearchOptions = {},
): Promise<FieldNotesSearchResult[]> {
	const data = await jsonFetch<
		FieldNotesSearchResult[] | { results: FieldNotesSearchResult[] }
	>('/v1/fieldnotes/search', {
		method: 'POST',
		body: JSON.stringify({ projectId, query, ...opts }),
	});
	return Array.isArray(data) ? data : data.results;
}

export const fieldNotesClient = {
	fetchStatus,
	reindex,
	openInEditor,
	getTree,
	getFile,
	search,
};
