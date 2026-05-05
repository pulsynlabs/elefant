/**
 * field notes → field-notes-card adapter.
 *
 * Bridges the gap between the field notes tools' return shapes
 * (`field_notes_search.SearchResult`, `field_notes_index.TreeFile/FlatFile`)
 * and the `field-notes-card` viz payload schema. Kept in `adapters/`
 * rather than inline in either module so the viz schema stays
 * deliberately decoupled from research-tools churn (Wave 4 contextual
 * question 1).
 *
 * The adapter is pure, total, and never throws — missing fields fall
 * back to safe defaults so a partial hit still renders rather than
 * dropping the card.
 */

import type { FieldNotesCardPayload } from '../types.js';

/**
 * Loose superset of the fields produced by `field_notes_search` /
 * `field_notes_index` / `field_notes_read`. Optional everywhere so a single
 * adapter can consume any of them without bespoke per-tool wiring.
 */
export interface FieldNotesHit {
	title?: string;
	summary?: string;
	snippet?: string;
	/** Internal `fieldnotes://` link (preferred for in-app navigation). */
	fieldnotes_link?: string;
	/** Repo-relative path; used as a fallback when `fieldnotes_link` is absent. */
	path?: string;
	/** Normalised 0–1 score from the search/ranking layer. */
	score?: number;
	/** Frontmatter band when the hit comes from `field_notes_index`. */
	confidence?: 'high' | 'medium' | 'low' | string;
	/** Frontmatter tags. */
	tags?: string[];
	/** Section slug used as a fallback tag when no tags are present. */
	section?: string;
}

const SUMMARY_MAX = 400;

/**
 * Map the three-tier frontmatter confidence enum onto a representative
 * 0–1 score so the renderer's pill displays consistently regardless of
 * whether the upstream tool produced a numeric `score` or a discrete
 * `confidence` band.
 */
function bandToScore(band: string | undefined): number | undefined {
	if (band === 'high') return 0.9;
	if (band === 'medium') return 0.6;
	if (band === 'low') return 0.3;
	return undefined;
}

function pickSummary(hit: FieldNotesHit): string {
	const raw = hit.summary ?? hit.snippet ?? '';
	if (raw.length <= SUMMARY_MAX) return raw;
	return raw.slice(0, SUMMARY_MAX);
}

function pickConfidence(hit: FieldNotesHit): number | undefined {
	if (typeof hit.score === 'number' && Number.isFinite(hit.score)) {
		return Math.min(1, Math.max(0, hit.score));
	}
	return bandToScore(hit.confidence);
}

function pickTags(hit: FieldNotesHit): string[] | undefined {
	if (hit.tags && hit.tags.length > 0) return hit.tags;
	if (hit.section) return [hit.section];
	return undefined;
}

/**
 * Convert a list of field notes hits into the `cards` array expected by
 * `visualize({ type: 'field-notes-card', data: { cards } })`. Hits with
 * no usable title fall back to `'Untitled'` so the renderer always has
 * something to display.
 */
export function fieldNotesHitsToCards(
	hits: FieldNotesHit[],
): FieldNotesCardPayload['cards'] {
	return hits.map((hit) => {
		const card: FieldNotesCardPayload['cards'][number] = {
			title: hit.title ?? 'Untitled',
			summary: pickSummary(hit),
		};
		const url = hit.fieldnotes_link ?? hit.path;
		if (url) card.url = url;
		const confidence = pickConfidence(hit);
		if (confidence !== undefined) card.confidence = confidence;
		const tags = pickTags(hit);
		if (tags) card.tags = tags;
		return card;
	});
}
