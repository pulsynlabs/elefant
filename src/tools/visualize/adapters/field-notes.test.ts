// Unit tests for the research → research-card adapter.
//
// Cover the field-mapping fan-in (search vs index shapes), defensive
// defaults for missing fields, summary truncation, score clamping,
// and the discrete-band → numeric-score mapping.

import { describe, expect, it } from 'bun:test';
import { fieldNotesHitsToCards, type FieldNotesHit } from './field-notes.js';
import { fieldNotesCardSchema } from '../schemas.js';

describe('fieldNotesHitsToCards', () => {
	it('maps a field_notes_search SearchResult shape', () => {
		const hits: FieldNotesHit[] = [
			{
				title: 'Mermaid theming',
				summary: 'How to map Quire tokens onto mermaid themeVariables.',
				fieldnotes_link: 'fieldnotes://feat-rich-viz/02-tech/mermaid.md',
				score: 0.82,
				tags: ['mermaid', 'svelte'],
			},
		];

		const cards = fieldNotesHitsToCards(hits);

		expect(cards).toEqual([
			{
				title: 'Mermaid theming',
				summary: 'How to map Quire tokens onto mermaid themeVariables.',
				url: 'fieldnotes://feat-rich-viz/02-tech/mermaid.md',
				confidence: 0.82,
				tags: ['mermaid', 'svelte'],
			},
		]);
	});

	it('maps a field_notes_index FlatFile shape', () => {
		const hits: FieldNotesHit[] = [
			{
				title: 'Decision: viz envelope contract',
				summary: 'Discriminated union per viz type, validated by Zod.',
				fieldnotes_link: 'fieldnotes://feat-rich-viz/03-decisions/viz.md',
				confidence: 'high',
				tags: ['decision', 'viz'],
			},
		];

		const cards = fieldNotesHitsToCards(hits);

		expect(cards[0]?.confidence).toBe(0.9);
		expect(cards[0]?.url).toBe('fieldnotes://feat-rich-viz/03-decisions/viz.md');
	});

	it('falls back to snippet when summary is missing', () => {
		const cards = fieldNotesHitsToCards([
			{ title: 'A', snippet: 'short snippet text' },
		]);
		expect(cards[0]?.summary).toBe('short snippet text');
	});

	it('falls back to "Untitled" when title is missing', () => {
		const cards = fieldNotesHitsToCards([{ summary: 'orphan summary' }]);
		expect(cards[0]?.title).toBe('Untitled');
	});

	it('omits url when neither fieldnotes_link nor path is present', () => {
		const cards = fieldNotesHitsToCards([{ title: 'A', summary: 'B' }]);
		expect(cards[0]?.url).toBeUndefined();
	});

	it('uses path when fieldnotes_link is absent', () => {
		const cards = fieldNotesHitsToCards([
			{ title: 'A', summary: 'B', path: '.elefant/field-notes/foo.md' },
		]);
		expect(cards[0]?.url).toBe('.elefant/field-notes/foo.md');
	});

	it('truncates long summaries to 400 chars', () => {
		const long = 'x'.repeat(800);
		const cards = fieldNotesHitsToCards([{ title: 'A', summary: long }]);
		expect(cards[0]?.summary.length).toBe(400);
	});

	it('clamps out-of-range scores to [0, 1]', () => {
		expect(fieldNotesHitsToCards([{ title: 'A', score: 1.4 }])[0]?.confidence).toBe(1);
		expect(fieldNotesHitsToCards([{ title: 'A', score: -0.2 }])[0]?.confidence).toBe(0);
	});

	it('drops non-finite scores instead of producing NaN confidence', () => {
		const cards = fieldNotesHitsToCards([{ title: 'A', score: Number.NaN }]);
		expect(cards[0]?.confidence).toBeUndefined();
	});

	it('maps the three confidence bands to representative scores', () => {
		expect(fieldNotesHitsToCards([{ title: 'A', confidence: 'high' }])[0]?.confidence).toBe(0.9);
		expect(fieldNotesHitsToCards([{ title: 'A', confidence: 'medium' }])[0]?.confidence).toBe(0.6);
		expect(fieldNotesHitsToCards([{ title: 'A', confidence: 'low' }])[0]?.confidence).toBe(0.3);
	});

	it('falls back to section as a single-element tag when tags missing', () => {
		const cards = fieldNotesHitsToCards([
			{ title: 'A', summary: 'B', section: '02-tech' },
		]);
		expect(cards[0]?.tags).toEqual(['02-tech']);
	});

	it('omits tags entirely when neither tags nor section is present', () => {
		const cards = fieldNotesHitsToCards([{ title: 'A', summary: 'B' }]);
		expect(cards[0]?.tags).toBeUndefined();
	});

	it('returns an empty array for an empty input', () => {
		expect(fieldNotesHitsToCards([])).toEqual([]);
	});

	it('produces output that the field-notes-card Zod schema accepts', () => {
		const cards = fieldNotesHitsToCards([
			{
				title: 'Real hit',
				summary: 'A reasonable summary.',
				fieldnotes_link: 'fieldnotes://feat-x/01-domain/foo.md',
				score: 0.75,
				tags: ['a', 'b', 'c'],
			},
			{ title: 'Bare hit', summary: 'just text' },
		]);

		const parsed = fieldNotesCardSchema.safeParse({
			type: 'field-notes-card',
			cards,
		});

		expect(parsed.success).toBe(true);
	});
});
