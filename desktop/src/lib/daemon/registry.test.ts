import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { registry, type RegistryHealthEntry } from './registry.js';
import { clearHealthCache, _overrideSleep } from './health.js';
import type { ServerConfig } from '$lib/types/server.js';

function server(overrides: Partial<ServerConfig> = {}): ServerConfig {
	const id = overrides.id ?? 'server-a';
	return {
		id,
		url: overrides.url ?? 'http://localhost:1337',
		displayName: overrides.displayName ?? id,
		credentials: overrides.credentials,
		isDefault: overrides.isDefault ?? false,
		isLocal: overrides.isLocal ?? true,
	};
}

function healthResponse(): Response {
	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
}

async function flushAsync(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

let fetchMock: ReturnType<typeof mock>;
let originalSetInterval: typeof setInterval;
let originalClearInterval: typeof clearInterval;
let intervalHandlers: Array<() => void>;
let intervalDelays: number[];
let clearedIntervals: number;

beforeEach(() => {
	registry.clear();
	clearHealthCache();
	_overrideSleep((_ms, signal) => {
		if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
		return Promise.resolve();
	});

	fetchMock = mock(() => Promise.resolve(healthResponse()));
	globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

	originalSetInterval = globalThis.setInterval;
	originalClearInterval = globalThis.clearInterval;
	intervalHandlers = [];
	intervalDelays = [];
	clearedIntervals = 0;

	Object.defineProperty(globalThis, 'window', {
		value: globalThis,
		configurable: true,
	});

	globalThis.setInterval = ((
		handler: Parameters<typeof setInterval>[0],
		timeout?: Parameters<typeof setInterval>[1],
	): ReturnType<typeof setInterval> => {
		if (typeof handler === 'function') {
			intervalHandlers.push(() => handler());
		}
		intervalDelays.push(typeof timeout === 'number' ? timeout : 0);
		return intervalHandlers.length as unknown as ReturnType<typeof setInterval>;
	}) as typeof setInterval;

	globalThis.clearInterval = ((_id?: Parameters<typeof clearInterval>[0]) => {
		clearedIntervals++;
	}) as typeof clearInterval;
});

afterEach(() => {
	registry.clear();
	clearHealthCache();
	globalThis.setInterval = originalSetInterval;
	globalThis.clearInterval = originalClearInterval;
	Reflect.deleteProperty(globalThis, 'window');
});

describe('registry.register', () => {
	it('creates a client and starts 10s health polling', async () => {
		registry.register(server());

		expect(registry.get('server-a')).not.toBeNull();
		expect(intervalDelays).toEqual([10_000]);

		await flushAsync();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:1337/health');
	});

	it('deduplicates DaemonClient instances by normalized server URL', () => {
		registry.register(server({ id: 'server-a', url: 'localhost:1337/' }));
		registry.register(server({ id: 'server-b', url: 'http://localhost:1337' }));

		expect(registry.get('server-a')).toBe(registry.get('server-b'));
	});

	it('passes credentials through to health polling without exposing them', async () => {
		registry.register(server({
			credentials: { username: 'admin', password: 'secret' },
		}));

		await flushAsync();

		const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
		const headers = init?.headers as Record<string, string> | undefined;
		expect(headers?.Authorization).toBe(`Basic ${btoa('admin:secret')}`);
	});
});

describe('registry accessors', () => {
	it('get(serverId) returns the registered client', () => {
		registry.register(server());

		const client = registry.get('server-a');

		expect(client).not.toBeNull();
		expect(client?.getBaseUrl()).toBe('http://localhost:1337');
	});

	it('setActive and getActiveServerId update active server state', () => {
		registry.register(server({ id: 'server-a' }));
		registry.register(server({ id: 'server-b', url: 'http://remote.example.com' }));

		registry.setActive('server-b');

		expect(registry.getActiveServerId()).toBe('server-b');
	});

	it('getActive returns the active server client', () => {
		registry.register(server({ id: 'server-a' }));
		registry.register(server({ id: 'server-b', url: 'http://remote.example.com' }));

		registry.setActive('server-b');

		const registeredClient = registry.get('server-b');
		if (!registeredClient) throw new Error('Expected server-b to be registered');

		expect(registry.getActive()).toBe(registeredClient);
		expect(registry.getActive().getBaseUrl()).toBe('http://remote.example.com');
	});

	it('getActive throws a clear error when no server is active', () => {
		expect(() => registry.getActive()).toThrow('No active daemon server is selected');
	});
});

describe('registry.unregister', () => {
	it('stops polling for the removed server', async () => {
		registry.register(server());
		await flushAsync();
		const callsBeforeUnregister = fetchMock.mock.calls.length;

		registry.unregister('server-a');
		intervalHandlers[0]?.();
		await flushAsync();

		expect(clearedIntervals).toBe(1);
		expect(fetchMock.mock.calls.length).toBe(callsBeforeUnregister);
		expect(registry.get('server-a')).toBeNull();
	});
});

describe('registry.subscribe', () => {
	it('fires when health updates', async () => {
		const updates: Array<{ serverId: string; entry: RegistryHealthEntry }> = [];
		registry.subscribe((serverId, entry) => updates.push({ serverId, entry }));

		registry.register(server());
		await flushAsync();

		expect(updates).toHaveLength(1);
		expect(updates[0].serverId).toBe('server-a');
		expect(updates[0].entry.status).toBe('connected');
		expect(updates[0].entry.lastCheck).toBeInstanceOf(Date);
	});

	it('fires when the active server changes', () => {
		const updates: Array<{ serverId: string; entry: RegistryHealthEntry }> = [];
		registry.register(server());
		registry.subscribe((serverId, entry) => updates.push({ serverId, entry }));

		registry.setActive('server-a');

		expect(updates).toHaveLength(1);
		expect(updates[0].serverId).toBe('server-a');
	});

	it('returns an unsubscribe function', async () => {
		const updates: RegistryHealthEntry[] = [];
		const unsubscribe = registry.subscribe((_serverId, entry) => updates.push(entry));

		unsubscribe();
		registry.register(server());
		await flushAsync();

		expect(updates).toHaveLength(0);
	});
});

describe('registry.clear', () => {
	it('resets clients, active server, subscribers, and intervals', async () => {
		const updates: RegistryHealthEntry[] = [];
		registry.subscribe((_serverId, entry) => updates.push(entry));
		registry.register(server());
		registry.setActive('server-a');

		registry.clear();
		intervalHandlers[0]?.();
		await flushAsync();

		expect(registry.get('server-a')).toBeNull();
		expect(registry.getActiveServerId()).toBeNull();
		expect(registry.getStatus('server-a')).toEqual({
			status: 'unknown',
			lastCheck: null,
			lastError: null,
			latencyMs: null,
		});
		expect(clearedIntervals).toBeGreaterThanOrEqual(1);

		registry.register(server({ id: 'server-b', url: 'http://remote.example.com' }));
		await flushAsync();
		expect(updates).toHaveLength(1);
	});
});
