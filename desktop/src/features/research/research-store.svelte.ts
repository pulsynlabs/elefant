/**
 * Research store — Svelte 5 runes state container for the Research View.
 *
 * Owns the tree, selected file, file content, search query/results, and
 * loading/error flags. All mutations happen through the methods below so
 * components don't reach into the runes directly. Mirrors the pattern in
 * `desktop/src/lib/stores/projects.svelte.ts` (module-level `$state` plus
 * a frozen export object exposing getters and methods).
 */

import { researchClient } from '$lib/daemon/research-client.js';
import type {
	ResearchFile,
	ResearchSearchResult,
	ResearchTree,
} from '$lib/daemon/types.js';

// ─── Internal state ────────────────────────────────────────────────────────

let tree = $state<ResearchTree | null>(null);
let selectedFile = $state<string | null>(null);
let fileContent = $state<ResearchFile | null>(null);
let searchQuery = $state('');
let searchResults = $state<ResearchSearchResult[]>([]);
let isLoading = $state(false);
let isLoadingFile = $state(false);
let isSearching = $state(false);
let error = $state<string | null>(null);

/** Anchor (heading slug) the reader should scroll to once HTML lands. */
let pendingAnchor = $state<string | null>(null);

/** Project the tree was loaded for — guards against stale responses. */
let loadedForProjectId = $state<string | null>(null);

/** Track in-flight file fetches so racing clicks don't show stale content. */
let fileFetchToken = 0;

// ─── Helpers ───────────────────────────────────────────────────────────────

function setError(message: string): void {
	error = message;
	console.error('[research]', message);
}

function clearError(): void {
	error = null;
}

// ─── Actions ───────────────────────────────────────────────────────────────

async function loadTree(projectId: string): Promise<void> {
	if (!projectId) return;
	isLoading = true;
	clearError();
	try {
		const next = await researchClient.getTree(projectId);
		tree = next;
		loadedForProjectId = projectId;
	} catch (err) {
		setError(err instanceof Error ? err.message : 'Failed to load research tree');
	} finally {
		isLoading = false;
	}
}

/**
 * Open a file by section-relative path. If `anchor` is supplied, the reader
 * pane consumes `pendingAnchor` after render to scroll to that heading slug
 * — this is the entry point for `research://workflow/path#anchor` chip
 * navigation.
 */
async function openFile(
	projectId: string,
	path: string,
	anchor?: string,
): Promise<void> {
	if (!projectId || !path) return;
	const token = ++fileFetchToken;
	selectedFile = path;
	pendingAnchor = anchor ?? null;
	isLoadingFile = true;
	clearError();
	try {
		const content = await researchClient.getFile(projectId, path, false);
		// Only commit the result if we're still the latest in-flight request.
		// Without this guard, a slow first request could overwrite the
		// content of a later, fast click on a different file.
		if (token === fileFetchToken) {
			fileContent = content;
		}
	} catch (err) {
		if (token === fileFetchToken) {
			setError(err instanceof Error ? err.message : 'Failed to load research file');
			fileContent = null;
		}
	} finally {
		if (token === fileFetchToken) {
			isLoadingFile = false;
		}
	}
}

async function search(projectId: string, query: string): Promise<void> {
	if (!projectId) return;
	const trimmed = query.trim();
	searchQuery = query;
	if (!trimmed) {
		searchResults = [];
		isSearching = false;
		return;
	}
	isSearching = true;
	clearError();
	try {
		const results = await researchClient.search(projectId, trimmed, { k: 20 });
		searchResults = results;
	} catch (err) {
		setError(err instanceof Error ? err.message : 'Search failed');
		searchResults = [];
	} finally {
		isSearching = false;
	}
}

function setSearchQuery(value: string): void {
	searchQuery = value;
	if (value.trim() === '') {
		searchResults = [];
		isSearching = false;
	}
}

/** Mark the pending anchor as consumed once the reader has scrolled to it. */
function consumePendingAnchor(): string | null {
	const anchor = pendingAnchor;
	pendingAnchor = null;
	return anchor;
}

function reset(): void {
	tree = null;
	selectedFile = null;
	fileContent = null;
	searchQuery = '';
	searchResults = [];
	pendingAnchor = null;
	loadedForProjectId = null;
	isLoading = false;
	isLoadingFile = false;
	isSearching = false;
	error = null;
	fileFetchToken += 1;
}

// ─── Public API ────────────────────────────────────────────────────────────

export const researchStore = {
	get tree() {
		return tree;
	},
	get selectedFile() {
		return selectedFile;
	},
	get fileContent() {
		return fileContent;
	},
	get searchQuery() {
		return searchQuery;
	},
	get searchResults() {
		return searchResults;
	},
	get isLoading() {
		return isLoading;
	},
	get isLoadingFile() {
		return isLoadingFile;
	},
	get isSearching() {
		return isSearching;
	},
	get error() {
		return error;
	},
	get pendingAnchor() {
		return pendingAnchor;
	},
	get loadedForProjectId() {
		return loadedForProjectId;
	},

	loadTree,
	openFile,
	search,
	setSearchQuery,
	consumePendingAnchor,
	reset,
};

// Test helper for resetting state between specs.
export function _resetResearchStoreForTests(): void {
	reset();
}
