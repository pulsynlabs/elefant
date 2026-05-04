// Pure helpers for the `stat-grid` viz renderer.
//
// Kept side-effect-free and DOM-free so they can be exercised by
// `bun test` without `@testing-library/svelte`. The helpers cover the
// three rendering responsibilities of `StatGridViz.svelte`:
//
//   1. Formatting numeric `delta` values with a sign prefix and an
//      optional unit suffix.
//   2. Mapping a `trend` enum to a Quire color CSS-variable reference
//      (token name, never a hex literal).
//   3. Formatting a `value` (number or string) for display, applying
//      locale grouping to numbers.
//
// The daemon-side Zod schema (`statGridSchema` in
// `src/tools/visualize/schemas.ts`) does not currently include a
// per-item `unit` field. The optional `unit` parameter on these
// helpers is forward-compat scaffolding so a future schema bump can
// pass it through without changing call sites.

export type Trend = 'up' | 'down' | 'flat';

/**
 * Format a numeric delta with a sign prefix and an optional unit.
 *
 * Returns an empty string when `delta` is `undefined` or `null` so the
 * renderer can omit the badge entirely. `0` formats as `+0` to keep
 * the sign column visually stable when the underlying value happened
 * to be exactly zero.
 */
export function formatDelta(
	delta: number | undefined | null,
	unit?: string,
): string {
	if (delta === undefined || delta === null) return '';
	const sign = delta >= 0 ? '+' : '';
	const formatted = `${sign}${delta}${unit ? ` ${unit}` : ''}`;
	return formatted;
}

/**
 * Map a trend value to a Quire CSS color token reference.
 *
 * Returns the literal `var(--token)` string so the renderer can drop
 * it into an inline `style="color: ..."` attribute without
 * synthesising any hex value. Unknown / undefined trends fall back to
 * the muted text token so the badge remains readable but quiet.
 */
export function trendToColorToken(trend: Trend | undefined): string {
	switch (trend) {
		case 'up':
			return 'var(--color-success)';
		case 'down':
			return 'var(--color-error)';
		case 'flat':
		default:
			return 'var(--text-muted)';
	}
}

/**
 * Format a stat value for display.
 *
 * Numbers receive `toLocaleString()` thousand-grouping so large
 * counts (e.g. `1234567`) render as `1,234,567`. Strings pass through
 * unchanged — the agent already chose a presentation format. An
 * optional unit is appended with a single space.
 */
export function formatValue(value: string | number, unit?: string): string {
	if (typeof value === 'number') {
		const formatted = value.toLocaleString();
		return unit ? `${formatted} ${unit}` : formatted;
	}
	return unit ? `${value} ${unit}` : String(value);
}

/**
 * True when at least one item carries either a `trend` or a `delta`
 * field. The renderer uses this to decide whether a card needs to
 * reserve space for the trend badge row.
 */
export function hasTrendData(
	items: ReadonlyArray<{ trend?: string; delta?: number }>,
): boolean {
	return items.some(
		(item) => item.trend !== undefined || item.delta !== undefined,
	);
}
