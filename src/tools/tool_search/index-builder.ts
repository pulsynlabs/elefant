/**
 * Tool search index builder — in-memory keyword/substring index for tool
 * discovery. Ranks results by name match → description match → category match.
 *
 * No external dependencies; pure TypeScript.
 */

export type ToolCategory = 'builtin' | 'mcp' | 'skill' | 'all';

export interface IndexEntry {
	name: string;
	description: string;
	category: ToolCategory;
	/** For skills: the invocation hint shown to the agent (e.g. "call skill('name') to load full content") */
	invocationHint?: string;
}

export interface SearchIndex {
	entries: IndexEntry[];
}

export interface SearchOptions {
	/** Keyword query — substring matching with ranking */
	query?: string;
	/** Exact name lookup — short-circuits ranking when provided */
	names?: string[];
	/** Filter results to a single category (or 'all' for no filter) */
	category?: ToolCategory;
	/** Max results to return (default: 10) */
	limit?: number;
}

/**
 * Build an immutable in-memory search index from a list of entries.
 */
export function buildToolIndex(entries: IndexEntry[]): SearchIndex {
	return { entries };
}

// ---------------------------------------------------------------------------
// Scoring constants for ranking
// ---------------------------------------------------------------------------

/** Exact name match (case-insensitive). Highest priority. */
const SCORE_EXACT_NAME = 100;
/** Query is a prefix of the tool name. */
const SCORE_NAME_PREFIX = 75;
/** Query appears anywhere in the tool name. */
const SCORE_NAME_SUBSTRING = 50;
/** Query appears in the description. */
const SCORE_DESCRIPTION_SUBSTRING = 25;
/** Bonus when the entry's category matches an active category filter. */
const SCORE_CATEGORY_BONUS = 10;

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

type ScoredEntry = { entry: IndexEntry; score: number };

/**
 * Compute a relevance score for a single entry against a query string.
 *
 * Category bonus is only awarded when the entry already has a positive
 * query-match score AND an active (non-'all') category filter matches the
 * entry's category.  This prevents entries with no query relevance from
 * surfacing solely because of a category bonus.
 */
function scoreEntry(entry: IndexEntry, queryLower: string, activeCategory?: ToolCategory): number {
	let score = 0;
	const nameLower = entry.name.toLowerCase();

	if (nameLower === queryLower) {
		score = SCORE_EXACT_NAME;
	} else if (nameLower.startsWith(queryLower)) {
		score = SCORE_NAME_PREFIX;
	} else if (nameLower.includes(queryLower)) {
		score = SCORE_NAME_SUBSTRING;
	} else if (entry.description.toLowerCase().includes(queryLower)) {
		score = SCORE_DESCRIPTION_SUBSTRING;
	}

	// Category bonus only applies when the entry already has query relevance.
	if (
		score > 0 &&
		activeCategory &&
		activeCategory !== 'all' &&
		entry.category === activeCategory
	) {
		score += SCORE_CATEGORY_BONUS;
	}

	return score;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search the index.
 *
 * When `opts.names` is provided the function short-circuits ranking and returns
 * matching entries directly (exact case-insensitive name match against every
 * element in the `names` array).  Order is preserved from the `names` input.
 *
 * When `opts.query` is provided, entries are ranked by:
 *  1. exact name match            (score 100)
 *  2. name prefix match           (score 75)
 *  3. name substring match        (score 50)
 *  4. description substring match (score 25)
 *  + category bonus (+10) when the active category filter matches the entry.
 *
 * If neither `names` nor `query` is provided, all entries are returned
 * (subject to category filter and limit).
 */
export function searchIndex(index: SearchIndex, opts: SearchOptions): IndexEntry[] {
	const limit = opts.limit ?? 10;
	const category = opts.category ?? 'all';

	// --- exact names short-circuit ---
	if (opts.names && opts.names.length > 0) {
		const namesLower = new Set(opts.names.map((n) => n.toLowerCase()));
		const results = index.entries.filter((entry) => {
			if (!namesLower.has(entry.name.toLowerCase())) return false;
			if (category !== 'all' && entry.category !== category) return false;
			return true;
		});
		// Preserve input order
		const ordered: IndexEntry[] = [];
		const found = new Set<string>();
		for (const name of opts.names) {
			const match = results.find(
				(e) => e.name.toLowerCase() === name.toLowerCase() && !found.has(e.name)
			);
			if (match) {
				ordered.push(match);
				found.add(match.name);
			}
		}
		return ordered.slice(0, limit);
	}

	// --- query-based ranking ---
	if (opts.query && opts.query.trim().length > 0) {
		const queryLower = opts.query.trim().toLowerCase();
		const scored: ScoredEntry[] = [];

		for (const entry of index.entries) {
			const score = scoreEntry(entry, queryLower, category);
			if (score > 0) {
				scored.push({ entry, score });
			}
		}

		scored.sort((a, b) => b.score - a.score);

		let results = scored.map((s) => s.entry);

		// Apply hard category filter (only entries matching the category survive).
		if (category !== 'all') {
			results = results.filter((e) => e.category === category);
		}

		return results.slice(0, limit);
	}

	// --- no filter — return all (category filter + limit) ---
	if (category !== 'all') {
		return index.entries.filter((e) => e.category === category).slice(0, limit);
	}
	return index.entries.slice(0, limit);
}
