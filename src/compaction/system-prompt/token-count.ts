/**
 * Simple token count estimate.
 *
 * Heuristic: ~0.75 tokens per word (conservative; actual GPT/Claude BPE is
 * closer to 0.75–1.0). Using word count × 1.33 gives a slightly safer
 * estimate that steers clear of under-counting.
 *
 * No external dependency — this is a word-based heuristic suitable for
 * assertion budgets, not for billing or rate-limiting.
 */
export function estimateTokens(text: string): number {
	const words = text.trim().split(/\s+/).filter(Boolean).length;
	return Math.ceil(words * 1.33);
}
