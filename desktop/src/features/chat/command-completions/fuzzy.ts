// Fuzzy ranking for slash command completions.
//
// Pure, dependency-free implementation matching the Wave 3 / MH3 contract:
//   - Prefix match against the trigger ranks highest.
//   - Subsequence match against the trigger ranks next.
//   - Subsequence match against the description acts as a tiebreaker.
//   - Items that match neither the trigger nor the description are excluded.
//
// We intentionally avoid pulling in fzf / fuse.js — the registry is small
// (≤ 30 commands) and a focused scoring function keeps the algorithm
// auditable for accessibility and IME edge cases.

export interface Command {
	readonly trigger: string;
	readonly description: string;
	readonly agent?: string;
	readonly phase?: string;
}

export interface RankedCommand {
	readonly command: Command;
	readonly score: number;
	/**
	 * Indices (into the command's trigger string, with the leading `/`)
	 * that matched the query. Used by the overlay to highlight matched
	 * characters. Empty when the query is empty (everything matches).
	 */
	readonly matchIndices: readonly number[];
}

/**
 * Normalise a query string for matching.
 *
 * - Strips a single leading `/` so callers can pass the raw input value.
 * - Lower-cases for case-insensitive matching.
 * - Trims surrounding whitespace.
 */
export function normaliseQuery(raw: string): string {
	const trimmed = raw.trim();
	const stripped = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
	return stripped.toLowerCase();
}

/**
 * Rank a list of commands against a query string.
 *
 * Returns commands ordered by descending score. Empty query returns all
 * commands in their original order with score 0 and no match indices.
 */
export function rankCommands(commands: readonly Command[], rawQuery: string): RankedCommand[] {
	const query = normaliseQuery(rawQuery);

	if (query.length === 0) {
		return commands.map((command) => ({ command, score: 0, matchIndices: [] }));
	}

	const ranked: RankedCommand[] = [];

	for (const command of commands) {
		const result = scoreCommand(command, query);
		if (result === null) continue;
		ranked.push({ command, ...result });
	}

	ranked.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		// Stable tiebreaker: shorter trigger first (more specific match), then alphabetical.
		const aLen = a.command.trigger.length;
		const bLen = b.command.trigger.length;
		if (aLen !== bLen) return aLen - bLen;
		return a.command.trigger.localeCompare(b.command.trigger);
	});

	return ranked;
}

interface ScoreResult {
	readonly score: number;
	readonly matchIndices: readonly number[];
}

/**
 * Score a single command against a normalised query.
 *
 * Score breakdown (higher = better):
 *   1000  exact trigger match (after the leading `/`)
 *    700  prefix match on trigger
 *    300  subsequence match on trigger
 *     50  subsequence match on description (no trigger match)
 *
 * Bonuses:
 *    +N   shorter trigger relative to query (favours specific matches)
 *
 * Returns null if no match is found.
 */
function scoreCommand(command: Command, query: string): ScoreResult | null {
	// Trigger comes in as `/discuss` etc. We compare against the slug after `/`.
	const trigger = command.trigger.toLowerCase();
	const triggerSlug = trigger.startsWith('/') ? trigger.slice(1) : trigger;
	const description = command.description.toLowerCase();

	// 1. Exact match on trigger slug.
	if (triggerSlug === query) {
		return {
			score: 1000,
			matchIndices: indicesForRange(trigger, 1, triggerSlug.length),
		};
	}

	// 2. Prefix match on trigger slug.
	if (triggerSlug.startsWith(query)) {
		// Specificity bonus: triggers closer in length to the query rank higher.
		const lengthBonus = Math.max(0, 30 - (triggerSlug.length - query.length));
		return {
			score: 700 + lengthBonus,
			matchIndices: indicesForRange(trigger, 1, query.length),
		};
	}

	// 3. Subsequence match on trigger slug.
	const triggerSub = subsequenceMatch(triggerSlug, query);
	if (triggerSub !== null) {
		// Bonus for tighter matches (fewer skipped characters).
		const span = triggerSub[triggerSub.length - 1] - triggerSub[0] + 1;
		const tightnessBonus = Math.max(0, 20 - (span - query.length));
		// Shift indices to account for the leading `/` we stripped.
		const matchIndices = triggerSub.map((i) => i + 1);
		return {
			score: 300 + tightnessBonus,
			matchIndices,
		};
	}

	// 4. Fallback: subsequence match on description.
	if (subsequenceMatch(description, query) !== null) {
		return {
			score: 50,
			// No trigger match indices — overlay will highlight nothing in trigger.
			matchIndices: [],
		};
	}

	return null;
}

/**
 * Return the lexicographically earliest indices in `haystack` whose
 * characters spell out `needle` in order, or null if `needle` is not
 * a subsequence of `haystack`.
 *
 * Both inputs must already be lower-cased.
 */
function subsequenceMatch(haystack: string, needle: string): number[] | null {
	if (needle.length === 0) return [];
	if (needle.length > haystack.length) return null;

	const indices: number[] = [];
	let needleIdx = 0;

	for (let i = 0; i < haystack.length && needleIdx < needle.length; i++) {
		if (haystack[i] === needle[needleIdx]) {
			indices.push(i);
			needleIdx++;
		}
	}

	return needleIdx === needle.length ? indices : null;
}

/**
 * Build a contiguous index range [start, start+count) bounded to the
 * length of the source string. Used for prefix highlights.
 */
function indicesForRange(source: string, start: number, count: number): number[] {
	const upperBound = Math.min(start + count, source.length);
	const range: number[] = [];
	for (let i = start; i < upperBound; i++) range.push(i);
	return range;
}
