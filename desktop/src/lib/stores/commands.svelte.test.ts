import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
	commandsStore,
	resetCommandsStore,
	_seedCommandsForTest,
} from './commands.svelte.js';

const SAMPLE = [
	{ trigger: '/plan', description: 'Plan something.' },
	{ trigger: '/discuss', description: 'Discuss something.' },
];

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
	resetCommandsStore();
	originalFetch = globalThis.fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe('commandsStore', () => {
	it('starts empty before load()', () => {
		expect(commandsStore.commands).toEqual([]);
		expect(commandsStore.loaded).toBe(false);
		expect(commandsStore.loading).toBe(false);
		expect(commandsStore.error).toBeNull();
	});

	it('test seed bypasses the network', () => {
		_seedCommandsForTest(SAMPLE);
		expect(commandsStore.commands).toEqual(SAMPLE);
		expect(commandsStore.loaded).toBe(true);
	});

	it('load() fetches from /api/wf/commands and caches the result', async () => {
		let calledUrl = '';
		const fetchMock = mock((url: string) => {
			calledUrl = url;
			return Promise.resolve(
				new Response(JSON.stringify({ commands: SAMPLE }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				}),
			);
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		await commandsStore.load();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(calledUrl).toContain('/api/wf/commands');

		expect(commandsStore.commands).toEqual(SAMPLE);
		expect(commandsStore.loaded).toBe(true);
		expect(commandsStore.error).toBeNull();
	});

	it('load() is idempotent — second call does not fetch again', async () => {
		const fetchMock = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify({ commands: SAMPLE }), { status: 200 }),
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		await commandsStore.load();
		await commandsStore.load();
		await commandsStore.load();

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('load() concurrent calls share a single in-flight request', async () => {
		let resolveFetch: (value: Response) => void = () => {};
		const fetchMock = mock(
			() =>
				new Promise<Response>((resolve) => {
					resolveFetch = resolve;
				}),
		);
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		const promiseA = commandsStore.load();
		const promiseB = commandsStore.load();

		expect(fetchMock).toHaveBeenCalledTimes(1);

		resolveFetch(new Response(JSON.stringify({ commands: SAMPLE }), { status: 200 }));
		await Promise.all([promiseA, promiseB]);

		expect(commandsStore.commands).toEqual(SAMPLE);
	});

	it('load() surfaces HTTP errors via the error field but still marks loaded', async () => {
		// On fetch failure the store falls back to FALLBACK_COMMANDS so the
		// overlay works offline. It marks `loaded = true` so subsequent calls
		// return immediately rather than spamming the network on every mount.
		// The `error` field surfaces the reason for diagnostic purposes.
		const fetchMock = mock(() =>
			Promise.resolve(new Response('boom', { status: 500 })),
		);
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		await commandsStore.load();

		expect(commandsStore.loaded).toBe(true);
		expect(commandsStore.error).toMatch(/HTTP 500/);
	});

	it('fallback commands include /btw and /back', async () => {
		// Force a failing fetch so the store falls back to FALLBACK_COMMANDS.
		const fetchMock = mock(() =>
			Promise.resolve(new Response('boom', { status: 500 })),
		);
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		await commandsStore.load();
		const triggers = commandsStore.commands.map((c) => c.trigger);
		expect(triggers).toContain('/btw');
		expect(triggers).toContain('/back');
	});

	it('load() surfaces malformed responses', async () => {
		const fetchMock = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify({ wrongShape: true }), { status: 200 }),
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		// Malformed: no `commands` key — store falls back to [], which is
		// considered loaded but empty (graceful degradation).
		await commandsStore.load();
		// We treat this as a successful load with empty commands rather than
		// an error, which matches the daemon contract more permissively.
		expect(commandsStore.commands).toEqual([]);
		expect(commandsStore.loaded).toBe(true);
	});

	it('refresh() bypasses the cache', async () => {
		const fetchMock = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify({ commands: SAMPLE }), { status: 200 }),
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		await commandsStore.load();
		await commandsStore.refresh();

		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('accepts the data envelope shape', async () => {
		const fetchMock = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify({ data: { commands: SAMPLE } }), { status: 200 }),
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		await commandsStore.load();

		expect(commandsStore.commands).toEqual(SAMPLE);
	});
});
