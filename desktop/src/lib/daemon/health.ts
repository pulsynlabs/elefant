/**
 * Health check utilities for daemon server connections.
 *
 * Provides `checkServerHealth` — a pure function that health-checks a daemon
 * URL with configurable timeout, retries with exponential backoff,
 * short-lived result caching, in-flight request deduplication, and
 * AbortSignal support.
 *
 * These utilities are used by the DaemonClientRegistry (T2.2) to poll
 * per-server health independently.
 *
 * All logic is pure except for the module-level cache maps.
 * No imports from Elefant stores, components, or Tauri APIs.
 */

export type HealthResult =
	| { ok: true; latencyMs: number }
	| { ok: false; error: string };

export interface HealthCheckOptions {
	/** Timeout per individual fetch attempt (ms). Default: 3000. */
	timeoutMs?: number;
	/** Number of retries after the initial attempt. Default: 2 (up to 3 total attempts). */
	retryCount?: number;
	/** How long a successful or failed result is cached (ms). Default: 750. */
	cacheMs?: number;
	/** Optional AbortSignal from the caller. If it fires, the check returns `{ ok: false, error: 'Aborted' }`. */
	signal?: AbortSignal;
	/** Optional HTTP Basic Auth credentials. Not used in the cache key. */
	credentials?: { username: string; password: string };
}

/** Backoff delays per retry index (attempt 0 → wait before retry 1, etc.). */
const BACKOFF_MS = [250, 500];

/** Cached health results keyed by URL. */
const resultCache = new Map<string, { result: HealthResult; expiresAt: number }>();

/** In-flight request deduplication — tracks promises currently in flight keyed by URL. */
const inFlight = new Map<string, Promise<HealthResult>>();

/**
 * Clear the health result cache (and any in-flight request dedup state).
 *
 * @param url - If provided, clears only the entry for this URL.
 *              If omitted, clears the entire cache.
 */
export function clearHealthCache(url?: string): void {
	if (url) {
		resultCache.delete(url);
		inFlight.delete(url);
	} else {
		resultCache.clear();
		inFlight.clear();
	}
}

/**
 * Promise-based sleep with optional AbortSignal support.
 * Exposed via `_overrideSleep` for tests to mock away real delays.
 */
let _sleep = (ms: number, signal?: AbortSignal): Promise<void> => {
	return new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException('Aborted', 'AbortError'));
			return;
		}

		const timer = setTimeout(resolve, ms);

		if (signal) {
			const onAbort = () => {
				clearTimeout(timer);
				reject(new DOMException('Aborted', 'AbortError'));
			};
			signal.addEventListener('abort', onAbort, { once: true });
		}
	});
};

/**
 * Override the internal sleep function for testing.
 * Test suites can inject an instant-resolving sleep to avoid real delays.
 */
export function _overrideSleep(fn: typeof _sleep): void {
	_sleep = fn;
}

/**
 * Health-check a daemon server at the given URL.
 *
 * Makes a GET request to `{url}/health` and returns a discriminated union
 * indicating success (with latency) or failure (with error message).
 *
 * Behaviour:
 * - **Caching:** Results are cached for `cacheMs` (default 750ms). Duplicate
 *   calls within the cache window return the cached result immediately.
 * - **In-flight deduplication:** If a check for the same URL is already in
 *   progress, the promise is reused — only one network request is made.
 * - **Timeout:** Each attempt has its own `timeoutMs` (default 3000ms). If
 *   the fetch takes longer, the attempt is aborted.
 * - **Retries:** On failure, the check retries up to `retryCount` times
 *   (default 2) with exponential backoff (250ms before first retry, 500ms
 *   before second retry).
 * - **AbortSignal:** If the caller provides a `signal`, it is composed with
 *   the internal timeout signal. Either aborting causes the check to return
 *   `{ ok: false, error: 'Aborted' }`. Retry waits also honour the signal.
 * - **Credentials:** If provided, sent as an `Authorization: Basic ...` header.
 *   Credentials are NOT used in the cache key (dedup is by URL only).
 *
 * @param url - Base URL of the daemon (e.g. `http://localhost:1337`).
 *              The `/health` path is appended automatically.
 * @param opts - Optional configuration overrides.
 * @returns A `HealthResult` discriminated union.
 */
