// Unit tests for the table viz pure helpers.
//
// These cover the cell-coercion edges TableViz depends on:
//   - primitive coercion (string, number, boolean)
//   - nullish handling (null, undefined → empty string)
//   - object/array fallback to JSON
//   - circular-reference fallback never throws
//   - missing column keys read as empty string

import { describe, expect, it } from 'bun:test';
import { safeStringify, getCellValue } from './table-state.js';

describe('safeStringify', () => {
	it('returns empty string for null and undefined', () => {
		expect(safeStringify(null)).toBe('');
		expect(safeStringify(undefined)).toBe('');
	});

	it('returns the same string for string values', () => {
		expect(safeStringify('hello')).toBe('hello');
		expect(safeStringify('')).toBe('');
	});

	it('coerces numbers and booleans to their string form', () => {
		expect(safeStringify(0)).toBe('0');
		expect(safeStringify(42)).toBe('42');
		expect(safeStringify(-1.5)).toBe('-1.5');
		expect(safeStringify(true)).toBe('true');
		expect(safeStringify(false)).toBe('false');
	});

	it('JSON-stringifies plain objects and arrays', () => {
		expect(safeStringify({ a: 1 })).toBe('{"a":1}');
		expect(safeStringify([1, 'x', true])).toBe('[1,"x",true]');
	});

	it('does not throw on circular structures', () => {
		const obj: Record<string, unknown> = { a: 1 };
		obj.self = obj;
		// Should fall back rather than throw.
		expect(() => safeStringify(obj)).not.toThrow();
		expect(typeof safeStringify(obj)).toBe('string');
	});
});

describe('getCellValue', () => {
	it('returns the stringified value for a present key', () => {
		expect(getCellValue({ name: 'Ada' }, 'name')).toBe('Ada');
		expect(getCellValue({ count: 7 }, 'count')).toBe('7');
	});

	it('returns empty string for missing keys', () => {
		expect(getCellValue({ name: 'Ada' }, 'age')).toBe('');
		expect(getCellValue({}, 'anything')).toBe('');
	});

	it('JSON-stringifies nested object cells', () => {
		expect(getCellValue({ meta: { x: 1 } }, 'meta')).toBe('{"x":1}');
	});

	it('treats explicit null/undefined cell values as empty', () => {
		expect(getCellValue({ a: null }, 'a')).toBe('');
		expect(getCellValue({ a: undefined }, 'a')).toBe('');
	});
});
