import { getDaemonClient } from '$lib/daemon/client.js';
import type { ServerConfig } from '$lib/types/server.js';
import { DEFAULT_LOCAL_SERVER_SEED } from '$lib/types/server.js';
import {
	normalizeServerUrl,
	generateServerId,
	isLocalUrl,
	serverDisplayNameFallback,
} from '$lib/daemon/server-utils.js';
import { isCapacitorRuntime } from '$lib/runtime.js';

/**
 * True when running inside a Tauri webview; false in plain browser/serve mode.
 * Exported so other modules (e.g. dialog.ts) can read the same flag.
 */
export const isTauriRuntime: boolean =
	typeof window !== 'undefined' && '__TAURI__' in window;

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

// Lazily imported so the module doesn't fail to parse in browser mode where
// the Tauri plugin throws on import.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type TauriStore = Awaited<ReturnType<typeof import('@tauri-apps/plugin-store').Store.load>>;
let store: TauriStore | null = null;

async function getStore(): Promise<TauriStore> {
	if (!store) {
		const { Store } = await import('@tauri-apps/plugin-store');
		store = await Store.load(STORE_FILE);
	}
	return store;
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function persistServers(s: TauriStore): Promise<void> {
	await s.set('servers', servers);
	await persistToCapacitor('servers', servers);
}

async function persistActiveServerId(s: TauriStore): Promise<void> {
	await s.set('activeServerId', activeServerId);
	await persistToCapacitor('activeServerId', activeServerId);
}

/**
 * Persist a value to Capacitor Preferences when running in Capacitor runtime.
 * Silently no-ops on other platforms.
 */
async function persistToCapacitor(key: string, value: unknown): Promise<void> {
	if (!isCapacitorRuntime) return;
	try {
		const { Preferences } = await import('@capacitor/preferences');
		await Preferences.set({ key, value: JSON.stringify(value) });
	} catch {
		/* silent — best-effort persistence */
	}
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
 * Seeds the server list from `window.location.origin` when running in
 * browser/serve mode (no Tauri runtime). The origin IS the proxy URL for the
 * daemon, so no configuration is needed — the browser already knows where it is.
 */
function initBrowserMode(): void {
	const origin = normalizeServerUrl(
		typeof window !== 'undefined' ? window.location.origin : DEFAULT_LOCAL_SERVER_SEED.url,
	);
	const config: ServerConfig = {
		id: generateServerId(),
		url: origin,
		displayName: serverDisplayNameFallback(origin),
		isLocal: isLocalUrl(origin),
		isDefault: true,
	};
	servers = [config];
	activeServerId = config.id;
	getDaemonClient(origin);
}

/**
 * Initialises settings from Capacitor Preferences when running in Capacitor
 * runtime. Uses the same key names as the Tauri Store so config migrates
 * naturally if someone switches builds.
 */
async function initCapacitorMode(): Promise<void> {
	try {
		const { Preferences } = await import('@capacitor/preferences');

		const savedServers = (await Preferences.get({ key: 'servers' })).value;
		if (savedServers) {
			const parsed = JSON.parse(savedServers) as ServerConfig[];
			if (Array.isArray(parsed) && parsed.length > 0) {
				servers = parsed;
			}
		}

		ensureOneDefault();

		const savedActiveId = (await Preferences.get({ key: 'activeServerId' })).value;
		if (savedActiveId && servers.some((s) => s.id === savedActiveId)) {
			activeServerId = savedActiveId;
		} else {
			activeServerId = servers.find((s) => s.isDefault)?.id ?? servers[0]?.id ?? null;
		}

		// Bootstrap the daemon client
		const activeUrl = servers.find((s) => s.id === activeServerId)?.url ?? '';
		getDaemonClient(activeUrl || DEFAULT_LOCAL_SERVER_SEED.url);
	} catch {
		// Fall back to browser mode seed (already applied by initBrowserMode())
	}
}

export async function initSettings(): Promise<void> {
	// Always seed from the page origin first so the app is never left with
	// an empty server list. If we're in a Tauri or Capacitor runtime, the
	// platform-specific load below will overwrite this with the user's
	// persisted preferences.
	initBrowserMode();

	// Non-Tauri, non-Capacitor (browser/serve mode) — browser-mode seed is all we need.
	if (!isTauriRuntime && !isCapacitorRuntime) {
		return;
	}

	// Capacitor mode — load from @capacitor/preferences
	if (isCapacitorRuntime) {
		await initCapacitorMode();
		return;
	}

	// Tauri mode — load from Tauri Store
	try {
		const s = await getStore().catch(() => null);
		if (!s) {
			// Store unavailable — browser-mode seed already applied above.
			return;
		}

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
		// Any Tauri Store error — fall back to browser mode so the app
		// always has at least one server configured and can connect.
		if (servers.length === 0) {
			initBrowserMode();
		}
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

	if (isTauriRuntime) {
		const s = await getStore();
		await persistServers(s);
		await s.save();
	}
	await persistToCapacitor('servers', servers);
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

	if (isTauriRuntime) {
		const s = await getStore();
		await persistServers(s);
		await s.save();
	}
	await persistToCapacitor('servers', servers);
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

	if (isTauriRuntime) {
		const s = await getStore();
		await persistServers(s);
		await persistActiveServerId(s);
		await s.save();
	}
	await persistToCapacitor('servers', servers);
	await persistToCapacitor('activeServerId', activeServerId);
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

	if (isTauriRuntime) {
		const s = await getStore();
		await persistActiveServerId(s);
		await s.save();
	}
	await persistToCapacitor('activeServerId', activeServerId);
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

	if (isTauriRuntime) {
		const s = await getStore();
		await persistServers(s);
		await s.save();
	}
	await persistToCapacitor('servers', servers);
}

// ---------------------------------------------------------------------------
// auto-start daemon (unchanged from original)
// ---------------------------------------------------------------------------

export async function setAutoStartDaemon(value: boolean): Promise<void> {
	autoStartDaemon = value;

	if (isTauriRuntime) {
		try {
			const s = await getStore();
			await s.set('autoStartDaemon', value);
			await s.save();
		} catch {
			// Silent
		}
	}
	await persistToCapacitor('autoStartDaemon', value);
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

	if (isTauriRuntime) {
		try {
			const s = await getStore();
			await persistServers(s);
			await s.save();
		} catch {
			// Silent
		}
	}
	await persistToCapacitor('servers', servers);
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
