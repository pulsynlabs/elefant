// Token Counter store (Svelte 5 runes).
//
// Subscribes to the daemon's per-session token SSE endpoint and tracks
// window tokens (current context window), session tokens (cumulative
// across compactions), and a per-category breakdown for the Context
// Window Visualizer (T5.3 / T5.4).
//
// The daemon W2.T2 route at:
//   GET /api/projects/:projectId/sessions/:sessionId/tokens/events
// emits typed SSE events (`tokens.window`, `tokens.session`,
// `tokens.breakdown`) whose payloads carry the full TokenDeltaEvent
// shape from src/server/token-counter.ts.
//
// UI state writes are throttled to 4 Hz (250 ms) so the TokenBar and
// Treemap don't re-render on every streaming token delta.  Events are
// buffered into a pending snapshot and flushed synchronously on a timer.
//
// Session isolation: switching sessions tears down the old EventSource,
// resets all counters to zero, and opens a new connection.  The daemon
// emits a bootstrap snapshot on connect so the store never flashes
// stale data from the previous session.
//
// SPEC: MH7 — Token Counter (panel footer, live updates, compaction
// durability).  Also feeds MH8 (breakdown segments for visualizer).

import { DAEMON_URL } from '$lib/daemon/client.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Categories match the daemon's `TokenBreakdownCategory` union from
 * src/server/token-counter.ts.  Kept as a literal union so a renamed
 * or added category is a compile-time error, not a silent drop.
 */
export type TokenBreakdownCategory =
	| 'system'
	| 'tools'
	| 'messages'
	| 'active_tool_calls'
	| 'mcp_schemas'
	| 'file_contents'
	| 'images'
	| 'assistant_output'
	| 'other';

/**
 * A breakdown segment with display-ready fields.  Derived from the
 * daemon's `TokenBreakdownSegment` but with `label` (mapped from
 * `name`) and a computed `percent` of the window total.
 */
export interface TokenSegment {
	category: TokenBreakdownCategory;
	/** Human-readable label (daemon `name` field). */
	label: string;
	/** Token count for this segment. */
	tokens: number;
	/** Percentage of windowTokens (0–100). */
	percent: number;
}

// ─── Wire types ─────────────────────────────────────────────────────────────

/** Shape of the `data` payload inside a `TokenDeltaEvent` SSE frame. */
interface TokenDeltaData {
	windowTokens: number;
	windowMax: number;
	sessionTokens: number;
	breakdown?: { name: string; category: string; tokens: number }[];
	deltaTokens?: number;
	reason?: string;
}

/** Daemon's `TokenDeltaEvent` deserialised from SSE JSON. */
interface WireTokenEvent {
	type: 'tokens.window' | 'tokens.session' | 'tokens.breakdown';
	sessionId: string;
	data: TokenDeltaData;
	ts: string;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_WINDOW_MAX = 200_000;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Map a daemon `TokenBreakdownSegment` to the public `TokenSegment`.
 * Computes `percent` relative to `total` and normalises edge cases
 * (negative/NaN from near-zero totals).
 */
function toTokenSegment(
	seg: { name: string; category: string; tokens: number },
	total: number,
): TokenSegment {
	const safeTotal = total > 0 ? total : 1;
	const pct = (seg.tokens / safeTotal) * 100;
	return {
		category: seg.category as TokenBreakdownCategory,
		label: seg.name,
		tokens: seg.tokens,
		percent: Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0,
	};
}

/**
 * Convert a raw breakdown array from the daemon into display-ready
 * segments, computing each segment's percentage of `windowTokens`.
 */
function mapBreakdown(
	raw: { name: string; category: string; tokens: number }[] | undefined,
	windowTokens: number,
): TokenSegment[] {
	if (!raw || raw.length === 0) return [];
	return raw.map((seg) => toTokenSegment(seg, windowTokens));
}

/** Validates the minimum shape of an SSE payload before consuming it. */
function isWireTokenEvent(value: unknown): value is WireTokenEvent {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	if (
		typeof v.type !== 'string' ||
		typeof v.data !== 'object' ||
		v.data === null
	)
		return false;
	const d = v.data as Record<string, unknown>;
	return (
		typeof d.windowTokens === 'number' &&
		typeof d.windowMax === 'number' &&
		typeof d.sessionTokens === 'number'
	);
}

// ─── Pending snapshot (debounce buffer) ─────────────────────────────────────

interface PendingSnapshot {
	windowTokens: number;
	windowMax: number;
	sessionTokens: number;
	breakdown: TokenSegment[] | null;
}

// ─── Store class ────────────────────────────────────────────────────────────

class TokenCounterStore {
	// Public reactive state
	windowTokens = $state(0);
	windowMax = $state(DEFAULT_WINDOW_MAX);
	sessionTokens = $state(0);
	breakdown = $state<TokenSegment[]>([]);

	/** Derived: fraction of the context window that is currently filled (0–1). */
	windowPercent = $derived(
		this.windowMax > 0 ? this.windowTokens / this.windowMax : 0,
	);

	// Private subscription state
	#eventSource: EventSource | null = null;
	#activeProjectId: string | null = null;
	#activeSessionId: string | null = null;

