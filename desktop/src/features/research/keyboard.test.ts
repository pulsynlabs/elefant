/**
 * Tests for the Research View keyboard handler.
 *
 * Run with: bun test desktop/src/features/research/keyboard.test.ts
 *
 * The handler is intentionally browser-free; we synthesize plain
 * `KeyboardEvent`-shaped objects rather than using a JSDOM environment
 * so the suite stays fast and Bun-native.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
	G_SEQUENCE_TIMEOUT_MS,
	handleResearchKeydown,
	resetKeySequence,
} from './keyboard.js';

type KeyEventOpts = {
	key: string;
	metaKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
};

function makeEvent({
	key,
	metaKey = false,
	ctrlKey = false,
	altKey = false,
}: KeyEventOpts): KeyboardEvent {
	// We only touch a handful of fields, so a typed plain object is
	// safer (and lighter) than calling the global KeyboardEvent
	// constructor — which behaves slightly differently across runtimes.
	return { key, metaKey, ctrlKey, altKey } as KeyboardEvent;
}

afterEach(() => {
	resetKeySequence();
});

describe('handleResearchKeydown — single-key bindings', () => {
	it('maps j to tree-next', () => {
		expect(
			handleResearchKeydown(makeEvent({ key: 'j' }), { isInputFocused: false }),
		).toEqual({ type: 'tree-next' });
	});

	it('maps ArrowDown to tree-next', () => {
		expect(
			handleResearchKeydown(makeEvent({ key: 'ArrowDown' }), {
				isInputFocused: false,
			}),
		).toEqual({ type: 'tree-next' });
	});

	it('maps k to tree-prev', () => {
		expect(
			handleResearchKeydown(makeEvent({ key: 'k' }), { isInputFocused: false }),
		).toEqual({ type: 'tree-prev' });
	});

	it('maps ArrowUp to tree-prev', () => {
		expect(
			handleResearchKeydown(makeEvent({ key: 'ArrowUp' }), {
				isInputFocused: false,
			}),
		).toEqual({ type: 'tree-prev' });
	});

	it('maps Enter to tree-open', () => {
		expect(
			handleResearchKeydown(makeEvent({ key: 'Enter' }), {
				isInputFocused: false,
			}),
		).toEqual({ type: 'tree-open' });
	});

	it('maps / to focus-search', () => {
		expect(
			handleResearchKeydown(makeEvent({ key: '/' }), { isInputFocused: false }),
		).toEqual({ type: 'focus-search' });
	});

	it('returns null for unmapped keys', () => {
		expect(
			handleResearchKeydown(makeEvent({ key: 'q' }), { isInputFocused: false }),
		).toBeNull();
	});
});

describe('handleResearchKeydown — Escape closes drawer', () => {
	it('returns close-drawer for Escape outside an input', () => {
		expect(
			handleResearchKeydown(makeEvent({ key: 'Escape' }), {
				isInputFocused: false,
			}),
		).toEqual({ type: 'close-drawer' });
	});

	it('still returns close-drawer for Escape inside an input', () => {
		// Escape must always be able to dismiss a sheet/drawer, even
		// when the focused element is an input (matching dialog UX).
		expect(
			handleResearchKeydown(makeEvent({ key: 'Escape' }), {
				isInputFocused: true,
			}),
		).toEqual({ type: 'close-drawer' });
	});
});

describe('handleResearchKeydown — input-focused suppression', () => {
	it('suppresses j when the user is typing', () => {
		expect(
			handleResearchKeydown(makeEvent({ key: 'j' }), { isInputFocused: true }),
		).toBeNull();
	});

	it('suppresses / when the user is typing', () => {
		expect(
			handleResearchKeydown(makeEvent({ key: '/' }), { isInputFocused: true }),
		).toBeNull();
	});

	it('suppresses g r when the user is typing', () => {
		const opts = { isInputFocused: true };
		expect(handleResearchKeydown(makeEvent({ key: 'g' }), opts)).toBeNull();
		expect(handleResearchKeydown(makeEvent({ key: 'r' }), opts)).toBeNull();
	});
});

describe('handleResearchKeydown — modifier keys are reserved', () => {
	it('returns null when Meta is held', () => {
		expect(
			handleResearchKeydown(makeEvent({ key: 'j', metaKey: true }), {
				isInputFocused: false,
			}),
		).toBeNull();
	});

	it('returns null when Ctrl is held', () => {
		expect(
			handleResearchKeydown(makeEvent({ key: 'k', ctrlKey: true }), {
				isInputFocused: false,
			}),
		).toBeNull();
	});

	it('returns null when Alt is held', () => {
		expect(
			handleResearchKeydown(makeEvent({ key: '/', altKey: true }), {
				isInputFocused: false,
			}),
		).toBeNull();
	});

	it('does not fire close-drawer on modifier+Escape (browser owns it)', () => {
		expect(
			handleResearchKeydown(makeEvent({ key: 'Escape', metaKey: true }), {
				isInputFocused: false,
			}),
		).toBeNull();
	});
});

describe('handleResearchKeydown — g r sequence', () => {
	it('returns focus-reader when r follows g within the timeout', () => {
		let now = 1000;
		const opts = { isInputFocused: false, now: () => now };
		expect(handleResearchKeydown(makeEvent({ key: 'g' }), opts)).toBeNull();
		now += 200; // 200 ms < timeout
		expect(handleResearchKeydown(makeEvent({ key: 'r' }), opts)).toEqual({
			type: 'focus-reader',
		});
	});

	it('does not fire when r arrives outside the timeout window', () => {
		let now = 1000;
		const opts = { isInputFocused: false, now: () => now };
		expect(handleResearchKeydown(makeEvent({ key: 'g' }), opts)).toBeNull();
		now += G_SEQUENCE_TIMEOUT_MS + 1;
		expect(handleResearchKeydown(makeEvent({ key: 'r' }), opts)).toBeNull();
	});

	it('does not fire when r arrives without a preceding g', () => {
		expect(
			handleResearchKeydown(makeEvent({ key: 'r' }), { isInputFocused: false }),
		).toBeNull();
	});

	it('cancels the pending g when an unrelated key arrives in between', () => {
		const opts = { isInputFocused: false };
		expect(handleResearchKeydown(makeEvent({ key: 'g' }), opts)).toBeNull();
		// Unrelated key — clears the sequence.
		expect(handleResearchKeydown(makeEvent({ key: 'x' }), opts)).toBeNull();
		// r alone is no longer a sequence completion.
		expect(handleResearchKeydown(makeEvent({ key: 'r' }), opts)).toBeNull();
	});

	it('cancels the pending g when an Escape arrives in between', () => {
		const opts = { isInputFocused: false };
		expect(handleResearchKeydown(makeEvent({ key: 'g' }), opts)).toBeNull();
		expect(handleResearchKeydown(makeEvent({ key: 'Escape' }), opts)).toEqual({
			type: 'close-drawer',
		});
		expect(handleResearchKeydown(makeEvent({ key: 'r' }), opts)).toBeNull();
	});

	it('cancels the pending g when the user starts typing', () => {
		const opts = { isInputFocused: false };
		expect(handleResearchKeydown(makeEvent({ key: 'g' }), opts)).toBeNull();
		// User clicks into search and types 'r' — should NOT focus reader.
		expect(
			handleResearchKeydown(makeEvent({ key: 'r' }), { isInputFocused: true }),
		).toBeNull();
	});

	it('does not record the g half when typing in an input', () => {
		// Typing 'g' inside the search box must not start a sequence;
		// then leaving the input and pressing 'r' should be a no-op.
		expect(
			handleResearchKeydown(makeEvent({ key: 'g' }), { isInputFocused: true }),
		).toBeNull();
		expect(
			handleResearchKeydown(makeEvent({ key: 'r' }), { isInputFocused: false }),
		).toBeNull();
	});
});

describe('resetKeySequence', () => {
	it('clears any pending g half', () => {
		const opts = { isInputFocused: false };
		handleResearchKeydown(makeEvent({ key: 'g' }), opts);
		resetKeySequence();
		expect(handleResearchKeydown(makeEvent({ key: 'r' }), opts)).toBeNull();
	});
});
