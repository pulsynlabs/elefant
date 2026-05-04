/**
 * Tests for the tool search index builder.
 *
 * Covers: ranking, exact-name short-circuit, category filtering, no-match,
 * limit, and performance on a synthetic 100-entry catalog.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
	buildToolIndex,
	searchIndex,
	type IndexEntry,
	type SearchIndex,
} from './index-builder.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleEntries: IndexEntry[] = [
	{ name: 'read', description: 'Read a file from the filesystem', category: 'builtin' },
	{ name: 'write', description: 'Write content to a file', category: 'builtin' },
	{ name: 'edit', description: 'Edit a file with string replacements', category: 'builtin' },
	{ name: 'glob', description: 'Find files by glob pattern', category: 'builtin' },
	{ name: 'grep', description: 'Search file contents with regex', category: 'builtin' },
	{ name: 'bash', description: 'Run a shell command', category: 'builtin' },
	{ name: 'mcp__github__search_repos', description: 'Search GitHub repositories', category: 'mcp' },
	{ name: 'mcp__github__list_issues', description: 'List GitHub issues for a repo', category: 'mcp' },
	{ name: 'mcp__filesystem__read_file', description: 'Read a file via MCP filesystem', category: 'mcp' },
	{ name: 'mcp__filesystem__write_file', description: 'Write a file via MCP filesystem', category: 'mcp' },
	{ name: 'mcp__slack__send_message', description: 'Send a message to a Slack channel', category: 'mcp' },
	{
		name: 'p5js',
		description: 'Creative coding and generative art with p5.js',
		category: 'skill',
		invocationHint: "call skill('p5js') to load full content",
	},
	{
		name: 'svelte-shadcn-dashboard',
		description: 'Build dashboards with Svelte 5 and shadcn/ui',
		category: 'skill',
	},
	{
		name: 'social-writer',
		description: 'Write social media posts for X, LinkedIn, and Threads',
		category: 'skill',
	},
];

let index: SearchIndex;

function setupIndex(): void {
	index = buildToolIndex(sampleEntries);
}

// ---------------------------------------------------------------------------
// buildToolIndex
// ---------------------------------------------------------------------------

describe('buildToolIndex', () => {
	it('wraps entries in a SearchIndex object', () => {
		const idx = buildToolIndex(sampleEntries);
		expect(idx.entries).toEqual(sampleEntries);
		expect(idx.entries).toHaveLength(sampleEntries.length);
	});

	it('accepts an empty array', () => {
		const idx = buildToolIndex([]);
		expect(idx.entries).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// searchIndex — keyword ranking
// ---------------------------------------------------------------------------

describe('searchIndex — keyword ranking', () => {
	beforeEach(setupIndex);

	it('ranks exact name match above description substring match', () => {
		// 'glob' appears as an exact name (glob) and a substring of description
		// (e.g. "Find files by glob pattern")
		const results = searchIndex(index, { query: 'write' });
		// 'write' should be first (exact name), then 'mcp__filesystem__write_file' (description contains)
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].name).toBe('write');
	});

	it('ranks name prefix match above description-only match', () => {
		// 'mcp' is prefix of several names
		const results = searchIndex(index, { query: 'mcp' });
		// All mcp__ entries should appear before anything that only has 'mcp' in description
		// Actually all mcp prefix matches tie, so they'll be in whatever order.
		expect(results.length).toBeGreaterThanOrEqual(5);
		expect(results.every((r) => r.name.startsWith('mcp__'))).toBe(true);
	});

	it('ranks name substring match above description-only match', () => {
		// 'filesystem' appears in mcp__filesystem__* names (score 50)
		// and in read's description "Read a file from the filesystem" (score 25)
		const results = searchIndex(index, { query: 'filesystem' });
		expect(results.length).toBe(3);
		expect(results[0].name).toBe('mcp__filesystem__read_file');
		expect(results[1].name).toBe('mcp__filesystem__write_file');
	});

	it('finds tools by description substring match', () => {
		const results = searchIndex(index, { query: 'regex' });
		expect(results.length).toBe(1);
		expect(results[0].name).toBe('grep');
	});

	it('returns multiple results sorted by descending score', () => {
		// 'read' — exact name match (read) AND substring in description of other tools
		const results = searchIndex(index, { query: 'read' });
		// read should be first
		expect(results[0].name).toBe('read');
		// All results should have 'read' somewhere
		for (const r of results) {
			const matchSource =
				r.name.toLowerCase().includes('read') ||
				r.description.toLowerCase().includes('read');
			expect(matchSource).toBe(true);
		}
	});

	it('is case-insensitive', () => {
		const resultsLower = searchIndex(index, { query: 'read' });
		const resultsUpper = searchIndex(index, { query: 'READ' });
		expect(resultsLower).toEqual(resultsUpper);
		expect(resultsLower.length).toBeGreaterThan(0);
	});

	it('handles whitespace-padded query', () => {
		const results = searchIndex(index, { query: '  read  ' });
		expect(results.length).toBeGreaterThan(0);
		expect(results[0].name).toBe('read');
	});
});

// ---------------------------------------------------------------------------
// searchIndex — exact names short-circuit
// ---------------------------------------------------------------------------

describe('searchIndex — exact names short-circuit', () => {
	beforeEach(setupIndex);

	it('returns matching tools by exact name (case-insensitive)', () => {
		const results = searchIndex(index, { names: ['read', 'WRITE', 'grep'] });
		expect(results).toHaveLength(3);
		expect(results.map((r) => r.name)).toEqual(['read', 'write', 'grep']);
	});

	it('preserves input order in output', () => {
		const names = ['grep', 'read', 'write'];
		const results = searchIndex(index, { names });
		expect(results.map((r) => r.name)).toEqual(names);
	});

	it('skips names not in the index', () => {
		const results = searchIndex(index, { names: ['read', 'nonexistent', 'write'] });
		expect(results).toHaveLength(2);
		expect(results.map((r) => r.name)).toEqual(['read', 'write']);
	});

	it('applies category filter alongside names', () => {
		const results = searchIndex(index, { names: ['read', 'write', 'p5js'], category: 'skill' });
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('p5js');
	});

	it('short-circuits query when names is provided', () => {
		// Even though query='mcp', names specifies builtins only
		const results = searchIndex(index, { names: ['read', 'write'], query: 'mcp' });
		expect(results).toHaveLength(2);
		expect(results.map((r) => r.name)).toEqual(['read', 'write']);
	});

	it('returns empty for entirely unmatched names', () => {
		const results = searchIndex(index, { names: ['nonexistent', 'also-missing'] });
		expect(results).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// searchIndex — category filtering
// ---------------------------------------------------------------------------

describe('searchIndex — category filtering', () => {
	beforeEach(setupIndex);

	it('filters to builtin tools only', () => {
		const results = searchIndex(index, { query: 'file', category: 'builtin' });
		expect(results.length).toBeGreaterThan(0);
		expect(results.every((r) => r.category === 'builtin')).toBe(true);
	});

	it('filters to mcp tools only', () => {
		const results = searchIndex(index, { query: 'mcp', category: 'mcp' });
		// mcp__ tools whose name contains 'mcp' — all of them
		expect(results.every((r) => r.category === 'mcp')).toBe(true);
	});

	it('filters to skill tools only', () => {
		const results = searchIndex(index, { query: 'svelte', category: 'skill' });
		expect(results.length).toBe(1);
		expect(results[0].category).toBe('skill');
	});

	it('"all" category imposes no filter', () => {
		const noFilter = searchIndex(index, { query: 'read' });
		const allFilter = searchIndex(index, { query: 'read', category: 'all' });
		expect(allFilter).toEqual(noFilter);
	});

	it('undefined category imposes no filter', () => {
		const noFilter = searchIndex(index, { query: 'read' });
		const undefinedFilter = searchIndex(index, { query: 'read', category: undefined });
		expect(undefinedFilter).toEqual(noFilter);
	});

	it('category filter with no query returns all in category', () => {
		const results = searchIndex(index, { category: 'skill' });
		expect(results.length).toBe(3);
		expect(results.every((r) => r.category === 'skill')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// searchIndex — no-match
// ---------------------------------------------------------------------------

describe('searchIndex — no-match', () => {
	beforeEach(setupIndex);

	it('returns empty array when query matches nothing', () => {
		const results = searchIndex(index, { query: 'xyznonexistent123' });
		expect(results).toEqual([]);
	});

	it('returns empty array when category filter excludes all matches', () => {
		// Query 'bash' appears only in the builtin 'bash' tool's name.
		// With category='skill', the hard filter removes it.
		const results = searchIndex(index, { query: 'bash', category: 'skill' });
		expect(results).toEqual([]);
	});

	it('returns empty array from an empty index', () => {
		const empty = buildToolIndex([]);
		expect(searchIndex(empty, { query: 'anything' })).toEqual([]);
		expect(searchIndex(empty, { names: ['anything'] })).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// searchIndex — limit
// ---------------------------------------------------------------------------

describe('searchIndex — limit', () => {
	beforeEach(setupIndex);

	it('respects an explicit limit', () => {
		const results = searchIndex(index, { query: 'file', limit: 2 });
		expect(results.length).toBeLessThanOrEqual(2);
	});

	it('defaults to 10 when limit is not specified', () => {
		// Build an index with >10 entries that match a broad query
		const bigIndex = buildToolIndex(
			Array.from({ length: 20 }, (_, i) => ({
				name: `tool-${i}`,
				description: `Tool number ${i} that does things with data`,
				category: 'builtin' as const,
			}))
		);
		const results = searchIndex(bigIndex, { query: 'data' });
		expect(results.length).toBe(10);
	});

	it('returns fewer than limit when fewer match', () => {
		const results = searchIndex(index, { query: 'regex', limit: 5 });
		expect(results.length).toBe(1);
	});

	it('works with names[] path', () => {
		const results = searchIndex(index, {
			names: ['read', 'write', 'edit', 'glob', 'grep', 'bash'],
			limit: 3,
		});
		expect(results).toHaveLength(3);
	});
});

// ---------------------------------------------------------------------------
// searchIndex — category bonus
// ---------------------------------------------------------------------------

describe('searchIndex — category bonus', () => {
	it('boosts entries matching the active category filter (hard filter)', () => {
		// Both entries match 'search' by name, but only builtin-search matches
		// the category filter. With category='builtin', mcp-search is excluded.
		const idx = buildToolIndex([
			{ name: 'builtin-search', description: 'Search across all things', category: 'builtin' },
			{ name: 'mcp-search', description: 'Search across all things', category: 'mcp' },
		]);
		const results = searchIndex(idx, { query: 'search', category: 'builtin' });
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('builtin-search');
	});

	it('includes results from all categories when filter is "all"', () => {
		const idx = buildToolIndex([
			{ name: 'builtin-search', description: 'Search across all things', category: 'builtin' },
			{ name: 'mcp-search', description: 'Search across all things', category: 'mcp' },
		]);
		const results = searchIndex(idx, { query: 'search', category: 'all' });
		expect(results).toHaveLength(2);
	});

	it('does not apply category bonus when filter is "all"', () => {
		const idx = buildToolIndex([
			{ name: 'alpha', description: 'Common desc', category: 'builtin' },
			{ name: 'beta', description: 'Common desc', category: 'skill' },
		]);
		const results = searchIndex(idx, { query: 'Common', category: 'all' });
		// Without bonus, both score the same — stable sort means whichever comes first in entries
		expect(results).toHaveLength(2);
		// Order is stable (insertion order), so alpha then beta
		expect(results[0].name).toBe('alpha');
		expect(results[1].name).toBe('beta');
	});

	it('does not apply category bonus when filter is undefined', () => {
		const idx = buildToolIndex([
			{ name: 'alpha', description: 'Common desc', category: 'builtin' },
			{ name: 'beta', description: 'Common desc', category: 'skill' },
		]);
		const results = searchIndex(idx, { query: 'Common' });
		expect(results).toHaveLength(2);
		expect(results[0].name).toBe('alpha');
	});
});

// ---------------------------------------------------------------------------
// searchIndex — no query and no names
// ---------------------------------------------------------------------------

describe('searchIndex — no query and no names', () => {
	beforeEach(setupIndex);

	it('returns all entries when limit is large enough', () => {
		const results = searchIndex(index, { limit: 50 });
		expect(results.length).toBe(sampleEntries.length);
	});

	it('applies category filter when no query/names', () => {
		const results = searchIndex(index, { category: 'mcp' });
		expect(results.length).toBe(5);
		expect(results.every((r) => r.category === 'mcp')).toBe(true);
	});

	it('respects limit when no query/names', () => {
		const results = searchIndex(index, { limit: 3 });
		expect(results).toHaveLength(3);
	});
});

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

describe('searchIndex — performance', () => {
	it('completes search on a 100-entry index in under 50ms', () => {
		const catalog: IndexEntry[] = [];
		const categories: Array<'builtin' | 'mcp' | 'skill'> = ['builtin', 'mcp', 'skill'];
		for (let i = 0; i < 100; i++) {
			const cat = categories[i % 3];
			catalog.push({
				name: `${cat}-tool-${i}`,
				description: `Tool number ${i} for category ${cat}. Handles operation ${String.fromCharCode(65 + (i % 26))}.`,
				category: cat,
			});
		}

		const idx = buildToolIndex(catalog);
		expect(idx.entries).toHaveLength(100);

		// Warm-up iteration (V8/Hermes compilation)
		searchIndex(idx, { query: 'builtin' });

		const iterations = 50;
		const start = performance.now();
		for (let i = 0; i < iterations; i++) {
			searchIndex(idx, { query: 'builtin' });
			searchIndex(idx, { query: 'mcp' });
			searchIndex(idx, { query: 'skill' });
			searchIndex(idx, { names: ['builtin-tool-0', 'mcp-tool-10', 'skill-tool-20'] });
			searchIndex(idx, { query: 'tool-50' });
		}
		const elapsed = performance.now() - start;
		const avgPerCall = elapsed / (iterations * 5); // 5 lookups per iteration

		expect(avgPerCall).toBeLessThan(50);
	});
});

// ---------------------------------------------------------------------------
// IndexEntry — invocationHint preservation
// ---------------------------------------------------------------------------

describe('IndexEntry — invocationHint', () => {
	it('preserves invocationHint in search results', () => {
		const idx = buildToolIndex([
			{ name: 'p5js', description: 'Creative coding', category: 'skill', invocationHint: "call skill('p5js')" },
			{ name: 'bash', description: 'Run commands', category: 'builtin' },
		]);

		const results = searchIndex(idx, { query: 'p5js' });
		expect(results).toHaveLength(1);
		expect(results[0].invocationHint).toBe("call skill('p5js')");
	});

	it('returns undefined invocationHint when not set', () => {
		const idx = buildToolIndex([
			{ name: 'bash', description: 'Run commands', category: 'builtin' },
		]);

		const results = searchIndex(idx, { query: 'bash' });
		expect(results).toHaveLength(1);
		expect(results[0].invocationHint).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('searchIndex — edge cases', () => {
	beforeEach(setupIndex);

	it('handles empty query string', () => {
		const results = searchIndex(index, { query: '' });
		// Empty query should return all entries (no-op search)
		expect(results.length).toBeGreaterThan(0);
	});

	it('handles empty names array', () => {
		const results = searchIndex(index, { names: [] });
		// Should fall through to the no-filter path
		expect(results.length).toBeGreaterThan(0);
	});

	it('handles special regex characters in query literally', () => {
		const idx = buildToolIndex([
			{ name: 'func(a,b)', description: 'Function with parens', category: 'builtin' },
		]);
		const results = searchIndex(idx, { query: 'func(a,b)' });
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('func(a,b)');
	});

	it('returns stable results for repeated calls', () => {
		const first = searchIndex(index, { query: 'file' });
		const second = searchIndex(index, { query: 'file' });
		expect(first).toEqual(second);
	});
});

// This empty export is required for the file to be a valid module
export {};
