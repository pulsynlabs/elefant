import { registry } from '$lib/daemon/registry.js';
import { checkServerHealth } from '$lib/daemon/health.js';
import { settingsStore } from '$lib/stores/settings.svelte.js';
import { isCapacitorRuntime } from '$lib/runtime.js';
import type { ConnectionStatus } from '$lib/daemon/types.js';
import type { ServerHealthStatus } from '$lib/types/server.js';

// ---------------------------------------------------------------------------
// Module-level reactive state (Svelte 5 runes)
// ---------------------------------------------------------------------------

let activeStatus = $state<ConnectionStatus>('disconnected');
let lastHealthCheck = $state<Date | null>(null);
let lastError = $state<string | null>(null);

// ---------------------------------------------------------------------------
// Internal tracking
// ---------------------------------------------------------------------------

let started = false;
let _unsubscribe: (() => void) | null = null;
let _networkHandle: { remove: () => Promise<void> } | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map the registry's 4-variant health status to the public 3-variant type. */
function mapStatus(s: ServerHealthStatus): ConnectionStatus {
	return s === 'unknown' ? 'disconnected' : s;
}

async function doHealthCheck(): Promise<void> {
	const sid = registry.getActiveServerId();
	if (!sid) return;

	const server = settingsStore.servers.find((s) => s.id === sid);
	if (!server) return;

	const result = await checkServerHealth(server.url, {
		credentials: server.credentials,
	});

	if (result.ok) {
		activeStatus = 'connected';
		lastError = null;
	} else {
		activeStatus = 'disconnected';
		lastError = result.error;
	}
	lastHealthCheck = new Date();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function start(): void {
	if (started) return;
	started = true;

	// 1. Register every server configured in settings.
	for (const server of settingsStore.servers) {
		registry.register(server);
	}

	// 2. Activate the persisted active server (or the first available).
	const activeId =
		settingsStore.activeServerId ?? settingsStore.servers[0]?.id;
	if (activeId && registry.get(activeId)) {
		registry.setActive(activeId);
	}

	// 3. Bridge the framework-agnostic registry into Svelte reactivity.
	//    When the registry fires a health update for the active server,
	//    push the values into the module-level $state so that every
	//    consumer reading connectionStore.status re-renders.
	_unsubscribe = registry.subscribe((serverId, entry) => {
		if (serverId === registry.getActiveServerId()) {
			activeStatus = mapStatus(entry.status);
			lastHealthCheck = entry.lastCheck;
			lastError = entry.lastError;
		}
	});

	// 4. Seed the reactive state from whatever the registry already
	//    knows (the register() call above started polling, so a result
	//    may already exist before the subscription was installed).
	const initialId = registry.getActiveServerId();
	if (initialId) {
		const entry = registry.getStatus(initialId);
		activeStatus = mapStatus(entry.status);
		lastHealthCheck = entry.lastCheck;
		lastError = entry.lastError;
	}

	// 5. Kick off an immediate health check so the UI resolves quickly.
	void doHealthCheck();

	// 6. Mobile network-change reconnect (W5.T4 / MH7). On Capacitor,
	//    when the device transitions WiFi → cellular or wakes from
	//    background, fire a fresh health check so the UI reconnects
	//    without waiting for the next poll cycle. The variable specifier
	//    + /* @vite-ignore */ pattern keeps Vite from trying to resolve
	//    @capacitor/network at desktop build time (the package lives in
	//    mobile/node_modules) and the isCapacitorRuntime guard prevents
	//    the dynamic import from running on desktop or browser builds.
	//    A 1-second settle delay lets Android finish DNS / route updates
	//    before we hit the daemon — without it, the first probe usually
	//    races the network bring-up and reports a false negative.
	if (isCapacitorRuntime) {
		const moduleName = '@capacitor/network';
		(async () => {
			try {
				const { Network } = await import(/* @vite-ignore */ moduleName);
				_networkHandle = await Network.addListener(
					'networkStatusChange',
					(status: { connected: boolean }) => {
						if (status.connected && started) {
							setTimeout(() => void doHealthCheck(), 1000);
						}
					},
				);
			} catch {
				// Silent — network plugin may be unavailable in dev/web preview.
			}
		})();
	}
}

function stop(): void {
	_unsubscribe?.();
	_unsubscribe = null;
	void _networkHandle?.remove();
	_networkHandle = null;
	registry.clear();
	started = false;

	activeStatus = 'disconnected';
	lastHealthCheck = null;
	lastError = null;
}

// ---------------------------------------------------------------------------
// Exported store object — identical public surface to the original
// ---------------------------------------------------------------------------

export const connectionStore = {
	get status(): ConnectionStatus {
		return activeStatus;
	},
	get isConnected(): boolean {
		return activeStatus === 'connected';
	},
	get lastHealthCheck(): Date | null {
		return lastHealthCheck;
	},
	get lastError(): string | null {
		return lastError;
	},
	start,
	stop,
	checkNow: doHealthCheck,
};
