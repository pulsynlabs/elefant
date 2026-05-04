/**
 * lsp-diagnostic-parser.test.ts
 *
 * Unit tests for `parseLspDiagnostics` — the function that extracts structured
 * diagnostic entries from a write/edit tool result string so the diff card can
 * render lint markers in the DiffViewer (Wave 4 of LSP deep integration).
 *
 * The parser is intentionally tolerant: malformed input returns an empty list
 * rather than throwing, and only the **current-file** block is consumed —
 * "other files" diagnostics are ignored because they don't belong on the diff
 * for the file being edited.
 */
import { describe, expect, test } from 'bun:test';
import { parseLspDiagnostics } from './lsp-diagnostic-parser.js';

const CURRENT_FILE_HEADER = '\nLSP errors detected in this file, please fix:\n';
const OTHER_FILES_HEADER = '\nLSP errors detected in other files:\n';

describe('parseLspDiagnostics', () => {
	test('returns empty array for empty input', () => {
		expect(parseLspDiagnostics('')).toEqual([]);
	});

	test('returns empty array for content with no LSP section', () => {
		expect(parseLspDiagnostics('Wrote 100 bytes to /foo.ts')).toEqual([]);
	});

	test('parses a single error with code', () => {
		const content = `Wrote 100 bytes to /foo.ts${CURRENT_FILE_HEADER}/foo.ts:\n  5:10 - error: Type 'string' is not assignable to type 'number'. [2322]`;
		const result = parseLspDiagnostics(content);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			line: 5,
			column: 10,
			severity: 'error',
			message: "Type 'string' is not assignable to type 'number'.",
			code: '2322',
		});
	});

	test('parses multiple diagnostics on consecutive lines', () => {
		const content = `Wrote ok${CURRENT_FILE_HEADER}/foo.ts:\n  1:1 - error: First error\n  2:2 - warning: Second warning [W1]`;
		const result = parseLspDiagnostics(content);
		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({
			line: 1,
			column: 1,
			severity: 'error',
			message: 'First error',
		});
		expect(result[0]?.code).toBeUndefined();
		expect(result[1]).toMatchObject({
			line: 2,
			column: 2,
			severity: 'warning',
			message: 'Second warning',
			code: 'W1',
		});
	});

	test('normalizes "information" severity to "info"', () => {
		const content = `ok${CURRENT_FILE_HEADER}/foo.ts:\n  3:5 - information: Helpful note`;
		const result = parseLspDiagnostics(content);
		expect(result).toHaveLength(1);
		expect(result[0]?.severity).toBe('info');
		expect(result[0]?.message).toBe('Helpful note');
	});

	test('parses hint severity', () => {
		const content = `ok${CURRENT_FILE_HEADER}/foo.ts:\n  10:20 - hint: Consider using const`;
		const result = parseLspDiagnostics(content);
		expect(result).toHaveLength(1);
		expect(result[0]?.severity).toBe('hint');
	});

	test('omits code field when bracket suffix is absent', () => {
		const content = `ok${CURRENT_FILE_HEADER}/foo.ts:\n  1:1 - error: No code here`;
		const result = parseLspDiagnostics(content);
		expect(result).toHaveLength(1);
		expect(result[0]?.code).toBeUndefined();
	});

	test('ignores diagnostics in the "other files" block', () => {
		const content = [
			'Wrote ok',
			CURRENT_FILE_HEADER.trimStart(),
			'/foo.ts:',
			'  1:1 - error: Current file error',
			OTHER_FILES_HEADER.trimStart(),
			'/other.ts:',
			'  9:9 - error: Should be ignored [X]',
		].join('\n');
		const result = parseLspDiagnostics(content);
		expect(result).toHaveLength(1);
		expect(result[0]?.message).toBe('Current file error');
	});

	test('skips lines that do not match the diagnostic pattern', () => {
		const content = [
			`ok${CURRENT_FILE_HEADER}/foo.ts:`,
			'  not a diagnostic line',
			'',
			'  1:1 - error: Real error',
			'unrelated text',
		].join('\n');
		const result = parseLspDiagnostics(content);
		expect(result).toHaveLength(1);
		expect(result[0]?.line).toBe(1);
	});

	test('parses multi-digit line and column numbers', () => {
		const content = `ok${CURRENT_FILE_HEADER}/foo.ts:\n  1234:567 - error: Far down the file`;
		const result = parseLspDiagnostics(content);
		expect(result[0]).toMatchObject({ line: 1234, column: 567 });
	});

	test('returns empty when the marker exists but no diagnostic lines follow', () => {
		const content = `ok${CURRENT_FILE_HEADER}/foo.ts:`;
		expect(parseLspDiagnostics(content)).toEqual([]);
	});
});
