// Bun's CLI runtime does not expose `globalThis.localStorage`, and
// the desktop test setup intentionally stays minimal. Install a tiny
// in-memory shim BEFORE importing the helper so the real storage
// path is exercised under test. `last-mode.ts` reads
// `globalThis.localStorage` lazily on every call, so the shim is
// picked up at first use.
if (typeof (globalThis as { localStorage?: Storage }).localStorage === 'undefined') {
	const data = new Map<string, string>();
	const shim: Storage = {
		get length() {
			return data.size;
		},
		clear: () => data.clear(),
		getItem: (key: string) => (data.has(key) ? data.get(key) ?? null : null),
		key: (index: number) => Array.from(data.keys())[index] ?? null,
		removeItem: (key: string) => {
			data.delete(key);
		},
		setItem: (key: string, value: string) => {
			data.set(String(key), String(value));
		},
	};
	Object.defineProperty(globalThis, 'localStorage', {
		value: shim,
		configurable: true,
		writable: true,
	});
}

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { clearLastMode, getLastMode, setLastMode } from './last-mode.js';

const PROJECT_A = 'proj-a';
const PROJECT_B = 'proj-b';

beforeEach(() => {
	clearLastMode(PROJECT_A);
	clearLastMode(PROJECT_B);
});

afterEach(() => {
	clearLastMode(PROJECT_A);
	clearLastMode(PROJECT_B);
});

describe('getLastMode', () => {
	it('returns "quick" when no value has been recorded', () => {
		expect(getLastMode(PROJECT_A)).toBe('quick');
	});

	it('returns "quick" when projectId is empty', () => {
		expect(getLastMode('')).toBe('quick');
	});

	it('returns "quick" when the stored value is not a valid mode', () => {
		const ls = globalThis.localStorage;
		ls?.setItem('elefant:mode:proj-a', 'PLAN');
		expect(getLastMode(PROJECT_A)).toBe('quick');
	});
});

describe('setLastMode + getLastMode round-trip', () => {
	it('persists "spec" and reads it back', () => {
		setLastMode(PROJECT_A, 'spec');
		expect(getLastMode(PROJECT_A)).toBe('spec');
	});

	it('persists "quick" and reads it back', () => {
		setLastMode(PROJECT_A, 'quick');
		expect(getLastMode(PROJECT_A)).toBe('quick');
	});

	it('overwrites the previous value on a second write', () => {
		setLastMode(PROJECT_A, 'spec');
		setLastMode(PROJECT_A, 'quick');
		expect(getLastMode(PROJECT_A)).toBe('quick');
	});

	it('isolates values per project id', () => {
		setLastMode(PROJECT_A, 'spec');
		setLastMode(PROJECT_B, 'quick');
		expect(getLastMode(PROJECT_A)).toBe('spec');
		expect(getLastMode(PROJECT_B)).toBe('quick');
	});
});

describe('setLastMode — defensive guards', () => {
	it('does nothing when projectId is empty', () => {
		setLastMode('', 'spec');
		expect(getLastMode('')).toBe('quick');
	});

	it('does nothing when mode is not a valid SessionMode', () => {
		// @ts-expect-error — exercising the runtime guard
		setLastMode(PROJECT_A, 'bogus');
		expect(getLastMode(PROJECT_A)).toBe('quick');
	});
});

describe('clearLastMode', () => {
	it('removes a previously-stored value', () => {
		setLastMode(PROJECT_A, 'spec');
		clearLastMode(PROJECT_A);
		expect(getLastMode(PROJECT_A)).toBe('quick');
	});

	it('is a no-op for unknown ids', () => {
		clearLastMode('never-stored');
		expect(getLastMode('never-stored')).toBe('quick');
	});
});

describe('storage key shape', () => {
	it('uses the documented "elefant:mode:<projectId>" key format', () => {
		setLastMode(PROJECT_A, 'spec');
		const ls = globalThis.localStorage;
		expect(ls?.getItem('elefant:mode:proj-a')).toBe('spec');
	});
});
