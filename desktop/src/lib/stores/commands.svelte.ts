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

// Hardcoded fallback used when the daemon isn't reachable. Keeps the
// completions overlay functional offline / pre-daemon-start so users
// always see the canonical command list. Kept in sync manually with
// the daemon's GET /api/wf/commands handler.
const FALLBACK_COMMANDS: Command[] = [
	{ trigger: '/discuss', description: 'Start a discovery interview to gather requirements' },
	{ trigger: '/plan', description: 'Create specification and execution blueprint' },
	{ trigger: '/execute', description: 'Begin wave-based implementation' },
	{ trigger: '/audit', description: 'Verify implementation against requirements' },
	{ trigger: '/accept', description: 'Review and confirm completed work' },
	{ trigger: '/status', description: 'Check current workflow phase and progress' },
	{ trigger: '/amend', description: 'Propose changes to a locked specification' },
	{ trigger: '/help', description: 'Show available commands and workflow guide' },
	{ trigger: '/pause', description: 'Save checkpoint and pause work' },
	{ trigger: '/resume', description: 'Resume from a saved checkpoint' },
	{ trigger: '/quick', description: 'Fast-track a small task without full workflow' },
	{ trigger: '/fieldnotes', description: 'Launch field notes research for unknowns or risks' },
	{ trigger: '/debug', description: 'Debug with a systematic workflow' },
	{ trigger: '/map-codebase', description: 'Map and understand an existing codebase' },
	{ trigger: '/pr-review', description: 'Review a GitHub pull request end-to-end' },
	{ trigger: '/btw', description: 'Ask a question in side context without polluting main history' },
	{ trigger: '/back', description: 'Return to the main conversation from side context' },
	{ trigger: '/undo', description: 'Undo the last message pair and restore the prompt to the input' },
	{ trigger: '/redo', description: 'Redo the last undone message pair' },
];

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
		console.warn('[commands] fetch failed, using fallback:', error);
		// Use fallback so the overlay works offline / without the daemon.
		// Mark as loaded so subsequent calls return immediately and we
		// don't spam the network on every mount.
		commands = FALLBACK_COMMANDS;
		loaded = true;
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
