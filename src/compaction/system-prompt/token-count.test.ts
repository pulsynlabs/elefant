import { describe, expect, it } from 'bun:test';
import { estimateTokens } from './token-count.ts';

describe('estimateTokens', () => {
	it('returns 0 for an empty string', () => {
		expect(estimateTokens('')).toBe(0);
	});

	it('returns 0 for a whitespace-only string', () => {
		expect(estimateTokens('   \t\n  ')).toBe(0);
	});

	it('counts a single word as 2 tokens (1 × 1.33 → 2)', () => {
		expect(estimateTokens('hello')).toBe(2);
	});

	it('counts known strings with reasonable estimates', () => {
		// 10 words × 1.33 = 13.3 → ceil = 14
		expect(estimateTokens('the quick brown fox jumps over the lazy dog today')).toBe(14);
	});

	it('produces a consistent estimate for typical prompt text', () => {
		const text = '## Identity\n- You are Elefant, an AI coding agent.';
		// 10 words × 1.33 = 13.3 → ceil = 14
		expect(estimateTokens(text)).toBe(14);
	});

	it('handles markdown formatting characters', () => {
		const text = '**read** — Read file contents. For directories, lists entries.';
		// 9 words × 1.33 = 11.97 → ceil = 12
		expect(estimateTokens(text)).toBe(12);
	});

	it('returns monotonically larger values for longer text', () => {
		const short = '## Identity\n- You are Elefant.';
		const long = '## Identity\n- You are Elefant, an AI coding agent running inside the project.\n- Prioritise correctness.';
		expect(estimateTokens(short)).toBeLessThan(estimateTokens(long));
	});
});
