import { DaemonClient } from '$lib/daemon/client.js';
import { checkServerHealth } from '$lib/daemon/health.js';
import { normalizeServerUrl } from '$lib/daemon/server-utils.js';
import type { ServerConfig, ServerHealthStatus } from '$lib/types/server.js';

export type RegistryHealthEntry = {
	status: ServerHealthStatus;
	lastCheck: Date | null;
	lastError: string | null;
	latencyMs: number | null;
};

type RegistrySubscriber = (serverId: string, entry: RegistryHealthEntry) => void;
type PollTimer = ReturnType<typeof setInterval>;

const POLL_INTERVAL_MS = 10_000;

const serversById = new Map<string, ServerConfig>();
const clientKeysByServerId = new Map<string, string>();
const clientsByUrl = new Map<string, DaemonClient>();
const pollersByServerId = new Map<string, PollTimer>();
const healthByServerId = new Map<string, RegistryHealthEntry>();
const subscribers = new Set<RegistrySubscriber>();

let activeServerId: string | null = null;
let visibilityListenerAttached = false;

const unknownEntry = (): RegistryHealthEntry => ({
	status: 'unknown',
	lastCheck: null,
	lastError: null,
	latencyMs: null,
});

function cloneEntry(entry: RegistryHealthEntry): RegistryHealthEntry {
	return {
		status: entry.status,
		lastCheck: entry.lastCheck ? new Date(entry.lastCheck) : null,
		lastError: entry.lastError,
		latencyMs: entry.latencyMs,
	};
}

function notify(serverId: string): void {
	const entry = cloneEntry(healthByServerId.get(serverId) ?? unknownEntry());
	for (const subscriber of subscribers) {
		subscriber(serverId, entry);
	}
}

function isDocumentHidden(): boolean {
	return typeof document !== 'undefined' && document.hidden;
}

function removeClientIfUnused(clientKey: string): void {
	for (const registeredClientKey of clientKeysByServerId.values()) {
		if (registeredClientKey === clientKey) return;
	}
	clientsByUrl.delete(clientKey);
}

function stopPolling(serverId: string): void {
	const poller = pollersByServerId.get(serverId);
	if (!poller) return;

	clearInterval(poller);
	pollersByServerId.delete(serverId);
}

async function pollHealth(serverId: string): Promise<void> {
	if (isDocumentHidden()) return;

	const server = serversById.get(serverId);
	if (!server) return;

	const clientKey = clientKeysByServerId.get(serverId) ?? normalizeServerUrl(server.url);
	const result = await checkServerHealth(clientKey, {
		credentials: server.credentials,
	});

	if (!serversById.has(serverId)) return;

	const entry: RegistryHealthEntry = result.ok
		? {
				status: 'connected',
				lastCheck: new Date(),
				lastError: null,
				latencyMs: result.latencyMs,
			}
		: {
				status: 'disconnected',
				lastCheck: new Date(),
				lastError: result.error,
				latencyMs: null,
			};

	healthByServerId.set(serverId, entry);
	notify(serverId);
}

function startPolling(serverId: string): void {
	stopPolling(serverId);
	void pollHealth(serverId);

	if (typeof window === 'undefined') return;

	const poller = setInterval(() => {
		void pollHealth(serverId);
	}, POLL_INTERVAL_MS);
	pollersByServerId.set(serverId, poller);
}

function pollAllRegisteredServers(): void {
	for (const serverId of serversById.keys()) {
		void pollHealth(serverId);
	}
}

function ensureVisibilityListener(): void {
	if (visibilityListenerAttached || typeof document === 'undefined') return;

	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) {
			pollAllRegisteredServers();
		}
	});
	visibilityListenerAttached = true;
}

export const registry = {
	register(server: ServerConfig): void {
		const previousClientKey = clientKeysByServerId.get(server.id);
		if (previousClientKey) {
			stopPolling(server.id);
			clientKeysByServerId.delete(server.id);
			removeClientIfUnused(previousClientKey);
		}

		const clientKey = normalizeServerUrl(server.url);
		if (!clientsByUrl.has(clientKey)) {
			clientsByUrl.set(clientKey, new DaemonClient(clientKey));
		}

		const normalizedServer: ServerConfig = {
			...server,
			url: clientKey,
		};

		serversById.set(server.id, normalizedServer);
		clientKeysByServerId.set(server.id, clientKey);
		healthByServerId.set(server.id, healthByServerId.get(server.id) ?? unknownEntry());
		ensureVisibilityListener();
		startPolling(server.id);
	},

	unregister(serverId: string): void {
		stopPolling(serverId);

		const clientKey = clientKeysByServerId.get(serverId);
		serversById.delete(serverId);
		clientKeysByServerId.delete(serverId);
		healthByServerId.delete(serverId);

		if (clientKey) {
			removeClientIfUnused(clientKey);
		}

		if (activeServerId === serverId) {
			activeServerId = null;
		}
	},

	get(serverId: string): DaemonClient | null {
		const clientKey = clientKeysByServerId.get(serverId);
		return clientKey ? (clientsByUrl.get(clientKey) ?? null) : null;
	},

	getByUrl(url: string): DaemonClient | null {
		return clientsByUrl.get(normalizeServerUrl(url)) ?? null;
	},

	getActive(): DaemonClient {
		if (!activeServerId) {
			throw new Error('No active daemon server is selected');
		}

		const client = this.get(activeServerId);
		if (!client) {
			throw new Error(`Active daemon server is not registered: ${activeServerId}`);
		}

		return client;
	},

	setActive(serverId: string): void {
		if (!serversById.has(serverId)) {
			throw new Error(`Cannot activate unregistered daemon server: ${serverId}`);
		}

		activeServerId = serverId;
		notify(serverId);
	},

	getActiveServerId(): string | null {
		return activeServerId;
	},

	getStatus(serverId: string): RegistryHealthEntry {
		return cloneEntry(healthByServerId.get(serverId) ?? unknownEntry());
	},

	subscribe(fn: RegistrySubscriber): () => void {
		subscribers.add(fn);
		return () => {
			subscribers.delete(fn);
		};
	},

	clear(): void {
		for (const serverId of pollersByServerId.keys()) {
			stopPolling(serverId);
		}

		serversById.clear();
		clientKeysByServerId.clear();
		clientsByUrl.clear();
		healthByServerId.clear();
		subscribers.clear();
		activeServerId = null;
	},
};