	// Debounce (4 Hz = 250 ms max update rate)
	#flushTimer: ReturnType<typeof setTimeout> | null = null;
	#pending: PendingSnapshot | null = null;

	// ── Public API ─────────────────────────────────────────────────────────

	/**
	 * Bind the store to a session.  Pass nulls to detach.
	 *
	 * Idempotent: re-binding to the same (projectId, sessionId) is a
	 * no-op so the TokenBar `$effect` can safely re-run on every
	 * reactive tick without reconnecting.
	 */
	setSession(projectId: string | null, sessionId: string | null): void {
		if (
			projectId === this.#activeProjectId &&
			sessionId === this.#activeSessionId
		)
			return;

		this.#teardown();
		this.#reset();

		this.#activeProjectId = projectId;
		this.#activeSessionId = sessionId;

		if (!projectId || !sessionId) return;

		const url = `${DAEMON_URL}/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/tokens/events`;
		const es = new EventSource(url);
		this.#eventSource = es;

		es.addEventListener('tokens.window', this.#onWindow);
		es.addEventListener('tokens.session', this.#onSession);
		es.addEventListener('tokens.breakdown', this.#onBreakdown);
		es.addEventListener('error', this.#onError);
	}

	/** Tear down the subscription and reset all counters. */
	clear(): void {
		this.setSession(null, null);
	}

	// ── SSE handlers ──────────────────────────────────────────────────────

	#onWindow = (e: Event): void => {
		const event = this.#parseEvent(e);
		if (!event) return;

		this.#pending = {
			windowTokens: event.data.windowTokens,
			windowMax: event.data.windowMax,
			sessionTokens: event.data.sessionTokens,
			breakdown: null,
		};
		this.#scheduleFlush();
	};

	#onSession = (e: Event): void => {
		const event = this.#parseEvent(e);
		if (!event) return;

		this.#pending = {
			windowTokens: event.data.windowTokens,
			windowMax: event.data.windowMax,
			sessionTokens: event.data.sessionTokens,
			breakdown: null,
		};
		this.#scheduleFlush();
	};

	#onBreakdown = (e: Event): void => {
		const event = this.#parseEvent(e);
		if (!event) return;

		const segments = mapBreakdown(
			event.data.breakdown,
			event.data.windowTokens,
		);

		this.#pending = {
			windowTokens: event.data.windowTokens,
			windowMax: event.data.windowMax,
			sessionTokens: event.data.sessionTokens,
			breakdown: segments,
		};
		this.#scheduleFlush();
	};

	/**
	 * EventSource `error` handler.  The browser auto-reconnects after a
	 * brief backoff; we don't need to do anything here except avoid
	 * unhandled-error noise.  If the error fires after `.close()` (e.g.
	 * during teardown), the guard on `#activeSessionId` prevents any
	 * accidental re-subscription.
	 */
	#onError = (): void => {
		// EventSource has its own reconnection logic — no action needed
	};

	// ── Parse helper ──────────────────────────────────────────────────────

	/**
	 * Parse an SSE MessageEvent into a validated `WireTokenEvent`, or
	 * return null for malformed frames (dropped silently per convention).
	 */
	#parseEvent(e: Event): WireTokenEvent | null {
		try {
			const me = e as MessageEvent;
			const parsed: unknown = JSON.parse(
				typeof me.data === 'string' ? me.data : '',
			);
			if (!isWireTokenEvent(parsed)) return null;
			// Ignore events for other sessions (defensive — the daemon
			// scopes this SSE to a single session, but check anyway).
			if (
				this.#activeSessionId !== null &&
				parsed.sessionId !== this.#activeSessionId
			)
				return null;
			return parsed;
		} catch {
			return null;
		}
	}

	// ── Debounce ──────────────────────────────────────────────────────────

	/** Schedule a flush of the pending snapshot at the next 250 ms boundary. */
	#scheduleFlush(): void {
		if (this.#flushTimer !== null) return;
		this.#flushTimer = setTimeout(() => {
			this.#flushTimer = null;
			this.#applyPending();
		}, 250);
	}

	/** Commit the buffered snapshot to reactive state. */
	#applyPending(): void {
		if (!this.#pending) return;
		const p = this.#pending;
		this.#pending = null;

		this.windowTokens = p.windowTokens;
		this.windowMax = p.windowMax;
		this.sessionTokens = p.sessionTokens;
		if (p.breakdown !== null) {
			this.breakdown = p.breakdown;
		}
	}

	// ── Teardown / reset ──────────────────────────────────────────────────

	/** Close the EventSource and clear subscription state. */
	#teardown(): void {
		if (this.#eventSource) {
			this.#eventSource.close();
			this.#eventSource = null;
		}
		if (this.#flushTimer !== null) {
			clearTimeout(this.#flushTimer);
			this.#flushTimer = null;
		}
		this.#pending = null;
	}

	/** Reset all reactive counters to initial values. */
	#reset(): void {
		this.windowTokens = 0;
		this.windowMax = DEFAULT_WINDOW_MAX;
		this.sessionTokens = 0;
		this.breakdown = [];
	}
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const tokenCounterStore = new TokenCounterStore();

// ─── Test helpers (not part of the public contract) ─────────────────────────

/** Reset all state to initial values (detaches the active session). */
export function resetTokenCounterStore(): void {
	tokenCounterStore.clear();
}
