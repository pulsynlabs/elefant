// Commands store — single canonical source of slash commands for the UI.
//
// Mirrors GET /api/wf/commands (mounted by src/server/routes-workflow.ts) and
// caches the response in-memory for the lifetime of the app. The endpoint is
// itself memoised on the daemon, so a single fetch on first access is enough.
//
// Convention notes:
//   - .svelte.ts extension is required for runes.
//   - Failures are surfaced via `error` (never thrown to the UI).
//   - The store deduplicates concurrent fetches via `inflight`.

import { DAEMON_URL } from '$lib/daemon/client.js';
import type { Command } from '$features/chat/command-completions/fuzzy.js';

let commands = $state<Command[]>([]);
let loaded = $state(false);
let loading = $state(false);
let error = $state<string | null>(null);
let inflight: Promise<Command[]> | null = null;

interface CommandsApiResponse {
	data?: { commands: Command[] };
	commands?: Command[];
}

async function fetchCommands(): Promise<Command[]> {
	const response = await fetch(`${DAEMON_URL}/api/wf/commands`, {
		headers: { Accept: 'application/json' },
	});

	if (!response.ok) {
		throw new Error(`Failed to load commands: HTTP ${response.status}`);
	}

	const json = (await response.json()) as CommandsApiResponse;
	// Daemon currently returns the bare `{ commands: [...] }` shape from the
	// route handler. Accept the wrapped `{ data: { commands } }` envelope too
	// so this client survives a future routes-workflow refactor.
	const list = json?.data?.commands ?? json?.commands ?? [];
	if (!Array.isArray(list)) {
		throw new Error('Malformed commands response: expected commands array');
	}
	return list as Command[];
}

/**
 * Trigger an initial load of the commands list. Subsequent calls are
 * no-ops once the cache is populated. Concurrent callers share the
 * same in-flight promise.
 */
async function load(): Promise<void> {
	if (loaded) return;
	if (inflight) {
		await inflight;
		return;
	}

	loading = true;
	error = null;
	inflight = fetchCommands();

	try {
		commands = await inflight;
		loaded = true;
	} catch (err) {
		error = err instanceof Error ? err.message : 'Failed to load commands';
		console.error('[commands]', error);
	} finally {
		loading = false;
		inflight = null;
	}
}

/**
 * Force a refresh from the daemon, bypassing the cache. Used on
 * settings change or after a workflow rename, neither of which
 * happens often enough to need automatic invalidation.
 */
async function refresh(): Promise<void> {
	loaded = false;
	inflight = null;
	await load();
}

/** Reset state for tests. */
export function resetCommandsStore(): void {
	commands = [];
	loaded = false;
	loading = false;
	error = null;
	inflight = null;
}

/** Test-only seed: skips the network and pretends the cache is hot. */
export function _seedCommandsForTest(seed: Command[]): void {
	commands = seed;
	loaded = true;
	loading = false;
	error = null;
	inflight = null;
}

export const commandsStore = {
	get commands() {
		return commands;
	},
	get loaded() {
		return loaded;
	},
	get loading() {
		return loading;
	},
	get error() {
		return error;
	},
	load,
	refresh,
};
