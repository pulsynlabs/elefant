// Pure logic for the ModePicker component.
//
// Extracting the radiogroup keyboard-nav logic here keeps the .svelte
// file thin and lets us drive deterministic unit tests without a
// Svelte component renderer. Same pattern as ./command-completions
// and the slider's slider-state.ts.

export type SessionMode = 'spec' | 'quick';

export const SESSION_MODES: readonly SessionMode[] = ['spec', 'quick'] as const;

/**
 * Type guard: narrow an arbitrary string to `SessionMode`.
 *
 * Used at the localStorage boundary where stored values may be
 * stale, hand-edited, or from a future schema.
 */
export function isSessionMode(value: unknown): value is SessionMode {
	return value === 'spec' || value === 'quick';
}

/**
 * Outcome of a keyboard interaction on the radiogroup.
 *
 *  - `select`     — user picked a specific mode (Enter / Space).
 *  - `move`       — user wants to move the focused mode (Arrow keys).
 *                   The component is responsible for moving DOM focus
 *                   to the resulting mode's card.
 *  - `noop`       — key not handled; let the browser do its default.
 */
export type ModeKeyOutcome =
	| { kind: 'select'; mode: SessionMode }
	| { kind: 'move'; mode: SessionMode }
	| { kind: 'noop' };

/**
 * Map a keyboard event to a radiogroup outcome.
 *
 * Implements the WAI-ARIA Radio Group pattern:
 *   - ArrowRight / ArrowDown move focus & selection to the next mode
 *   - ArrowLeft / ArrowUp move focus & selection to the previous mode
 *   - Movement wraps at the ends (radiogroup convention)
 *   - Enter / Space confirm the currently focused mode
 *   - Home / End jump to first / last mode
 *   - All other keys are noop (let Tab / typing fall through)
 *
 * `current` is the mode of the card that received the event — usually
 * the focused card. The function never throws on unknown keys; the
 * component should trust the `kind` field to decide what to do.
 */
export function applyModeKey(
	key: string,
	current: SessionMode,
): ModeKeyOutcome {
	const idx = SESSION_MODES.indexOf(current);
	const last = SESSION_MODES.length - 1;

	switch (key) {
		case 'ArrowRight':
		case 'ArrowDown': {
			const next = SESSION_MODES[idx === last ? 0 : idx + 1];
			return { kind: 'move', mode: next };
		}
		case 'ArrowLeft':
		case 'ArrowUp': {
			const prev = SESSION_MODES[idx === 0 ? last : idx - 1];
			return { kind: 'move', mode: prev };
		}
		case 'Home':
			return { kind: 'move', mode: SESSION_MODES[0] };
		case 'End':
			return { kind: 'move', mode: SESSION_MODES[last] };
		case 'Enter':
		case ' ':
		case 'Spacebar': // older browsers / IE-style names
			return { kind: 'select', mode: current };
		default:
			return { kind: 'noop' };
	}
}

/**
 * Resolve the initial selection.
 *
 * The component prop is `defaultMode`, but we want to be defensive:
 * unknown values fall back to `'quick'` so a corrupted prop never
 * leaves the radiogroup with no selection.
 */
export function resolveInitialMode(value: unknown): SessionMode {
	return isSessionMode(value) ? value : 'quick';
}
