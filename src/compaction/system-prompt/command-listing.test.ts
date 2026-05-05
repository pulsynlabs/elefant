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
	'/fieldnotes',
	'/debug',
	'/map-codebase',
	'/pr-review',
	'/init',
] as const;

describe('command-listing', () => {
	describe('DEFAULT_COMMANDS', () => {
		it('contains all 16 commands', () => {
			expect(DEFAULT_COMMANDS).toHaveLength(16);
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

		it('omits skill section when no skill commands are provided', () => {
			const output = buildCommandsSection(DEFAULT_COMMANDS);
			expect(output).not.toContain('### Skill Commands');
		});

		it('omits skill section when skills array is empty', () => {
			const output = buildCommandsSection(DEFAULT_COMMANDS, []);
			expect(output).not.toContain('### Skill Commands');
		});

		it('omits everything when both workflow and skill commands are empty', () => {
			const output = buildCommandsSection([], []);
			expect(output).toContain('No slash commands are currently registered.');
			expect(output).not.toContain('###');
		});

		it('renders skill commands group after workflow groups', () => {
			const skillCmds: CommandEntry[] = [
				{ trigger: '/p5js', description: 'Interactive art pipeline', phase: 'skill' },
				{ trigger: '/comfyui', description: 'Image generation with ComfyUI', phase: 'skill' },
			];
			const output = buildCommandsSection(DEFAULT_COMMANDS, skillCmds);

			expect(output).toContain('### Workflow Commands');
			expect(output).toContain('### Skill Commands');
			expect(output).toContain('- /p5js — Interactive art pipeline');
			expect(output).toContain('- /comfyui — Image generation with ComfyUI');

			// Skill section must appear after workflow section
			const workflowIdx = output.indexOf('### Workflow Commands');
			const skillIdx = output.indexOf('### Skill Commands');
			expect(skillIdx).toBeGreaterThan(workflowIdx);
		});

		it('renders only skill commands when no workflow commands exist', () => {
			const skillCmds: CommandEntry[] = [
				{ trigger: '/p5js', description: 'Interactive art', phase: 'skill' },
			];
			const output = buildCommandsSection([], skillCmds);

			expect(output).toContain('## Slash Commands');
			expect(output).toContain('### Skill Commands');
			expect(output).toContain('- /p5js — Interactive art');
			expect(output).not.toContain('No slash commands are currently registered.');
		});

		it('caps skill commands at 50 entries with overflow note', () => {
			const skillCmds: CommandEntry[] = Array.from({ length: 60 }, (_, i) => ({
				trigger: `/skill-${i}`,
				description: `Description for skill ${i}`,
				phase: 'skill',
			}));

			const output = buildCommandsSection([], skillCmds);

			// Should show first 50
			expect(output).toContain('/skill-0');
			expect(output).toContain('/skill-49');
			// 50th entry (index 49) shown; 51st (index 50) NOT shown
			expect(output).not.toContain('/skill-50');
			// Overflow note present
			expect(output).toContain('[10 more skills]');
		});

		it('does not show overflow note when exactly 50 skill commands', () => {
			const skillCmds: CommandEntry[] = Array.from({ length: 50 }, (_, i) => ({
				trigger: `/skill-${i}`,
				description: `Description for skill ${i}`,
				phase: 'skill',
			}));

			const output = buildCommandsSection([], skillCmds);

			expect(output).toContain('/skill-0');
			expect(output).toContain('/skill-49');
			expect(output).not.toContain('more skills');
		});
	});
});
