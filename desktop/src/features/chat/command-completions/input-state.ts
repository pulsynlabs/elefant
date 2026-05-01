// Pure helpers that decide when the slash command overlay is open and what
// query to feed it.
//
// Extracted from MessageInput.svelte so the rules can be exercised by unit
// tests without mounting Svelte (the project does not depend on
// @testing-library/svelte). The Svelte component derives reactive state
// from these functions and forwards keyboard events.

/**
 * Pattern that opens the overlay: a single leading `/` followed by zero or
 * more word characters or hyphens. Matches `/`, `/d`, `/dis`, `/map-codebase`.
 *
 * Spaces, newlines, or any second token close the overlay so the user can
 * write a regular message that happens to start with `/`.
 */
const COMMAND_PATTERN = /^\/[\w-]*$/;

/**
 * Decide whether the overlay should be open for a given input value.
 *
 * IME composition state is fed in from the textarea — we never open the
 * overlay mid-composition because the visible value during a Japanese /
 * Chinese composition is intermediate and matching it would surface
 * spurious suggestions.
 */
export function shouldOpenOverlay(value: string, isComposing: boolean): boolean {
	if (isComposing) return false;
	return COMMAND_PATTERN.test(value);
}

/**
 * Extract the query portion of an input value (everything after the
 * leading `/`). Callers should only invoke this when shouldOpenOverlay()
 * returned true; for safety it returns an empty string otherwise.
 */
export function extractQuery(value: string): string {
	if (!COMMAND_PATTERN.test(value)) return '';
	return value.slice(1);
}

/**
 * Build the next textarea value when a completion is selected.
 *
 * We append a trailing space so the user can start typing arguments
 * immediately. The trailing space is also a deliberate signal that
 * the value no longer matches COMMAND_PATTERN, which collapses the
 * overlay without any extra wiring.
 */
export function applySelection(trigger: string): string {
	return `${trigger} `;
}
