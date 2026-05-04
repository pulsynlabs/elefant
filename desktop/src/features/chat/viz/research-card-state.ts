// Pure helpers for `ResearchCardViz.svelte`.
//
// The renderer is intentionally logic-light — formatting, threshold
// classification, tag truncation, and URI sniffing all live here so
// they can be unit-tested without mounting Svelte. Each helper is
// total: it accepts the full domain (including `undefined`) and never
// throws, so the renderer can read straight from a freshly-validated
// envelope without a defensive wrapper.

/**
 * Three-tier confidence label derived from a 0–1 score. Mirrors the
 * `'high' | 'medium' | 'low'` band used by Research Base frontmatter
 * so a card built from `research_search` reads consistently with one
 * built from `research_index`. Returns the empty string for a missing
 * score so the renderer can omit the chip entirely.
 *
 * Thresholds: ≥0.8 high, ≥0.5 med, otherwise low.
 */
export function formatConfidence(n: number | undefined): string {
	if (n === undefined || n === null) return '';
	if (n >= 0.8) return 'high';
	if (n >= 0.5) return 'med';
	return 'low';
}

/**
 * Quire token reference matching `formatConfidence`'s tier. Returned
 * as a `var(--token)` string so the renderer can drop it straight
 * into a `style="color: ..."` attribute without any further mapping.
 * Unknown/missing scores fall back to the muted text token so the
 * chip degrades quietly rather than disappearing into the surface.
 */
export function confidenceColorToken(n: number | undefined): string {
	if (n === undefined || n === null) return 'var(--text-muted)';
	if (n >= 0.8) return 'var(--color-success)';
	if (n >= 0.5) return 'var(--color-warning)';
	return 'var(--color-error)';
}

/**
 * Bound a tag list to `max` entries for inline display. Tolerates
 * `undefined`, empty arrays, and `max <= 0` (returns []) so the
 * renderer doesn't have to guard before the each-block.
 */
export function truncateTags(tags: string[] | undefined, max: number): string[] {
	if (!tags) return [];
	if (max <= 0) return [];
	return tags.slice(0, max);
}

/**
 * `true` when the supplied URL is an internal `research://` link and
 * should be rendered via `ResearchChip` (which lazy-loads the file's
 * frontmatter title and routes via the navigation store) rather than
 * a plain external anchor. Defensive against `undefined` because
 * `card.url` is optional in the schema.
 */
export function isResearchUri(s: string | undefined): boolean {
	return typeof s === 'string' && s.startsWith('research://');
}
