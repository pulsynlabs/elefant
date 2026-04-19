// Pure-function tests for agent-config client-side validation.
//
// These mirror the daemon's Zod schema bounds so bad input is rejected
// at the UI boundary, not round-tripped to the daemon. Keeping the tests
// here (not in the Svelte components) avoids needing a component-test
// runner — `bun test` picks this up automatically.

import { describe, expect, it } from 'bun:test';
import {
	validateLimits,
	validateGeneration,
	validateToolPolicy,
	isValidToolName,
	parseToolList,
	hasErrors,
	LIMITS_BOUNDS,
	BEHAVIOR_BOUNDS,
} from './validation.js';

describe('validateLimits', () => {
	const validLimits = { maxIterations: 50, timeoutMs: 60_000, maxConcurrency: 3 };

	it('accepts a fully valid limits block', () => {
		expect(validateLimits(validLimits)).toEqual({});
	});

	it('rejects maxIterations below the minimum', () => {
		const errors = validateLimits({ ...validLimits, maxIterations: 0 });
		expect(errors.maxIterations).toContain(String(LIMITS_BOUNDS.maxIterations.min));
	});

	it('rejects maxIterations above the maximum', () => {
		const errors = validateLimits({ ...validLimits, maxIterations: 10_000 });
		expect(errors.maxIterations).toBeDefined();
	});

	it('rejects non-integer maxIterations', () => {
		const errors = validateLimits({ ...validLimits, maxIterations: 2.5 });
		expect(errors.maxIterations).toBeDefined();
	});

	it('rejects timeoutMs below 1000', () => {
		const errors = validateLimits({ ...validLimits, timeoutMs: 500 });
		expect(errors.timeoutMs).toBeDefined();
	});

	it('rejects timeoutMs above 600000', () => {
		const errors = validateLimits({ ...validLimits, timeoutMs: 600_001 });
		expect(errors.timeoutMs).toBeDefined();
	});

	it('rejects maxConcurrency outside 1–10', () => {
		expect(validateLimits({ ...validLimits, maxConcurrency: 0 }).maxConcurrency).toBeDefined();
		expect(validateLimits({ ...validLimits, maxConcurrency: 11 }).maxConcurrency).toBeDefined();
	});
});

describe('validateGeneration', () => {
	it('accepts an empty behavior object (all fields optional)', () => {
		expect(validateGeneration({})).toEqual({});
	});

	it('accepts valid temperature, topP, maxTokens', () => {
		const errors = validateGeneration({
			temperature: 0.7,
			topP: 0.9,
			maxTokens: 4096,
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

	it('rejects non-integer maxTokens', () => {
		expect(validateGeneration({ maxTokens: 10.5 }).maxTokens).toBeDefined();
	});

	it('rejects zero or negative maxTokens', () => {
		expect(validateGeneration({ maxTokens: 0 }).maxTokens).toBeDefined();
		expect(validateGeneration({ maxTokens: -5 }).maxTokens).toBeDefined();
	});

	it('upper bound on maxTokens is surfaced', () => {
		const over = BEHAVIOR_BOUNDS.maxTokens.max + 1;
		expect(validateGeneration({ maxTokens: over }).maxTokens).toBeDefined();
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
	it('accepts each valid tool mode', () => {
		expect(validateToolPolicy({ mode: 'auto' })).toEqual({});
		expect(validateToolPolicy({ mode: 'manual' })).toEqual({});
		expect(validateToolPolicy({ mode: 'deny_all' })).toEqual({});
	});

	it('rejects an unknown tool mode', () => {
		const errors = validateToolPolicy({
			mode: 'anarchy' as unknown as 'auto',
		});
		expect(errors.mode).toBeDefined();
	});

	it('accepts clean allow / deny lists', () => {
		const errors = validateToolPolicy({
			mode: 'auto',
			allowedTools: ['read_file', 'bash'],
			deniedTools: ['delete_file'],
		});
		expect(errors).toEqual({});
	});

	it('rejects invalid entries in allow list', () => {
		const errors = validateToolPolicy({
			mode: 'auto',
			allowedTools: ['read_file', '1invalid'],
		});
		expect(errors.allowedTools).toBeDefined();
	});

	it('rejects invalid entries in deny list', () => {
		const errors = validateToolPolicy({
			mode: 'auto',
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
		expect(hasErrors({ maxIterations: 'bad' })).toBe(true);
	});
});
