import { Store } from '@tauri-apps/plugin-store';
import { getDaemonClient } from '$lib/daemon/client.js';
import type { ServerConfig } from '$lib/types/server.js';
import { DEFAULT_LOCAL_SERVER_SEED } from '$lib/types/server.js';
import {
	normalizeServerUrl,
	generateServerId,
	isLocalUrl,
	serverDisplayNameFallback,
} from '$lib/daemon/server-utils.js';

const STORE_FILE = 'elefant-preferences.json';

// ---------------------------------------------------------------------------
// Module-level state (Svelte 5 runes)
// ---------------------------------------------------------------------------

let autoStartDaemon = $state<boolean>(false);
let servers = $state<ServerConfig[]>([]);
let activeServerId = $state<string | null>(null);
let daemonUrl = $derived(
	servers.find((s) => s.id === activeServerId)?.url ?? ''
);

// ---------------------------------------------------------------------------
// Store lifecycle
// ---------------------------------------------------------------------------

let store: Store | null = null;

async function getStore(): Promise<Store> {
	if (!store) {
		store = await Store.load(STORE_FILE);
	}
	return store;
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function persistServers(s: Store): Promise<void> {
	await s.set('servers', servers);
}

async function persistActiveServerId(s: Store): Promise<void> {
	await s.set('activeServerId', activeServerId);
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/**
 * Ensures exactly one server has `isDefault: true` after any mutation
 * that could leave zero or multiple defaults.
 */
function ensureOneDefault(): void {
	if (servers.length === 0) return;

	const defaultCount = servers.filter((s) => s.isDefault).length;
	if (defaultCount !== 1) {
		servers = servers.map((s, i) => ({ ...s, isDefault: i === 0 }));
	}
}

// ---------------------------------------------------------------------------
// Initialisation + migration
// ---------------------------------------------------------------------------

/**
 * Initialises settings from the Tauri Store. Runs an idempotent one-time
 * migration so that users of the legacy `daemonUrl` preference are
 * transparently upgraded to the multi-server `servers[]` format.
 */
export async function initSettings(): Promise<void> {
	try {
		const s = await getStore();

		// --- auto-start (unchanged) ---
		const savedAutoStart = await s.get<boolean>('autoStartDaemon');
		if (typeof savedAutoStart === 'boolean') {
			autoStartDaemon = savedAutoStart;
		}

		// --- servers (migration gate) ---
		const savedServers = await s.get<ServerConfig[]>('servers');

		if (
			savedServers &&
			Array.isArray(savedServers) &&
			savedServers.length > 0
		) {
			// Already migrated — load as-is
			servers = savedServers;
		} else {
			// Migration path: read legacy daemonUrl
			const legacyUrl = await s.get<string>('daemonUrl');

			if (
				legacyUrl &&
				typeof legacyUrl === 'string' &&
				legacyUrl.trim()
			) {
				const url = normalizeServerUrl(legacyUrl);
				const config: ServerConfig = {
					id: generateServerId(),
					url,
					displayName: serverDisplayNameFallback(url),
					isLocal: isLocalUrl(url),
					isDefault: true,
				};
				servers = [config];
			} else {
				// Fresh install — seed the default local server
				const config: ServerConfig = {
					id: generateServerId(),
					...DEFAULT_LOCAL_SERVER_SEED,
				};
				servers = [config];
			}

			await persistServers(s);
		}

		// --- invariant: exactly one default ---
		ensureOneDefault();

		// --- active server ---
		const savedActiveId = await s.get<string>('activeServerId');
		if (
			savedActiveId &&
			typeof savedActiveId === 'string' &&
			servers.some((srv) => srv.id === savedActiveId)
		) {
			activeServerId = savedActiveId;
		} else {
			activeServerId =
				servers.find((srv) => srv.isDefault)?.id ??
				servers[0]?.id ??
				null;
			await persistActiveServerId(s);
		}

		await s.save();

		// Bootstrap the DaemonClient with the active server's URL so that
		// callers relying on the old singleton behaviour still work.
		const activeUrl =
			servers.find((srv) => srv.id === activeServerId)?.url ?? '';
		getDaemonClient(activeUrl || DEFAULT_LOCAL_SERVER_SEED.url);
	} catch {
		// Use module-level defaults on error (app will limp with empty state)
	}
}

// ---------------------------------------------------------------------------
// Server CRUD
// ---------------------------------------------------------------------------

/**
 * Adds a new server configuration and persists immediately.
 * If this is the first server, it is automatically made the default.
 */
export async function addServer(
	config: Omit<ServerConfig, 'id'>,
): Promise<void> {
	const id = generateServerId();
	const url = normalizeServerUrl(config.url);
	const displayName =
		config.displayName || serverDisplayNameFallback(url);
	const isLocal = isLocalUrl(url);

	const server: ServerConfig = {
		id,
		url,
		displayName,
		credentials: config.credentials,
		isDefault: config.isDefault ?? servers.length === 0,
		isLocal,
	};

	// If the new server is default, un-default all existing servers
	if (server.isDefault) {
		servers = servers.map((s) => ({ ...s, isDefault: false }));
	}

	servers = [...servers, server];

	const s = await getStore();
	await persistServers(s);
	await s.save();
}

/**
 * Merges `patch` into the server identified by `id`. If the URL is updated,
 * dependent fields (`url`, `isLocal`) are recomputed from the new URL.
 */
export async function updateServer(
	id: string,
	patch: Partial<Omit<ServerConfig, 'id'>>,
): Promise<void> {
	const idx = servers.findIndex((s) => s.id === id);
	if (idx === -1) return;

	const current = servers[idx];
	const updated: ServerConfig = { ...current, ...patch };

	// When URL changes, normalise and recompute derived fields
	if (patch.url !== undefined) {
		updated.url = normalizeServerUrl(patch.url);
		updated.isLocal = isLocalUrl(updated.url);
		if (patch.displayName === undefined && !current.displayName) {
			updated.displayName = serverDisplayNameFallback(updated.url);
		}
	}

	// Replace in-place via map to produce a new array reference
	servers = servers.map((s) => (s.id === id ? updated : s));

	const s = await getStore();
	await persistServers(s);
	await s.save();
}

/**
 * Removes the server identified by `id`. Refuses to remove the last server
 * (throws). If the removed server was the active or default server, those
 * roles are reassigned to the next available server.
 */
export async function removeServer(id: string): Promise<void> {
	const target = servers.find((s) => s.id === id);
	if (!target) return;

	if (servers.length <= 1) {
		throw new Error('Cannot remove the only configured server');
	}

	let newServers = servers.filter((s) => s.id !== id);

	// Promote another server to default if the removed one was default
	if (target.isDefault) {
		newServers = newServers.map((s, i) => ({
			...s,
			isDefault: i === 0,
		}));
	}

	// Switch active server if the removed one was active
	if (activeServerId === id) {
		const newDefault =
			newServers.find((s) => s.isDefault) ?? newServers[0];
		activeServerId = newDefault.id;
	}

	servers = newServers;

	const s = await getStore();
	await persistServers(s);
	await persistActiveServerId(s);
	await s.save();
}

// ---------------------------------------------------------------------------
// Active server selection
// ---------------------------------------------------------------------------

/**
 * Sets the active server by ID. No-ops if `id` does not match any server.
 */
export async function setActiveServer(id: string): Promise<void> {
	if (!servers.some((s) => s.id === id)) return;

	activeServerId = id;

	const s = await getStore();
	await persistActiveServerId(s);
	await s.save();
}

/**
 * Sets the given server as the default, clearing the flag on all others.
 */
export async function setDefaultServer(id: string): Promise<void> {
	if (!servers.some((s) => s.id === id)) return;

	servers = servers.map((s) => ({
		...s,
		isDefault: s.id === id,
	}));

	const s = await getStore();
	await persistServers(s);
	await s.save();
}

// ---------------------------------------------------------------------------
// auto-start daemon (unchanged from original)
// ---------------------------------------------------------------------------

export async function setAutoStartDaemon(value: boolean): Promise<void> {
	autoStartDaemon = value;

	try {
		const s = await getStore();
		await s.set('autoStartDaemon', value);
		await s.save();
	} catch {
		// Silent
	}
}

// ---------------------------------------------------------------------------
// Compatibility shim — keep existing consumers from breaking
// ---------------------------------------------------------------------------

/**
 * Deprecated — updates the active server's URL.
 *
 * Kept for backward compatibility with code that predates multi-server
 * support. Prefer {@link updateServer} with `{ url }`.
 */
export async function setDaemonUrl(url: string): Promise<void> {
	console.warn(
		'[settingsStore] setDaemonUrl is deprecated. Use updateServer(activeServerId, { url }) instead.',
	);

	if (
		!activeServerId ||
		!servers.some((s) => s.id === activeServerId)
	) {
		return;
	}

	const normalizedUrl = normalizeServerUrl(url);
	servers = servers.map((s) =>
		s.id === activeServerId
			? {
					...s,
					url: normalizedUrl,
					isLocal: isLocalUrl(normalizedUrl),
				}
			: s,
	);

	// Keep the legacy DaemonClient initialised for callers that depend on
	// the singleton being pre-configured.
	getDaemonClient(url);

	try {
		const s = await getStore();
		await persistServers(s);
		await s.save();
	} catch {
		// Silent
	}
}

// ---------------------------------------------------------------------------
// Exported store object
// ---------------------------------------------------------------------------

export const settingsStore = {
	/** @deprecated — returns the active server's URL for backward compat. */
	get daemonUrl() {
		return daemonUrl;
	},
	get autoStartDaemon() {
		return autoStartDaemon;
	},
	get servers() {
		return servers;
	},
	get activeServerId() {
		return activeServerId;
	},
	get activeServer() {
		return servers.find((s) => s.id === activeServerId) ?? null;
	},

	init: initSettings,
	setDaemonUrl,
	setAutoStartDaemon,
	addServer,
	updateServer,
	removeServer,
	setActiveServer,
	setDefaultServer,
};
