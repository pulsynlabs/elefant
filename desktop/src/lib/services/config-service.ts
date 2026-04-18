/**
 * Config service — all config reads/writes go through the daemon HTTP API.
 * The desktop never touches the filesystem directly.
 */

import type { ElefantConfig, ProviderEntry } from '$lib/daemon/types.js';
import { getDaemonClient } from '$lib/daemon/client.js';

function baseUrl(): string {
	return getDaemonClient().getBaseUrl();
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
	const res = await fetch(`${baseUrl()}${path}`, {
		...init,
		headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
	});
	return res;
}

export type MaskedConfig = Omit<ElefantConfig, 'providers'> & {
	providers: Array<Omit<ProviderEntry, 'apiKey'> & { apiKey: string }>;
};

export async function readConfig(): Promise<MaskedConfig | null> {
	try {
		const res = await apiFetch('/api/config');
		if (res.status === 404) return null;
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const body = await res.json() as { ok: boolean; config: MaskedConfig };
		return body.config;
	} catch {
		return null;
	}
}

export async function updateConfig(
	patch: Partial<Pick<ElefantConfig, 'port' | 'defaultProvider' | 'logLevel'>>,
): Promise<void> {
	const res = await apiFetch('/api/config', {
		method: 'PUT',
		body: JSON.stringify(patch),
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({})) as { error?: string };
		throw new Error(body.error ?? `HTTP ${res.status}`);
	}
}

export async function addProvider(provider: ProviderEntry): Promise<'created' | 'exists'> {
	const res = await apiFetch('/api/providers', {
		method: 'POST',
		body: JSON.stringify(provider),
	});
	if (res.status === 409) return 'exists';
	if (!res.ok) {
		const body = await res.json().catch(() => ({})) as { error?: string };
		throw new Error(body.error ?? `HTTP ${res.status}`);
	}
	return 'created';
}

export async function updateProvider(name: string, provider: ProviderEntry): Promise<void> {
	const res = await apiFetch(`/api/providers/${encodeURIComponent(name)}`, {
		method: 'PUT',
		body: JSON.stringify(provider),
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({})) as { error?: string };
		throw new Error(body.error ?? `HTTP ${res.status}`);
	}
}

export async function deleteProvider(name: string): Promise<void> {
	const res = await apiFetch(`/api/providers/${encodeURIComponent(name)}`, {
		method: 'DELETE',
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({})) as { error?: string };
		throw new Error(body.error ?? `HTTP ${res.status}`);
	}
}

export const configService = {
	readConfig,
	updateConfig,
	addProvider,
	updateProvider,
	deleteProvider,
};
