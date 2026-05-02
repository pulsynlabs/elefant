import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { registry } from '$lib/daemon/registry.js';
import type { ServerConfig } from '$lib/types/server.js';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Mocks — must be called before the module under test is loaded.
// The test-setup plugin resolves $lib/ imports to absolute .svelte.ts paths,
// so we must use the fully-resolved path for mock.module to match.
// ---------------------------------------------------------------------------

let _mockCredentials: { username: string; password: string } | undefined;

const settingsModulePath = resolve(
	import.meta.dirname,
	'..',
	'stores',
	'settings.svelte.ts',
);

mock.module(settingsModulePath, () => ({
	settingsStore: {
		get activeServer() {
			if (!_mockCredentials) return null;
			return { credentials: _mockCredentials };
		},
		init: () => Promise.resolve(),
	},
}));

const { listRemoteDirectory } = await import('./fs-service.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_SERVER: ServerConfig = {
	id: 'test-server',
	url: 'http://localhost:1337',
	displayName: 'Test',
	isLocal: true,
	isDefault: true,
};

function okBody(overrides: Record<string, unknown> = {}): {
	ok: true;
	data: { path: string; parent: string; entries: { name: string; isDir: boolean }[] };
} {
	return {
		ok: true,
		data: {
			path: '/home/user/projects',
			parent: '/home/user',
			entries: [
				{ name: 'elefant', isDir: true },
				{ name: 'side-project', isDir: true },
			],
			...overrides,
		},
	};
}

function response(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('listRemoteDirectory', () => {
	let fetchMock: ReturnType<typeof mock>;

	beforeEach(() => {
		registry.clear();
		registry.register(TEST_SERVER);
		registry.setActive('test-server');
		_mockCredentials = undefined;

		fetchMock = mock(
			(_input: RequestInfo | URL, _init?: RequestInit) =>
				Promise.resolve(response(200, okBody())),
		);
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
	});

	// ── Success ────────────────────────────────────────────────────────────

	it('returns { ok: true, data } for a successful listing', async () => {
		const result = await listRemoteDirectory('/home/user/projects');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.path).toBe('/home/user/projects');
			expect(result.data.parent).toBe('/home/user');
			expect(result.data.entries).toHaveLength(2);
			expect(result.data.entries[0]).toEqual({
				name: 'elefant',
				isDir: true,
			});
		}
	});

	it('calls the correct URL with path encoded', async () => {
		await listRemoteDirectory('/home/user/my projects');

		const calls = fetchMock.mock.calls as [string, RequestInit | undefined][];
		expect(calls).toHaveLength(1);
		expect(calls[0][0]).toBe(
			'http://localhost:1337/api/fs/list?path=%2Fhome%2Fuser%2Fmy%20projects',
		);
	});

	it('omits the query string when path is undefined', async () => {
		await listRemoteDirectory();

		const calls = fetchMock.mock.calls as [string, RequestInit | undefined][];
		expect(calls).toHaveLength(1);
		expect(calls[0][0]).toBe('http://localhost:1337/api/fs/list');
	});

	// ── Server error ───────────────────────────────────────────────────────

	it('returns { ok: false, error } when the server responds with an error envelope', async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(response(404, { ok: false, error: 'Path not found' })),
		) as unknown as typeof globalThis.fetch;

		const result = await listRemoteDirectory('/nonexistent');

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe('Path not found');
		}
	});

	it('returns { ok: false, error } for a non-2xx response without JSON body', async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response('Gateway Timeout', {
					status: 504,
					statusText: 'Gateway Timeout',
				}),
			),
		) as unknown as typeof globalThis.fetch;

		const result = await listRemoteDirectory();

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe('HTTP 504: Gateway Timeout');
		}
	});

	// ── Network failure ────────────────────────────────────────────────────

	it('returns { ok: false, error } on network failure', async () => {
		globalThis.fetch = mock(() =>
			Promise.reject(new TypeError('fetch failed')),
		) as unknown as typeof globalThis.fetch;

		const result = await listRemoteDirectory();

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe('fetch failed');
		}
	});

	// ── Auth header ────────────────────────────────────────────────────────

	it('includes Authorization header when active server has credentials', async () => {
		_mockCredentials = { username: 'alice', password: 'secret' };

		await listRemoteDirectory();

		const calls = fetchMock.mock.calls as [string, RequestInit | undefined][];
		expect(calls).toHaveLength(1);
		const init = calls[0][1];
		expect(init?.headers).toBeDefined();

		const headers = init!.headers as Record<string, string>;
		expect(headers['Authorization']).toBe('Basic YWxpY2U6c2VjcmV0');
	});

	it('omits Authorization header when active server has no credentials', async () => {
		await listRemoteDirectory();

		const calls = fetchMock.mock.calls as [string, RequestInit | undefined][];
		expect(calls).toHaveLength(1);
		const init = calls[0][1];
		const headers = (init?.headers ?? {}) as Record<string, string>;
		expect(headers['Authorization']).toBeUndefined();
	});
});
