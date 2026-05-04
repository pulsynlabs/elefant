// Pure helpers for the loading viz renderer.
//
// Kept separate from the Svelte component so the replacement-decision
// rule, step indexing, and percent clamping can be unit-tested without
// a DOM. The component reads `LoadingData` directly off the envelope's
// `data` field — daemon-side Zod has already validated shape, so the
// cast is sound. These helpers stay defensive about runtime edge cases
// (missing fields, NaN, out-of-range step indices) so a malformed
// payload can never crash the transcript.

/**
 * The validated payload shape for `viz.type === 'loading'`.
 * Mirrors the daemon-side Zod schema (`src/tools/visualize/schemas.ts`).
 */
export interface LoadingData {
	msg: string;
	steps?: string[];
	step?: number;
	pct?: number;
}

/**
 * Returns true when a loading block should be replaced by subsequent
 * content. "Replaced" means: another non-loading ContentBlock has
 * arrived after the most recent loading block. Per the Wave 2
 * contextual question, the chosen rule is "any subsequent non-loading
 * block" — that includes text tokens, viz blocks, and tool calls,
 * because the loading affordance has served its purpose once any
 * concrete output is visible.
 */
export function shouldReplaceLoading(blockTypes: string[]): boolean {
	const lastLoadingIdx = blockTypes.lastIndexOf('loading');
	if (lastLoadingIdx === -1) return false;
	return blockTypes
		.slice(lastLoadingIdx + 1)
		.some((t) => t !== 'loading');
}

/**
 * Returns the next step index, clamped into `[0, total - 1]`.
 * Used when a streaming `loading` payload advances; never returns a
 * value past the last valid index.
 */
export function nextStepIndex(current: number, total: number): number {
	if (total <= 0) return 0;
	return Math.min(current + 1, total - 1);
}

/**
 * Clamps a percent value into `[0, 100]` and rounds to the nearest
 * integer. `undefined` and `NaN` map to `0` so the progress bar always
 * has a numeric width.
 */
export function clampPct(pct: number | undefined): number {
	if (pct === undefined || Number.isNaN(pct)) return 0;
	return Math.round(Math.max(0, Math.min(100, pct)));
}

/**
 * Returns which step label (0-indexed) should be highlighted, or
 * `null` when the payload has no steps to display. Out-of-range
 * indices clamp into the available range so a stale `step` value
 * never breaks rendering.
 */
export function activeStepIndex(data: LoadingData): number | null {
	if (!data.steps || data.steps.length === 0) return null;
	const idx = data.step ?? 0;
	return Math.max(0, Math.min(idx, data.steps.length - 1));
}
