import { describe, it, expect } from 'bun:test';
import { shouldOpenOverlay, extractQuery, applySelection } from './input-state.js';

describe('shouldOpenOverlay', () => {
	it('opens for the bare leading slash', () => {
		expect(shouldOpenOverlay('/', false)).toBe(true);
	});

	it('opens while the user is typing a partial command', () => {
		expect(shouldOpenOverlay('/d', false)).toBe(true);
		expect(shouldOpenOverlay('/dis', false)).toBe(true);
		expect(shouldOpenOverlay('/discuss', false)).toBe(true);
	});

	it('opens for hyphenated triggers', () => {
		expect(shouldOpenOverlay('/map-codebase', false)).toBe(true);
		expect(shouldOpenOverlay('/pr-review', false)).toBe(true);
	});

	it('does NOT open when the value is empty', () => {
		expect(shouldOpenOverlay('', false)).toBe(false);
	});

	it('does NOT open when the value does not start with a slash', () => {
		expect(shouldOpenOverlay('hello', false)).toBe(false);
	});

	it('does NOT open after a space (multi-token input)', () => {
		expect(shouldOpenOverlay('/discuss now', false)).toBe(false);
	});

	it('does NOT open after a newline (multi-line input)', () => {
		expect(shouldOpenOverlay('/discuss\nfoo', false)).toBe(false);
	});

	it('does NOT open while IME composition is active', () => {
		expect(shouldOpenOverlay('/dis', true)).toBe(false);
	});

	it('does NOT open for a slash followed by non-word characters', () => {
		expect(shouldOpenOverlay('/dis@', false)).toBe(false);
		expect(shouldOpenOverlay('/dis.', false)).toBe(false);
	});
});

describe('extractQuery', () => {
	it('returns the substring after the leading slash', () => {
		expect(extractQuery('/dis')).toBe('dis');
	});

	it('returns empty string for the bare slash', () => {
		expect(extractQuery('/')).toBe('');
	});

	it('returns empty for non-overlay values', () => {
		expect(extractQuery('hello')).toBe('');
		expect(extractQuery('/discuss now')).toBe('');
	});

	it('preserves hyphens in the query', () => {
		expect(extractQuery('/map-cod')).toBe('map-cod');
	});
});

describe('applySelection', () => {
	it('appends a trailing space so the user can type arguments', () => {
		expect(applySelection('/discuss')).toBe('/discuss ');
	});

	it('the result no longer matches the overlay pattern', () => {
		const next = applySelection('/discuss');
		expect(shouldOpenOverlay(next, false)).toBe(false);
	});

	it('passes through hyphenated triggers', () => {
		expect(applySelection('/map-codebase')).toBe('/map-codebase ');
	});
});
