/**
 * MCP service — all MCP server CRUD, registry browsing, and live status
 * updates flow through the daemon HTTP / SSE API. The desktop never talks
 * to MCP servers directly.
 *
 * Mirrors the shape of `config-service.ts` so callers consume one cohesive
 * `mcpService` object the same way they consume `configService`.
 */

import type {
	McpServerConfig,
	McpServerWithStatus,
	McpToolEntry,
	McpRegistryResponse,
	McpStatusEvent,
} from '$lib/daemon/types.js';
import { getDaemonClient } from '$lib/daemon/client.js';

function baseUrl(): string {
	return getDaemonClient().getBaseUrl();
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
	return fetch(`${baseUrl()}${path}`, {
		...init,
		headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
	});
}

/**
 * Read the daemon response shape `{ ok, data }` and surface a concrete
 * Error when the call failed. The daemon also returns `{ ok: false, error }`
 * for handled failures — both shapes funnel through here.
 */
async function readJson<T>(res: Response): Promise<T> {
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `HTTP ${res.status}`);
	}
	const body = (await res.json()) as
		| { ok: true; data: T }
		| { ok: false; error: string }
		| T;
	if (body && typeof body === 'object' && 'ok' in body) {
		if (body.ok) return body.data;
		throw new Error(body.error);
	}
	// Some routes return the payload directly without an envelope.
	return body as T;
}

export async function listServers(): Promise<McpServerWithStatus[]> {
	const res = await apiFetch('/api/mcp/servers');
	return readJson<McpServerWithStatus[]>(res);
}

export async function getServer(id: string): Promise<McpServerWithStatus> {
	const res = await apiFetch(`/api/mcp/servers/${encodeURIComponent(id)}`);
	return readJson<McpServerWithStatus>(res);
}

export async function addServer(config: McpServerConfig): Promise<McpServerWithStatus> {
	const res = await apiFetch('/api/mcp/servers', {
		method: 'POST',
		body: JSON.stringify(config),
	});
	return readJson<McpServerWithStatus>(res);
}

export async function updateServer(
	id: string,
	config: Partial<McpServerConfig>,
): Promise<McpServerWithStatus> {
	const res = await apiFetch(`/api/mcp/servers/${encodeURIComponent(id)}`, {
		method: 'PUT',
		body: JSON.stringify(config),
	});
	return readJson<McpServerWithStatus>(res);
}

export async function deleteServer(id: string): Promise<void> {
	const res = await apiFetch(`/api/mcp/servers/${encodeURIComponent(id)}`, {
		method: 'DELETE',
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `HTTP ${res.status}`);
	}
}

export async function connectServer(id: string): Promise<void> {
	const res = await apiFetch(
		`/api/mcp/servers/${encodeURIComponent(id)}/connect`,
		{ method: 'POST' },
	);
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `HTTP ${res.status}`);
	}
}

export async function disconnectServer(id: string): Promise<void> {
	const res = await apiFetch(
		`/api/mcp/servers/${encodeURIComponent(id)}/disconnect`,
		{ method: 'POST' },
	);
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `HTTP ${res.status}`);
	}
}

export async function listServerTools(id: string): Promise<McpToolEntry[]> {
	const res = await apiFetch(`/api/mcp/servers/${encodeURIComponent(id)}/tools`);
	return readJson<McpToolEntry[]>(res);
}

export async function pinTool(
	id: string,
	toolName: string,
	pinned: boolean,
): Promise<void> {
	const res = await apiFetch(
		`/api/mcp/servers/${encodeURIComponent(id)}/pin`,
		{
			method: 'POST',
			body: JSON.stringify({ toolName, pinned }),
		},
	);
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `HTTP ${res.status}`);
	}
}

export async function fetchRegistry(opts: {
	source?: 'anthropic' | 'smithery' | 'bundled' | 'all';
	page?: number;
	query?: string;
} = {}): Promise<McpRegistryResponse> {
	const params = new URLSearchParams();
	if (opts.source) params.set('source', opts.source);
	if (opts.page !== undefined) params.set('page', String(opts.page));
	if (opts.query) params.set('query', opts.query);
	const qs = params.toString();
	const res = await apiFetch(`/api/mcp/registry${qs ? `?${qs}` : ''}`);
	return readJson<McpRegistryResponse>(res);
}

export async function refreshRegistry(): Promise<void> {
	const res = await apiFetch('/api/mcp/registry/refresh', { method: 'POST' });
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `HTTP ${res.status}`);
	}
}

/**
 * Subscribe to MCP status / tool-change events from the daemon.
 *
 * The daemon publishes two named SSE events on `/api/mcp/events`:
 *   - `mcp.status.changed`: server connection state transitioned
 *   - `mcp.tools.changed`: server's tool list was refreshed
 *
 * The returned function disposes the EventSource. Components MUST call it
 * on unmount — leaked EventSources keep TCP sockets alive forever.
 */
export function subscribeToStatus(
	cb: (event: McpStatusEvent) => void,
): () => void {
	const url = `${baseUrl()}/api/mcp/events`;
	const es = new EventSource(url);

	const KNOWN_EVENTS: ReadonlyArray<McpStatusEvent['type']> = [
		'mcp.status.changed',
		'mcp.tools.changed',
	];

	for (const name of KNOWN_EVENTS) {
		es.addEventListener(name, (e: Event) => {
			const me = e as MessageEvent;
			try {
				const payload = JSON.parse(me.data) as Omit<McpStatusEvent, 'type'>;
				cb({ type: name, ...payload });
			} catch {
				// Malformed payload — drop silently rather than crash the UI.
			}
		});
	}

	return () => {
		es.close();
	};
}

export const mcpService = {
	listServers,
	getServer,
	addServer,
	updateServer,
	deleteServer,
	connectServer,
	disconnectServer,
	listServerTools,
	pinTool,
	fetchRegistry,
	refreshRegistry,
	subscribeToStatus,
};
