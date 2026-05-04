// Unit tests for the research → research-card adapter.
//
// Cover the field-mapping fan-in (search vs index shapes), defensive
// defaults for missing fields, summary truncation, score clamping,
// and the discrete-band → numeric-score mapping.

import { describe, expect, it } from 'bun:test';
import { researchHitsToCards, type ResearchHit } from './research.js';
import { researchCardSchema } from '../schemas.js';

describe('researchHitsToCards', () => {
	it('maps a research_search SearchResult shape', () => {
		const hits: ResearchHit[] = [
			{
				title: 'Mermaid theming',
				summary: 'How to map Quire tokens onto mermaid themeVariables.',
				research_link: 'research://feat-rich-viz/02-tech/mermaid.md',
				score: 0.82,
				tags: ['mermaid', 'svelte'],
			},
		];

		const cards = researchHitsToCards(hits);

		expect(cards).toEqual([
			{
				title: 'Mermaid theming',
				summary: 'How to map Quire tokens onto mermaid themeVariables.',
				url: 'research://feat-rich-viz/02-tech/mermaid.md',
				confidence: 0.82,
				tags: ['mermaid', 'svelte'],
			},
		]);
	});

	it('maps a research_index FlatFile shape', () => {
		const hits: ResearchHit[] = [
			{
				title: 'Decision: viz envelope contract',
				summary: 'Discriminated union per viz type, validated by Zod.',
				research_link: 'research://feat-rich-viz/03-decisions/viz.md',
				confidence: 'high',
				tags: ['decision', 'viz'],
			},
		];

		const cards = researchHitsToCards(hits);

		expect(cards[0]?.confidence).toBe(0.9);
		expect(cards[0]?.url).toBe('research://feat-rich-viz/03-decisions/viz.md');
	});

	it('falls back to snippet when summary is missing', () => {
		const cards = researchHitsToCards([
			{ title: 'A', snippet: 'short snippet text' },
		]);
		expect(cards[0]?.summary).toBe('short snippet text');
	});

	it('falls back to "Untitled" when title is missing', () => {
		const cards = researchHitsToCards([{ summary: 'orphan summary' }]);
		expect(cards[0]?.title).toBe('Untitled');
	});

	it('omits url when neither research_link nor path is present', () => {
		const cards = researchHitsToCards([{ title: 'A', summary: 'B' }]);
		expect(cards[0]?.url).toBeUndefined();
	});

	it('uses path when research_link is absent', () => {
		const cards = researchHitsToCards([
			{ title: 'A', summary: 'B', path: '.elefant/markdown-db/foo.md' },
		]);
		expect(cards[0]?.url).toBe('.elefant/markdown-db/foo.md');
	});

	it('truncates long summaries to 400 chars', () => {
		const long = 'x'.repeat(800);
		const cards = researchHitsToCards([{ title: 'A', summary: long }]);
		expect(cards[0]?.summary.length).toBe(400);
	});

	it('clamps out-of-range scores to [0, 1]', () => {
		expect(researchHitsToCards([{ title: 'A', score: 1.4 }])[0]?.confidence).toBe(1);
		expect(researchHitsToCards([{ title: 'A', score: -0.2 }])[0]?.confidence).toBe(0);
	});

	it('drops non-finite scores instead of producing NaN confidence', () => {
		const cards = researchHitsToCards([{ title: 'A', score: Number.NaN }]);
		expect(cards[0]?.confidence).toBeUndefined();
	});

	it('maps the three confidence bands to representative scores', () => {
		expect(researchHitsToCards([{ title: 'A', confidence: 'high' }])[0]?.confidence).toBe(0.9);
		expect(researchHitsToCards([{ title: 'A', confidence: 'medium' }])[0]?.confidence).toBe(0.6);
		expect(researchHitsToCards([{ title: 'A', confidence: 'low' }])[0]?.confidence).toBe(0.3);
	});

	it('falls back to section as a single-element tag when tags missing', () => {
		const cards = researchHitsToCards([
			{ title: 'A', summary: 'B', section: '02-tech' },
		]);
		expect(cards[0]?.tags).toEqual(['02-tech']);
	});

	it('omits tags entirely when neither tags nor section is present', () => {
		const cards = researchHitsToCards([{ title: 'A', summary: 'B' }]);
		expect(cards[0]?.tags).toBeUndefined();
	});

	it('returns an empty array for an empty input', () => {
		expect(researchHitsToCards([])).toEqual([]);
	});

	it('produces output that the research-card Zod schema accepts', () => {
		const cards = researchHitsToCards([
			{
				title: 'Real hit',
				summary: 'A reasonable summary.',
				research_link: 'research://feat-x/01-domain/foo.md',
				score: 0.75,
				tags: ['a', 'b', 'c'],
			},
			{ title: 'Bare hit', summary: 'just text' },
		]);

		const parsed = researchCardSchema.safeParse({
			type: 'research-card',
			cards,
		});

		expect(parsed.success).toBe(true);
	});
});
