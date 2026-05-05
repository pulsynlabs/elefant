/**
 * Research View keyboard handler — pure logic, no DOM access.
 *
 * Lives in its own module so it can be unit-tested without a browser. The
 * Svelte view is responsible for translating the returned action into the
 * actual side effect (focus, scroll, navigation) and for tracking what's
 * currently focused.
 *
 * Bindings (per BLUEPRINT W4.7):
 *   j  / ArrowDown → tree-next
 *   k  / ArrowUp   → tree-prev
 *   Enter          → tree-open       (only useful when tree row is focused)
 *   /              → focus-search
 *   g r (sequence) → focus-reader    (within 500 ms)
 *   Escape         → close-drawer
 *
 * All bindings are suppressed while the user is typing in an input field,
 * and the `g` prefix is reset on any unrelated key so a stray `g` followed
 * by `j` doesn't navigate the tree by accident.
 *
 * TODO(palette): The blueprint also calls for a ⌘K palette entry that
 * focuses the Research search. No global command palette exists in
 * `desktop/src/features/` at the time of writing — confirmed via grep
 * for `command-palette` / `commandPalette`. When a palette ships, add a
 * "Search Research" entry that triggers the same `focus-search` action
 * as `/`, ideally by re-using `handleResearchKeydown` rather than
 * duplicating the focus logic.
 */

export type ResearchKeyAction =
	| { type: 'tree-next' }
	| { type: 'tree-prev' }
	| { type: 'tree-open' }
	| { type: 'focus-search' }
	| { type: 'focus-reader' }
	| { type: 'close-drawer' };

export interface ResearchKeyHandlerOpts {
	/** True when the user's focus is inside an `<input>`, `<textarea>`, or
	 * `[contenteditable]` element. The caller resolves this from the
	 * actual focused element so this module stays browser-free. */
	isInputFocused: boolean;
	/** Time in ms used to time-bound the `g r` sequence. Defaults to
	 * `Date.now()` and is overridable for tests. */
	now?: () => number;
}

/** Window in milliseconds during which a pending `g` accepts a follow-up `r`. */
export const G_SEQUENCE_TIMEOUT_MS = 500;

/**
 * Tracks the timestamp of the last `g` keystroke so a follow-up `r` within
 * `G_SEQUENCE_TIMEOUT_MS` resolves to `focus-reader`. Module-level so a
 * single ResearchView mount shares the sequence state across calls; reset
 * with {@link resetKeySequence} between tests.
 */
let lastGAt: number | null = null;

/** Reset the multi-key sequence state. Exposed for tests. */
export function resetKeySequence(): void {
	lastGAt = null;
}

/**
 * Inspect a `KeyboardEvent` and return the matching action — or `null`
 * when the event does not bind to anything (modified keys, typing in an
 * input, an unrelated keypress, etc.).
 *
 * The handler does not call `preventDefault` itself; the caller can do so
 * conditionally based on the returned action so that browser shortcuts
 * (e.g. `Cmd+R` reload) are not stolen by this binding.
 */
export function handleResearchKeydown(
	e: KeyboardEvent,
	opts: ResearchKeyHandlerOpts,
): ResearchKeyAction | null {
	// Modifier keys are always reserved for browser/OS shortcuts so we
	// don't accidentally hijack `Cmd+J`, `Ctrl+K`, etc.
	if (e.metaKey || e.ctrlKey || e.altKey) {
		// Escape on its own still needs to close drawers even if the user
		// is in an input; treat it specially below. Modifier+anything
		// else is a hard miss.
		return null;
	}

	const now = opts.now ?? Date.now;

	// Escape always closes the drawer, even from inputs — a common
	// expectation that mirrors how dialog/sheet components behave.
	if (e.key === 'Escape') {
		lastGAt = null;
		return { type: 'close-drawer' };
	}

	// Everything else is suppressed while typing into a form field so
	// the user can spell `j`, `k`, `g`, `r`, or `/` in their query.
	if (opts.isInputFocused) {
		lastGAt = null;
		return null;
	}

	switch (e.key) {
		case 'j':
		case 'ArrowDown':
			lastGAt = null;
			return { type: 'tree-next' };
		case 'k':
		case 'ArrowUp':
			lastGAt = null;
			return { type: 'tree-prev' };
		case 'Enter':
			lastGAt = null;
			return { type: 'tree-open' };
		case '/':
			lastGAt = null;
			return { type: 'focus-search' };
		case 'g':
			// First half of `g r`. Record timestamp; the actual action
			// only fires when `r` arrives within the timeout window.
			lastGAt = now();
			return null;
		case 'r': {
			if (lastGAt !== null && now() - lastGAt <= G_SEQUENCE_TIMEOUT_MS) {
				lastGAt = null;
				return { type: 'focus-reader' };
			}
			lastGAt = null;
			return null;
		}
		default:
			// Any other key cancels a pending `g` so the user can't
			// accidentally trigger `g r` after a long pause.
			lastGAt = null;
			return null;
	}
}
