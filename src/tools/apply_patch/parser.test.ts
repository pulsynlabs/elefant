import { describe, expect, it } from 'bun:test';

import { PatchParseError, parsePatchText } from './parser.js';

describe('parsePatchText', () => {
	it('parses add operation with content', () => {
		const patchText = ['*** Add File: src/new.ts', '+export const value = 1;', '+'].join('\n');

		const operations = parsePatchText(patchText);
		expect(operations).toHaveLength(1);
		expect(operations[0]).toEqual({
			type: 'add',
			path: 'src/new.ts',
			content: 'export const value = 1;\n',
		});
	});

	it('parses update operation with hunk and move marker', () => {
		const patchText = [
			'*** Update File: src/old.ts',
			'*** Move to: src/new.ts',
			'@@',
			'-const OLD = true;',
			'+const NEW = false;',
		].join('\n');

		const operations = parsePatchText(patchText);
		expect(operations).toHaveLength(1);
		expect(operations[0]).toEqual({
			type: 'update',
			path: 'src/old.ts',
			moveTo: 'src/new.ts',
			hunks: [
				{
					lines: [
						{ type: 'remove', text: 'const OLD = true;' },
						{ type: 'add', text: 'const NEW = false;' },
					],
				},
			],
		});
	});

	it('parses delete operation with move marker', () => {
		const patchText = ['*** Delete File: src/old.ts', '*** Move to: src/new.ts'].join('\n');

		const operations = parsePatchText(patchText);
		expect(operations).toHaveLength(1);
		expect(operations[0]).toEqual({
			type: 'delete',
			path: 'src/old.ts',
			moveTo: 'src/new.ts',
		});
	});

	it('throws parse error for malformed patch', () => {
		expect(() => parsePatchText('@@\n-no marker')).toThrow(PatchParseError);
	});
});
