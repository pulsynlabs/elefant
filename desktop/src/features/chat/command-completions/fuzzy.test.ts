import { describe, it, expect } from 'bun:test';
import { rankCommands, normaliseQuery, type Command } from './fuzzy.js';

const COMMANDS: Command[] = [
	{ trigger: '/discuss', description: 'Start discovery interview.' },
	{ trigger: '/plan', description: 'Create SPEC + BLUEPRINT from REQUIREMENTS.' },
	{ trigger: '/execute', description: 'Begin wave-based implementation.' },
	{ trigger: '/audit', description: 'Dispatch verifier in fresh context.' },
	{ trigger: '/accept', description: 'Final acceptance gate.' },
	{ trigger: '/status', description: 'Show current workflow phase.' },
	{ trigger: '/amend', description: 'Propose a change to a locked spec.' },
	{ trigger: '/help', description: 'List all commands.' },
	{ trigger: '/pause', description: 'Save checkpoint and pause.' },
	{ trigger: '/resume', description: 'Resume from last checkpoint.' },
	{ trigger: '/quick', description: 'Fast-track a small task.' },
	{ trigger: '/research', description: 'Dispatch researcher agent.' },
	{ trigger: '/debug', description: 'Dispatch debugger.' },
	{ trigger: '/map-codebase', description: 'Dispatch explorer to map codebase.' },
	{ trigger: '/pr-review', description: 'Review a GitHub PR end-to-end.' },
];

describe('normaliseQuery', () => {
	it('strips a single leading slash', () => {
		expect(normaliseQuery('/dis')).toBe('dis');
	});

	it('lower-cases the query', () => {
		expect(normaliseQuery('/DIS')).toBe('dis');
	});

	it('trims surrounding whitespace', () => {
		expect(normaliseQuery('  /dis  ')).toBe('dis');
	});

	it('returns empty string for the bare slash', () => {
		expect(normaliseQuery('/')).toBe('');
	});

	it('handles a query with no leading slash', () => {
		expect(normaliseQuery('dis')).toBe('dis');
	});
});

describe('rankCommands', () => {
	it('returns all commands when the query is empty', () => {
		const ranked = rankCommands(COMMANDS, '');
		expect(ranked).toHaveLength(COMMANDS.length);
		for (const r of ranked) {
			expect(r.score).toBe(0);
			expect(r.matchIndices).toEqual([]);
		}
	});

	it('returns all commands for the bare leading slash', () => {
		const ranked = rankCommands(COMMANDS, '/');
		expect(ranked).toHaveLength(COMMANDS.length);
	});

	it('narrows to a single result for /dis', () => {
		const ranked = rankCommands(COMMANDS, '/dis');
		expect(ranked.length).toBeGreaterThan(0);
		expect(ranked[0]?.command.trigger).toBe('/discuss');
	});

	it('ranks exact match higher than prefix match', () => {
		const candidates: Command[] = [
			{ trigger: '/help', description: 'List all commands.' },
			{ trigger: '/helpfully', description: 'Helpfully describe something.' },
		];
		const ranked = rankCommands(candidates, '/help');
		expect(ranked[0]?.command.trigger).toBe('/help');
		expect(ranked[1]?.command.trigger).toBe('/helpfully');
	});

	it('ranks prefix match higher than subsequence match', () => {
		const candidates: Command[] = [
			{ trigger: '/research', description: 'foo' },
			{ trigger: '/refactor', description: 'foo' },
			{ trigger: '/run-each', description: 'foo' },
		];
		const ranked = rankCommands(candidates, 're');
		// Prefix matches come first.
		expect(ranked[0]?.command.trigger).toBe('/refactor');
		expect(ranked[1]?.command.trigger).toBe('/research');
		expect(ranked[2]?.command.trigger).toBe('/run-each');
	});

	it('matches subsequences in the trigger', () => {
		const ranked = rankCommands(COMMANDS, 'mc');
		const triggers = ranked.map((r) => r.command.trigger);
		expect(triggers).toContain('/map-codebase');
	});

	it('falls back to description match when trigger does not match', () => {
		const ranked = rankCommands(COMMANDS, 'gate');
		const triggers = ranked.map((r) => r.command.trigger);
		// "Final acceptance gate." matches but trigger '/accept' does not.
		expect(triggers).toContain('/accept');
	});

	it('excludes commands that match neither trigger nor description', () => {
		const ranked = rankCommands(COMMANDS, 'zzzqqq');
		expect(ranked).toHaveLength(0);
	});

	it('returns match indices that align with the trigger characters', () => {
		const ranked = rankCommands(COMMANDS, '/dis');
		const top = ranked[0];
		expect(top?.command.trigger).toBe('/discuss');
		// trigger = '/discuss' (8 chars), prefix 'dis' covers indices 1, 2, 3.
		expect(top?.matchIndices).toEqual([1, 2, 3]);
	});

	it('is case-insensitive', () => {
		const lower = rankCommands(COMMANDS, '/dis');
		const upper = rankCommands(COMMANDS, '/DIS');
		expect(upper[0]?.command.trigger).toBe(lower[0]?.command.trigger);
	});

	it('produces a stable order across repeated calls (no mutation of input)', () => {
		const before = COMMANDS.slice();
		const a = rankCommands(COMMANDS, '/p');
		const b = rankCommands(COMMANDS, '/p');
		expect(COMMANDS).toEqual(before);
		expect(a.map((r) => r.command.trigger)).toEqual(b.map((r) => r.command.trigger));
	});

	it('prefers shorter triggers as a tiebreaker', () => {
		const candidates: Command[] = [
			{ trigger: '/plan', description: 'short' },
			{ trigger: '/planet', description: 'longer prefix' },
			{ trigger: '/planning', description: 'longest prefix' },
		];
		const ranked = rankCommands(candidates, '/p');
		expect(ranked[0]?.command.trigger).toBe('/plan');
		expect(ranked[1]?.command.trigger).toBe('/planet');
		expect(ranked[2]?.command.trigger).toBe('/planning');
	});

	it('subsequence match indices are monotonically increasing', () => {
		const ranked = rankCommands(COMMANDS, 'mc');
		const top = ranked.find((r) => r.command.trigger === '/map-codebase');
		expect(top).toBeDefined();
		const idx = top!.matchIndices;
		for (let i = 1; i < idx.length; i++) {
			expect(idx[i]).toBeGreaterThan(idx[i - 1]!);
		}
	});
});
