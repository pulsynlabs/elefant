import { describe, it, expect } from 'bun:test';
import { parseVizEnvelope, isVizToolCall } from './parse-envelope.js';

const validEnvelope = {
	id: 'abc-123',
	type: 'loading',
	intent: 'Show loading progress',
	title: 'Researching…',
	data: { msg: 'Searching across 12 sources…' },
};

describe('parseVizEnvelope', () => {
	it('parses a valid envelope', () => {
		const result = parseVizEnvelope(JSON.stringify(validEnvelope));
		expect(result).not.toBeNull();
		expect(result!.id).toBe('abc-123');
		expect(result!.type).toBe('loading');
		expect(result!.intent).toBe('Show loading progress');
		expect(result!.title).toBe('Researching…');
		expect(result!.data).toEqual({ msg: 'Searching across 12 sources…' });
	});

	it('returns null for null input', () => {
		expect(parseVizEnvelope(null)).toBeNull();
	});

	it('returns null for undefined input', () => {
		expect(parseVizEnvelope(undefined)).toBeNull();
	});

	it('returns null for empty string', () => {
		expect(parseVizEnvelope('')).toBeNull();
	});

	it('returns null for whitespace-only string', () => {
		expect(parseVizEnvelope('   ')).toBeNull();
	});

	it('returns null for invalid JSON', () => {
		expect(parseVizEnvelope('not json')).toBeNull();
		expect(parseVizEnvelope('{')).toBeNull();
		expect(parseVizEnvelope('[1, 2')).toBeNull();
	});

	it('returns null for JSON that is not an object (array)', () => {
		expect(parseVizEnvelope('[]')).toBeNull();
		expect(parseVizEnvelope('[1,2,3]')).toBeNull();
	});

	it('returns null for JSON that is not an object (primitive)', () => {
		expect(parseVizEnvelope('"hello"')).toBeNull();
		expect(parseVizEnvelope('42')).toBeNull();
		expect(parseVizEnvelope('true')).toBeNull();
	});

	it('returns null when id is missing', () => {
		const { id: _, ...withoutId } = validEnvelope;
		expect(parseVizEnvelope(JSON.stringify(withoutId))).toBeNull();
	});

	it('returns null when type is missing', () => {
		const { type: _, ...withoutType } = validEnvelope;
		expect(parseVizEnvelope(JSON.stringify(withoutType))).toBeNull();
	});

	it('returns null when intent is missing', () => {
		const { intent: _, ...withoutIntent } = validEnvelope;
		expect(parseVizEnvelope(JSON.stringify(withoutIntent))).toBeNull();
	});

	it('returns null when data is missing', () => {
		const { data: _, ...withoutData } = validEnvelope;
		expect(parseVizEnvelope(JSON.stringify(withoutData))).toBeNull();
	});

	it('returns null when data is null', () => {
		const withNullData = { ...validEnvelope, data: null };
		expect(parseVizEnvelope(JSON.stringify(withNullData))).toBeNull();
	});

	it('returns null when data is a string', () => {
		const withStringData = { ...validEnvelope, data: 'not an object' };
		expect(parseVizEnvelope(JSON.stringify(withStringData))).toBeNull();
	});

	it('returns null when data is a number', () => {
		const withNumData = { ...validEnvelope, data: 42 };
		expect(parseVizEnvelope(JSON.stringify(withNumData))).toBeNull();
	});

	it('returns null when id is not a string', () => {
		const withNumId = { ...validEnvelope, id: 123 };
		expect(parseVizEnvelope(JSON.stringify(withNumId))).toBeNull();
	});

	it('returns null when title is present but optional fields are still valid', () => {
		// title is optional — its presence or absence should not affect parsing
		const withoutTitle = { ...validEnvelope };
		delete (withoutTitle as Partial<typeof withoutTitle>).title;
		const result = parseVizEnvelope(JSON.stringify(withoutTitle));
		expect(result).not.toBeNull();
		expect(result!.title).toBeUndefined();
	});

	it('returns null for badly-nested JSON with correct top-level shape but wrong types', () => {
		// e.g. data is an object but id is null
		const badIdEnv = { ...validEnvelope, id: null };
		expect(parseVizEnvelope(JSON.stringify(badIdEnv))).toBeNull();
	});

	it('accepts a minimal valid envelope (no optional fields)', () => {
		const minimal = { id: 'x', type: 'stat-grid', intent: 'Show stats', data: {} };
		const result = parseVizEnvelope(JSON.stringify(minimal));
		expect(result).not.toBeNull();
		expect(result!.id).toBe('x');
		expect(result!.data).toEqual({});
	});

	it('accepts envelope with extra unrecognised fields (forward-compat)', () => {
		const extras = { ...validEnvelope, futureField: 'should survive', meta: { foo: 1 } };
		const result = parseVizEnvelope(JSON.stringify(extras));
		expect(result).not.toBeNull();
	});
});

describe('isVizToolCall', () => {
	it('returns true for "visualize"', () => {
		expect(isVizToolCall('visualize')).toBe(true);
	});

	it('returns false for other tool names', () => {
		expect(isVizToolCall('bash')).toBe(false);
		expect(isVizToolCall('read')).toBe(false);
		expect(isVizToolCall('task')).toBe(false);
		expect(isVizToolCall('research_search')).toBe(false);
	});

	it('returns false for empty string', () => {
		expect(isVizToolCall('')).toBe(false);
	});

	it('is case-sensitive', () => {
		expect(isVizToolCall('Visualize')).toBe(false);
		expect(isVizToolCall('VISUALIZE')).toBe(false);
	});
});
