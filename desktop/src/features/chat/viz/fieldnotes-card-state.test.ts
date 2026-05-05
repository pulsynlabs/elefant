// Unit tests for the research-card viz helpers.
//
// Cover every branch of each helper — the renderer trusts these
// functions to be total, so the test suite has to keep them so.

import { describe, expect, it } from 'bun:test';
import {
	confidenceColorToken,
	formatConfidence,
	isResearchUri,
	truncateTags,
} from './research-card-state.js';

describe('formatConfidence', () => {
	it('returns "high" for scores at or above 0.8', () => {
		expect(formatConfidence(0.8)).toBe('high');
		expect(formatConfidence(0.9)).toBe('high');
		expect(formatConfidence(1)).toBe('high');
	});

	it('returns "med" for scores between 0.5 and 0.8', () => {
		expect(formatConfidence(0.5)).toBe('med');
		expect(formatConfidence(0.6)).toBe('med');
		expect(formatConfidence(0.79)).toBe('med');
	});

	it('returns "low" for scores below 0.5', () => {
		expect(formatConfidence(0.3)).toBe('low');
		expect(formatConfidence(0)).toBe('low');
		expect(formatConfidence(0.49)).toBe('low');
	});

	it('returns empty string for undefined', () => {
		expect(formatConfidence(undefined)).toBe('');
	});
});

describe('confidenceColorToken', () => {
	it('maps high scores to the success token', () => {
		expect(confidenceColorToken(0.9)).toBe('var(--color-success)');
		expect(confidenceColorToken(0.8)).toBe('var(--color-success)');
	});

	it('maps medium scores to the warning token', () => {
		expect(confidenceColorToken(0.6)).toBe('var(--color-warning)');
		expect(confidenceColorToken(0.5)).toBe('var(--color-warning)');
	});

	it('maps low scores to the error token', () => {
		expect(confidenceColorToken(0.3)).toBe('var(--color-error)');
		expect(confidenceColorToken(0)).toBe('var(--color-error)');
	});

	it('falls back to muted text token for undefined', () => {
		expect(confidenceColorToken(undefined)).toBe('var(--text-muted)');
	});
});

describe('truncateTags', () => {
	it('returns the same array when length is at or below max', () => {
		expect(truncateTags(['a', 'b'], 4)).toEqual(['a', 'b']);
		expect(truncateTags(['a', 'b', 'c', 'd'], 4)).toEqual(['a', 'b', 'c', 'd']);
	});

	it('slices to max when length exceeds it', () => {
		expect(truncateTags(['a', 'b', 'c', 'd', 'e'], 3)).toEqual(['a', 'b', 'c']);
	});

	it('returns empty array for undefined', () => {
		expect(truncateTags(undefined, 4)).toEqual([]);
	});

	it('returns empty array for empty input', () => {
		expect(truncateTags([], 4)).toEqual([]);
	});

	it('returns empty array when max is zero or negative', () => {
		expect(truncateTags(['a', 'b'], 0)).toEqual([]);
		expect(truncateTags(['a', 'b'], -1)).toEqual([]);
	});
});

describe('isResearchUri', () => {
	it('returns true for research:// URIs', () => {
		expect(isResearchUri('research://feat-x/02-tech/foo.md')).toBe(true);
		expect(isResearchUri('research://_/01-domain/bar.md#anchor')).toBe(true);
	});

	it('returns false for http/https URLs', () => {
		expect(isResearchUri('http://example.com')).toBe(false);
		expect(isResearchUri('https://example.com/page')).toBe(false);
	});

	it('returns false for relative paths', () => {
		expect(isResearchUri('./foo.md')).toBe(false);
		expect(isResearchUri('docs/bar.md')).toBe(false);
	});

	it('returns false for undefined or empty string', () => {
		expect(isResearchUri(undefined)).toBe(false);
		expect(isResearchUri('')).toBe(false);
	});
});
