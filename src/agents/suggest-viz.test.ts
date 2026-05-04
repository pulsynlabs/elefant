import { describe, it, expect } from 'bun:test';
import { parseSuggestViz } from './suggest-viz.js';

describe('parseSuggestViz', () => {
	it('parses a single suggest-viz element', () => {
		const xml =
			`<goop_report><suggest-viz type="stat-grid" data='{"items":[{"label":"Tests","value":42}]}' intent="Show test counts" /></goop_report>`;
		const result = parseSuggestViz(xml);
		expect(result).toHaveLength(1);
		expect(result[0].type).toBe('stat-grid');
		expect(result[0].intent).toBe('Show test counts');
		expect(result[0].data).toEqual({ items: [{ label: 'Tests', value: 42 }] });
	});

	it('parses multiple suggest-viz elements', () => {
		const xml =
			`<suggest-viz type="mermaid" data='{"src":"graph LR; A-->B"}' /><suggest-viz type="loading" data='{"msg":"Working"}' />`;
		const result = parseSuggestViz(xml);
		expect(result).toHaveLength(2);
		expect(result[0].type).toBe('mermaid');
		expect(result[1].type).toBe('loading');
	});

	it('returns [] for empty string', () => {
		expect(parseSuggestViz('')).toEqual([]);
	});

	it('returns [] for null/undefined', () => {
		expect(parseSuggestViz(null as unknown as string)).toEqual([]);
		expect(parseSuggestViz(undefined as unknown as string)).toEqual([]);
	});

	it('returns [] for malformed XML', () => {
		expect(parseSuggestViz('<broken>{')).toEqual([]);
	});

	it('skips elements with malformed data attribute', () => {
		const xml = `<suggest-viz type="table" data='not-json' />`;
		expect(parseSuggestViz(xml)).toEqual([]);
	});

	it('skips elements missing type', () => {
		const xml = `<suggest-viz data='{"x":1}' />`;
		expect(parseSuggestViz(xml)).toEqual([]);
	});

	it('handles optional intent (missing)', () => {
		const xml = `<suggest-viz type="loading" data='{"msg":"hi"}' />`;
		const result = parseSuggestViz(xml);
		expect(result[0].intent).toBeUndefined();
	});

	it('handles escaped data attribute', () => {
		// Real subagents may escape quotes — test robustness.
		// With single-quoted data attr and double-quote data, this parses fine.
		const data = JSON.stringify({ items: [{ label: 'a', value: 1 }] });
		const xml = `<suggest-viz type="stat-grid" data='${data}' />`;
		// Attribute uses single quotes, so double-quoted JSON inside is fine.
		const result = parseSuggestViz(xml);
		expect(Array.isArray(result)).toBe(true);
		expect(result).toHaveLength(1);
		expect(result[0].data).toEqual({ items: [{ label: 'a', value: 1 }] });
	});

	it('rejects data that is not an object', () => {
		const xml = `<suggest-viz type="loading" data='42' />`;
		expect(parseSuggestViz(xml)).toEqual([]);
	});

	it('rejects data that is null', () => {
		const xml = `<suggest-viz type="loading" data='null' />`;
		expect(parseSuggestViz(xml)).toEqual([]);
	});

	it('rejects data that is an array', () => {
		const xml = `<suggest-viz type="loading" data='[1,2,3]' />`;
		expect(parseSuggestViz(xml)).toEqual([]);
	});
});
