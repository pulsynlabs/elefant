// Pure-function tests for agent-config client-side validation.
//
// These mirror the daemon's Zod schema bounds so bad input is rejected
// at the UI boundary, not round-tripped to the daemon. Keeping the tests
// here (not in the Svelte components) avoids needing a component-test
// runner — `bun test` picks this up automatically.

import { describe, expect, it } from 'bun:test';
import {
	validateGeneration,
	validateToolPolicy,
	isValidToolName,
	parseToolList,
	hasErrors,
} from './validation.js';

describe('validateGeneration', () => {
	it('accepts an empty behavior object (all fields optional)', () => {
		expect(validateGeneration({})).toEqual({});
	});

	it('accepts valid temperature and topP', () => {
		const errors = validateGeneration({
			temperature: 0.7,
			topP: 0.9,
		});
		expect(errors).toEqual({});
	});

	it('rejects temperature outside 0–2', () => {
		expect(validateGeneration({ temperature: -0.1 }).temperature).toBeDefined();
		expect(validateGeneration({ temperature: 2.01 }).temperature).toBeDefined();
	});

	it('rejects topP outside 0–1', () => {
		expect(validateGeneration({ topP: -0.1 }).topP).toBeDefined();
		expect(validateGeneration({ topP: 1.1 }).topP).toBeDefined();
	});
});

describe('isValidToolName', () => {
	it('accepts simple identifiers', () => {
		expect(isValidToolName('read_file')).toBe(true);
		expect(isValidToolName('bash')).toBe(true);
		expect(isValidToolName('grep-v2')).toBe(true);
		expect(isValidToolName('my.tool.name')).toBe(true);
	});

	it('rejects names that do not start with a letter', () => {
		expect(isValidToolName('1tool')).toBe(false);
		expect(isValidToolName('_private')).toBe(false);
	});

	it('rejects whitespace and special characters', () => {
		expect(isValidToolName('foo bar')).toBe(false);
		expect(isValidToolName('foo/bar')).toBe(false);
		expect(isValidToolName('foo!')).toBe(false);
	});

	it('rejects empty strings', () => {
		expect(isValidToolName('')).toBe(false);
	});
});

describe('parseToolList', () => {
	it('splits on commas and whitespace', () => {
		const { tools, invalid } = parseToolList('read_file, bash\ngrep');
		expect(tools).toEqual(['read_file', 'bash', 'grep']);
		expect(invalid).toEqual([]);
	});

	it('deduplicates entries', () => {
		const { tools } = parseToolList('bash,bash,bash');
		expect(tools).toEqual(['bash']);
	});

	it('separates invalid names from the result', () => {
		// Tokens are split on whitespace + commas; invalid identifier shapes
		// (leading digit, slashes, etc.) land in `invalid`, everything else
		// in `tools`.
		const { tools, invalid } = parseToolList('read_file, 1bad, bash, foo/bar');
		expect(tools).toEqual(['read_file', 'bash']);
		expect(invalid).toEqual(['1bad', 'foo/bar']);
	});

	it('ignores empty tokens', () => {
		const { tools } = parseToolList(' , ,, ');
		expect(tools).toEqual([]);
	});
});

describe('validateToolPolicy', () => {
	it('accepts an empty policy', () => {
		expect(validateToolPolicy({})).toEqual({});
	});

	it('accepts clean allow / deny lists', () => {
		const errors = validateToolPolicy({
			allowedTools: ['read_file', 'bash'],
			deniedTools: ['delete_file'],
		});
		expect(errors).toEqual({});
	});

	it('rejects invalid entries in allow list', () => {
		const errors = validateToolPolicy({
			allowedTools: ['read_file', '1invalid'],
		});
		expect(errors.allowedTools).toBeDefined();
	});

	it('rejects invalid entries in deny list', () => {
		const errors = validateToolPolicy({
			deniedTools: ['read_file', 'bad name'],
		});
		expect(errors.deniedTools).toBeDefined();
	});
});

describe('hasErrors', () => {
	it('returns false for empty errors', () => {
		expect(hasErrors({})).toBe(false);
	});

	it('returns true when any key is present', () => {
		expect(hasErrors({ temperature: 'bad' })).toBe(true);
	});
});
