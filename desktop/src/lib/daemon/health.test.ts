import { describe, it, expect, beforeEach, mock } from 'bun:test';
import {
	checkServerHealth,
	clearHealthCache,
	_overrideSleep,
} from './health.js';

function okResponse(): Response {
	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
}

function failResponse(status: number, body = 'Server error'): Response {
	return new Response(body, { status });
}

let fetchMock: ReturnType<typeof mock>;

beforeEach(() => {
	fetchMock = mock(() => Promise.resolve(okResponse()));
	globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
	clearHealthCache();
	_overrideSleep((_ms, signal) => {
		if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
		return Promise.resolve();
	});
});

describe('checkServerHealth', () => {
	// ── Success ──────────────────────────────────────────────────────────
	it('fetches /health and returns { ok: true, latencyMs }', async () => {
		const result = await checkServerHealth('http://localhost:1337');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.latencyMs).toBeGreaterThanOrEqual(0);
		}
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:1337/health');
	});

	// ── Non-2xx status ──────────────────────────────────────────────────
	it('returns { ok: false } for non-2xx responses', async () => {
		fetchMock.mockImplementation(() =>
			Promise.resolve(failResponse(503, 'Service Unavailable')),
		);

		const result = await checkServerHealth('http://localhost:1337', { retryCount: 0 });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('503');
		}
	});

	// ── Network error ───────────────────────────────────────────────────
	it('returns { ok: false } for network errors', async () => {
		fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

		const result = await checkServerHealth('http://localhost:1337', { retryCount: 0 });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('ECONNREFUSED');
		}
	});

	// ── Caching: second call within cache window ────────────────────────
	it('caches results so second call within cacheMs returns cached value', async () => {
		const result1 = await checkServerHealth('http://localhost:1337', { cacheMs: 1000 });
		const result2 = await checkServerHealth('http://localhost:1337', { cacheMs: 1000 });

		expect(result1).toEqual(result2);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	// ── In-flight deduplication ─────────────────────────────────────────
	it('deduplicates concurrent calls (only one fetch)', async () => {
		let callCount = 0;
		fetchMock.mockImplementation(() => {
			callCount++;
			return Promise.resolve(okResponse());
		});

		const [r1, r2] = await Promise.all([
			checkServerHealth('http://localhost:1337', { cacheMs: 750 }),
			checkServerHealth('http://localhost:1337', { cacheMs: 750 }),
		]);

		expect(callCount).toBe(1);
		expect(r1).toEqual(r2);
	});

	// ── Cache expiry ────────────────────────────────────────────────────
	it('re-fetches after cache expires', async () => {
		await checkServerHealth('http://localhost:1337', { cacheMs: 10 });
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await new Promise((r) => setTimeout(r, 15));

		await checkServerHealth('http://localhost:1337', { cacheMs: 10 });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	// ── Timeout ─────────────────────────────────────────────────────────
	it('returns { ok: false } when internal timeout fires', async () => {
		// Signal-aware mock: listens for abort event and rejects,
		// otherwise the returned promise hangs (simulating a stuck server).
		fetchMock = mock((_input: RequestInfo | URL, init?: RequestInit) => {
			return new Promise<Response>((_resolve, reject) => {
				const sig = init?.signal;
				if (sig instanceof AbortSignal && sig.aborted) {
					reject(new DOMException('Aborted', 'AbortError'));
					return;
				}
				sig?.addEventListener(
					'abort',
					() => reject(new DOMException('Aborted', 'AbortError')),
					{ once: true },
				);
			});
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		const result = await checkServerHealth('http://localhost:1337', {
			timeoutMs: 50,
			retryCount: 0,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe('Aborted');
		}
	});

	// ── Retry: succeeds on second attempt ───────────────────────────────
	it('retries on failure and succeeds on second attempt', async () => {
		let attempts = 0;
		fetchMock.mockImplementation(() => {
			attempts++;
			if (attempts === 1) {
				return Promise.reject(new Error('network error'));
			}
			return Promise.resolve(okResponse());
		});

		const result = await checkServerHealth('http://localhost:1337', { retryCount: 2 });

		expect(result.ok).toBe(true);
		expect(attempts).toBe(2);
	});

	// ── Retry: all attempts fail ────────────────────────────────────────
	it('returns { ok: false } after all retries exhausted', async () => {
		fetchMock.mockRejectedValue(new Error('persistent failure'));

		const result = await checkServerHealth('http://localhost:1337', { retryCount: 2 });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('persistent failure');
		}
		expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
	});

	// ── Caller AbortSignal during retry wait ────────────────────────────
	it('aborts mid-retry wait when caller signal fires', async () => {
		const controller = new AbortController();

		fetchMock.mockRejectedValue(new Error('network error'));

		// Replace sleep so that it aborts the caller signal, simulating
		// the user cancelling while the retry backoff is waiting.
		_overrideSleep((_ms, signal) => {
			controller.abort();
			if (signal?.aborted) {
				return Promise.reject(new DOMException('Aborted', 'AbortError'));
			}
			return Promise.resolve();
		});

		const result = await checkServerHealth('http://localhost:1337', {
			signal: controller.signal,
			retryCount: 2,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe('Aborted');
		}
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	// ── Already-aborted caller signal ───────────────────────────────────
	it('returns { ok: false } if caller signal already aborted', async () => {
		const controller = new AbortController();
		controller.abort();

		// Signal-aware mock: rejects immediately for pre-aborted signals.
		fetchMock = mock((_input: RequestInfo | URL, init?: RequestInit) => {
			if (init?.signal instanceof AbortSignal && init.signal.aborted) {
				return Promise.reject(new DOMException('Aborted', 'AbortError'));
			}
			return Promise.resolve(okResponse());
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		const result = await checkServerHealth('http://localhost:1337', {
			signal: controller.signal,
			retryCount: 0,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe('Aborted');
		}
	});

	// ── Credentials ─────────────────────────────────────────────────────
	it('sends Authorization header when credentials are provided', async () => {
		await checkServerHealth('http://localhost:1337', {
			retryCount: 0,
			credentials: { username: 'admin', password: 'secret' },
		});

		const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
		expect(init).toBeDefined();
		const headers = init?.headers as Record<string, string> | undefined;
		expect(headers?.['Authorization']).toBe(`Basic ${btoa('admin:secret')}`);
	});
});

describe('clearHealthCache', () => {
	it('clears a specific URL from the cache', async () => {
		await checkServerHealth('http://a.example.com', { cacheMs: 10_000 });
		await checkServerHealth('http://b.example.com', { cacheMs: 10_000 });
		expect(fetchMock).toHaveBeenCalledTimes(2);

		clearHealthCache('http://a.example.com');

		await checkServerHealth('http://a.example.com', { cacheMs: 10_000 });
		expect(fetchMock).toHaveBeenCalledTimes(3);
		// b should still be cached
		await checkServerHealth('http://b.example.com', { cacheMs: 10_000 });
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it('clears all entries when called without URL', async () => {
		await checkServerHealth('http://a.example.com', { cacheMs: 10_000 });
		await checkServerHealth('http://b.example.com', { cacheMs: 10_000 });
		expect(fetchMock).toHaveBeenCalledTimes(2);

		clearHealthCache();

		await checkServerHealth('http://a.example.com', { cacheMs: 10_000 });
		await checkServerHealth('http://b.example.com', { cacheMs: 10_000 });
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});
});
