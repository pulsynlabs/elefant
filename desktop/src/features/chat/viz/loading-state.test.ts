// Unit tests for the loading viz pure helpers.
//
// These cover the behaviour the component relies on:
//   - replacement decision when subsequent blocks arrive
//   - step index advancement and clamping
//   - percent clamping into [0,100] including NaN/undefined
//   - active-step resolution with missing or stale indices

import { describe, expect, it } from 'bun:test';
import {
	shouldReplaceLoading,
	nextStepIndex,
	clampPct,
	activeStepIndex,
	type LoadingData,
} from './loading-state.js';

describe('shouldReplaceLoading', () => {
	it('returns false when no loading block exists', () => {
		expect(shouldReplaceLoading(['text', 'tool_call', 'viz'])).toBe(false);
		expect(shouldReplaceLoading([])).toBe(false);
	});

	it('returns false when a loading block is the last block', () => {
		expect(shouldReplaceLoading(['text', 'loading'])).toBe(false);
		expect(shouldReplaceLoading(['loading'])).toBe(false);
		expect(shouldReplaceLoading(['loading', 'loading'])).toBe(false);
	});

	it('returns true when a non-loading block follows the last loading block', () => {
		expect(shouldReplaceLoading(['loading', 'text'])).toBe(true);
		expect(shouldReplaceLoading(['text', 'loading', 'text'])).toBe(true);
		expect(shouldReplaceLoading(['loading', 'tool_call'])).toBe(true);
		expect(shouldReplaceLoading(['loading', 'viz'])).toBe(true);
	});

	it('only considers the most recent loading block', () => {
		// First loading was already followed by text, but the second
		// loading block is current and not yet followed by anything.
		expect(shouldReplaceLoading(['loading', 'text', 'loading'])).toBe(false);
		// Both loading blocks present but the second is followed by text.
		expect(shouldReplaceLoading(['loading', 'text', 'loading', 'text'])).toBe(
			true,
		);
	});
});

describe('nextStepIndex', () => {
	it('advances by one within range', () => {
		expect(nextStepIndex(0, 3)).toBe(1);
		expect(nextStepIndex(1, 3)).toBe(2);
	});

	it('clamps at the last valid index', () => {
		expect(nextStepIndex(2, 3)).toBe(2);
		expect(nextStepIndex(99, 3)).toBe(2);
	});

	it('returns 0 when total is non-positive', () => {
		expect(nextStepIndex(0, 0)).toBe(0);
		expect(nextStepIndex(5, 0)).toBe(0);
		expect(nextStepIndex(0, -1)).toBe(0);
	});
});

describe('clampPct', () => {
	it('returns the rounded value when in range', () => {
		expect(clampPct(0)).toBe(0);
		expect(clampPct(50)).toBe(50);
		expect(clampPct(100)).toBe(100);
		expect(clampPct(33.3)).toBe(33);
		expect(clampPct(33.7)).toBe(34);
	});

	it('clamps below 0 and above 100', () => {
		expect(clampPct(-5)).toBe(0);
		expect(clampPct(-100)).toBe(0);
		expect(clampPct(150)).toBe(100);
		expect(clampPct(9999)).toBe(100);
	});

	it('returns 0 for undefined and NaN', () => {
		expect(clampPct(undefined)).toBe(0);
		expect(clampPct(Number.NaN)).toBe(0);
	});
});

describe('activeStepIndex', () => {
	it('returns null when no steps are present', () => {
		expect(activeStepIndex({ msg: 'hi' })).toBeNull();
		expect(activeStepIndex({ msg: 'hi', steps: [] })).toBeNull();
	});

	it('defaults to 0 when step is omitted', () => {
		const data: LoadingData = { msg: 'hi', steps: ['a', 'b', 'c'] };
		expect(activeStepIndex(data)).toBe(0);
	});

	it('returns the supplied step within range', () => {
		const data: LoadingData = { msg: 'hi', steps: ['a', 'b', 'c'], step: 2 };
		expect(activeStepIndex(data)).toBe(2);
	});

	it('clamps a stale step index to the last valid step', () => {
		const data: LoadingData = { msg: 'hi', steps: ['a', 'b', 'c'], step: 99 };
		expect(activeStepIndex(data)).toBe(2);
	});

	it('clamps a negative step index to 0', () => {
		const data: LoadingData = { msg: 'hi', steps: ['a', 'b'], step: -3 };
		expect(activeStepIndex(data)).toBe(0);
	});
});