export async function checkServerHealth(
	url: string,
	opts?: HealthCheckOptions,
): Promise<HealthResult> {
	const timeoutMs = opts?.timeoutMs ?? 3_000;
	const retryCount = opts?.retryCount ?? 2;
	const cacheMs = opts?.cacheMs ?? 750;
	const callerSignal = opts?.signal;
	const credentials = opts?.credentials;

	// ── Fast path: result cache ──────────────────────────────────────────
	const cached = resultCache.get(url);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.result;
	}

	// ── Fast path: in-flight deduplication ──────────────────────────────
	const pending = inFlight.get(url);
	if (pending) {
		return pending;
	}

	const promise = performCheck(url, timeoutMs, retryCount, cacheMs, callerSignal, credentials);
	inFlight.set(url, promise);

	try {
		return await promise;
	} finally {
		inFlight.delete(url);
	}
}

/**
 * Internal implementation — separated so in-flight dedup wraps it.
 */
async function performCheck(
	url: string,
	timeoutMs: number,
	retryCount: number,
	cacheMs: number,
	callerSignal: AbortSignal | undefined,
	credentials: { username: string; password: string } | undefined,
): Promise<HealthResult> {
	const maxAttempts = retryCount + 1;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		// ── Create per-attempt timeout signal ────────────────────────────
		const timeoutController = new AbortController();
		const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

		// Compose with caller signal (if any)
		const onCallerAbort = () => {
			timeoutController.abort();
			clearTimeout(timeoutId);
		};

		if (callerSignal) {
			if (callerSignal.aborted) {
				timeoutController.abort();
				clearTimeout(timeoutId);
			} else {
				callerSignal.addEventListener('abort', onCallerAbort, { once: true });
			}
		}

		const startMs = performance.now();

		let errorMessage: string | null = null;
		let isAborted = false;
		let latencyMs = 0;

		// ── Attempt fetch ──────────────────────────────────────────────
		try {
			const headers: Record<string, string> = { Accept: 'application/json' };
			if (credentials) {
				const encoded = btoa(`${credentials.username}:${credentials.password}`);
				headers['Authorization'] = `Basic ${encoded}`;
			}

			const response = await fetch(`${url}/health`, {
				signal: timeoutController.signal,
				headers,
			});

			latencyMs = Math.round(performance.now() - startMs);

			if (response.ok) {
				const result: HealthResult = { ok: true, latencyMs };
				resultCache.set(url, { result, expiresAt: Date.now() + cacheMs });
				return result;
			}

			// Non-2xx — read body for error context
			const body = await response.text().catch(() => '');
			errorMessage = `HTTP ${response.status}${body ? `: ${body}` : ''}`;
		} catch (err) {
			if (timeoutController.signal.aborted || callerSignal?.aborted) {
				isAborted = true;
			} else {
				errorMessage = err instanceof Error ? err.message : 'Unknown error';
			}
		} finally {
			clearTimeout(timeoutId);
			if (callerSignal) {
				callerSignal.removeEventListener('abort', onCallerAbort);
			}
		}

		// ── Handle abort ───────────────────────────────────────────────
		if (isAborted) {
			// Do not cache abort results — they're transient
			return { ok: false, error: 'Aborted' };
		}

		// ── Handle last-attempt failure ────────────────────────────────
		if (attempt === maxAttempts - 1) {
			const result: HealthResult = {
				ok: false,
				error: errorMessage ?? 'Unknown error',
			};
			resultCache.set(url, { result, expiresAt: Date.now() + cacheMs });
			return result;
		}

		// ── Retry: wait with backoff ────────────────────────────────────
		const waitMs = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
		try {
			await _sleep(waitMs, callerSignal);
		} catch {
			return { ok: false, error: 'Aborted' };
		}
	}

	// Should be unreachable — TypeScript safety net
	const fallback: HealthResult = { ok: false, error: 'Max retries exceeded' };
	resultCache.set(url, { result: fallback, expiresAt: Date.now() + cacheMs });
	return fallback;
}
