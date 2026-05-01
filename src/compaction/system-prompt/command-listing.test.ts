import { describe, expect, it } from 'bun:test';

import {
	buildCommandsSection,
	DEFAULT_COMMANDS,
	type CommandEntry,
} from './command-listing.ts';

/** New trigger names from the Wave 1 rename (no /spec- prefix). */
const EXPECTED_TRIGGERS = [
	'/discuss',
	'/plan',
	'/execute',
	'/audit',
	'/accept',
	'/status',
	'/amend',
	'/help',
	'/pause',
	'/resume',
	'/quick',
	'/research',
	'/debug',
	'/map-codebase',
	'/pr-review',
] as const;

describe('command-listing', () => {
	describe('DEFAULT_COMMANDS', () => {
		it('contains all 15 commands', () => {
			expect(DEFAULT_COMMANDS).toHaveLength(15);
		});

		it('every entry has a trigger and description', () => {
			for (const cmd of DEFAULT_COMMANDS) {
				expect(cmd.trigger).toBeTruthy();
				expect(typeof cmd.trigger).toBe('string');
				expect(cmd.trigger).toStartWith('/');
				expect(cmd.description).toBeTruthy();
				expect(typeof cmd.description).toBe('string');
			}
		});

		it('all triggers use the new post-rename names (no /spec- prefix)', () => {
			const triggers = DEFAULT_COMMANDS.map((c) => c.trigger).sort();
			expect(triggers).toEqual([...EXPECTED_TRIGGERS].sort());
		});

		it('no trigger contains the old /spec- prefix', () => {
			const legacyNames = DEFAULT_COMMANDS.filter((c) =>
				c.trigger.startsWith('/spec-'),
			);
			expect(legacyNames).toEqual([]);
		});
	});

	describe('buildCommandsSection', () => {
		const sampleCommands: CommandEntry[] = [
			{ trigger: '/discuss', description: 'Start discovery interview' },
			{ trigger: '/plan', description: 'Create specification' },
			{ trigger: '/status', description: 'Show workflow status' },
		];

		it('returns a header and empty-state message for an empty list', () => {
			const output = buildCommandsSection([]);
			expect(output).toContain('## Slash Commands');
			expect(output).toContain('No slash commands are currently registered.');
		});

		it('formats commands as a flat bullet list when phase metadata is absent', () => {
			const output = buildCommandsSection(sampleCommands);
			expect(output).toContain('## Slash Commands');
			expect(output).toContain('- /discuss — Start discovery interview');
			expect(output).toContain('- /plan — Create specification');
			expect(output).toContain('- /status — Show workflow status');
			// No sub-headings when all phases are undefined
			expect(output).not.toContain('###');
		});

		it('groups commands by phase when every command has phase metadata', () => {
			const commands: CommandEntry[] = [
				{
					trigger: '/discuss',
					description: 'Start discovery',
					phase: 'discover',
				},
				{
					trigger: '/plan',
					description: 'Create blueprint',
					phase: 'plan',
				},
				{
					trigger: '/execute',
					description: 'Begin implementation',
					phase: 'execute',
				},
				{
					trigger: '/status',
					description: 'Show status',
					phase: 'utility',
				},
			];

			const output = buildCommandsSection(commands);
			expect(output).toContain('### Discovery');
			expect(output).toContain('### Planning');
			expect(output).toContain('### Execution');
			expect(output).toContain('### Utilities');
		});

		it('falls back to flat list when some commands lack phase', () => {
			const commands: CommandEntry[] = [
				{ trigger: '/a', description: 'A', phase: 'plan' },
				{ trigger: '/b', description: 'B' }, // no phase
			];
			const output = buildCommandsSection(commands);
			// Should be flat — no sub-headings
			expect(output).not.toContain('###');
		});

		it('renders the full DEFAULT_COMMANDS set', () => {
			const output = buildCommandsSection(DEFAULT_COMMANDS);
			// Since all share category "spec-mode", they group under "### Workflow Commands"
			expect(output).toContain('## Slash Commands');
			expect(output).toContain('### Workflow Commands');
			expect(output).toContain('- /discuss —');
			expect(output).toContain('- /pr-review —');
		});

		it('every default trigger appears exactly once in the output', () => {
			const output = buildCommandsSection(DEFAULT_COMMANDS);
			for (const trigger of EXPECTED_TRIGGERS) {
				const occurrences = output.split(trigger).length - 1;
				expect(occurrences).toBe(1);
			}
		});
	});
});
