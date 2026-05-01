// Per-project "last used session mode" persistence.
//
// We remember the user's most recent mode choice for each project so
// that opening the new-session dialog twice in a row doesn't ask them
// to make the same choice twice. Keyed by project id; one entry per
// project; missing entries fall back to `'quick'` (the lower-friction
// default per the spec).
//
// Storage is intentionally `localStorage` rather than the daemon DB:
// the value is a UI preference, not a workflow contract, and it lives
// per-browser/per-machine. A user logged in elsewhere should not
// inherit another machine's last choice.

import { isSessionMode, type SessionMode } from './mode-picker-state.js';

/** Default when no value has been recorded for a project. */
const DEFAULT_MODE: SessionMode = 'quick';

/** localStorage key prefix. Versioned so future migrations can rename cleanly. */
const KEY_PREFIX = 'elefant:mode:';

function storageKey(projectId: string): string {
	return `${KEY_PREFIX}${projectId}`;
}

/**
 * Detect whether a usable `localStorage` is available.
 *
 * Tests, SSR, and private-mode browsers can all surface a
 * `ReferenceError` or `SecurityError` when touching `localStorage`.
 * This helper isolates that concern so callers stay readable.
 */
function getStorage(): Storage | null {
	try {
		if (typeof globalThis === 'undefined') return null;
		const ls = (globalThis as { localStorage?: Storage }).localStorage;
		return ls ?? null;
	} catch {
		return null;
	}
}

/**
 * Return the last-used mode for a project, or `'quick'` if no choice
 * has been recorded (or storage is unavailable, or the stored value
 * has been tampered with).
 */
export function getLastMode(projectId: string): SessionMode {
	if (!projectId) return DEFAULT_MODE;
	const store = getStorage();
	if (!store) return DEFAULT_MODE;
	try {
		const raw = store.getItem(storageKey(projectId));
		return isSessionMode(raw) ? raw : DEFAULT_MODE;
	} catch {
		return DEFAULT_MODE;
	}
}

/**
 * Record the last-used mode for a project. Silently no-ops when
 * storage is unavailable — this is a UX nicety, not a correctness
 * requirement.
 */
export function setLastMode(projectId: string, mode: SessionMode): void {
	if (!projectId) return;
	if (!isSessionMode(mode)) return;
	const store = getStorage();
	if (!store) return;
	try {
		store.setItem(storageKey(projectId), mode);
	} catch {
		// Quota exceeded, private mode, etc. — non-fatal.
	}
}

/** Test-only: drop the stored value for a project. Exported for unit tests. */
export function clearLastMode(projectId: string): void {
	if (!projectId) return;
	const store = getStorage();
	if (!store) return;
	try {
		store.removeItem(storageKey(projectId));
	} catch {
		// Non-fatal.
	}
}
