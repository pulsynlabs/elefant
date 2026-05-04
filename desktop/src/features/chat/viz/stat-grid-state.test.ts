import { describe, it, expect } from 'bun:test';
import {
	formatDelta,
	trendToColorToken,
	formatValue,
	hasTrendData,
} from './stat-grid-state.js';

describe('formatDelta', () => {
	it('formats a positive delta with explicit sign', () => {
		expect(formatDelta(5)).toBe('+5');
	});

	it('keeps the native minus sign on a negative delta', () => {
		expect(formatDelta(-3)).toBe('-3');
	});

	it('formats zero as +0 to keep the sign column stable', () => {
		expect(formatDelta(0)).toBe('+0');
	});

	it('returns the empty string when delta is undefined', () => {
		expect(formatDelta(undefined)).toBe('');
	});

	it('returns the empty string when delta is null', () => {
		expect(formatDelta(null)).toBe('');
	});

	it('appends a unit when provided', () => {
		expect(formatDelta(10, 'ms')).toBe('+10 ms');
	});

	it('appends a unit on negative deltas too', () => {
		expect(formatDelta(-7, '%')).toBe('-7 %');
	});

	it('omits the unit when delta is undefined', () => {
		expect(formatDelta(undefined, 'ms')).toBe('');
	});
});

describe('trendToColorToken', () => {
	it('maps up to the success color token', () => {
		expect(trendToColorToken('up')).toBe('var(--color-success)');
	});

	it('maps down to the error color token', () => {
		expect(trendToColorToken('down')).toBe('var(--color-error)');
	});

	it('maps flat to the muted text token', () => {
		expect(trendToColorToken('flat')).toBe('var(--text-muted)');
	});

	it('falls back to the muted token on undefined trend', () => {
		expect(trendToColorToken(undefined)).toBe('var(--text-muted)');
	});
});

describe('formatValue', () => {
	it('applies locale grouping to numbers', () => {
		expect(formatValue(1234)).toBe('1,234');
	});

	it('applies locale grouping to large numbers', () => {
		expect(formatValue(1234567)).toBe('1,234,567');
	});

	it('passes string values through unchanged', () => {
		expect(formatValue('99%')).toBe('99%');
	});

	it('appends a unit to a numeric value', () => {
		expect(formatValue(42, 'ms')).toBe('42 ms');
	});

	it('appends a unit to a string value', () => {
		expect(formatValue('1.2k', 'req')).toBe('1.2k req');
	});

	it('preserves zero as 0', () => {
		expect(formatValue(0)).toBe('0');
	});
});

describe('hasTrendData', () => {
	it('returns true when at least one item has a trend', () => {
		expect(hasTrendData([{ trend: 'up' }])).toBe(true);
	});

	it('returns true when at least one item has a delta', () => {
		expect(hasTrendData([{ delta: 5 }])).toBe(true);
	});

	it('returns false when no item carries trend or delta', () => {
		expect(hasTrendData([{}, {}])).toBe(false);
	});

	it('returns false for an empty array', () => {
		expect(hasTrendData([])).toBe(false);
	});

	it('returns true when one of several items carries data', () => {
		expect(hasTrendData([{}, { trend: 'down' }, {}])).toBe(true);
	});
});
