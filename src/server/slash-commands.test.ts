import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import {
	AUTO_PROGRESSION,
	executeAutoProgression,
	parseSlashCommand,
	loadCommandRegistry,
	suggestCommands,
	type SlashCommandDefinition,
	type ResolveSkillFn,
} from './slash-commands.ts';
import type { StateManager } from '../state/manager.ts';
import type { SkillInfo } from '../tools/skill/resolver.ts';

let tmpDir: string;

const TEST_REGISTRY: SlashCommandDefinition[] = [
	{
		name: 'plan',
		trigger: '/plan',
		description: 'Create SPEC + BLUEPRINT from REQUIREMENTS.',
		category: 'spec-mode',
	},
	{
		name: 'execute',
		trigger: '/execute',
		description: 'Begin wave-based implementation.',
		category: 'spec-mode',
	},
	{
		name: 'discuss',
		trigger: '/discuss',
		description: 'Start discovery interview.',
		category: 'spec-mode',
		args: '[session-name]',
	},
];

async function writeRegistry(dir: string, commands: SlashCommandDefinition[]): Promise<void> {
	const jsonPath = path.join(dir, 'COMMANDS_REGISTRY.json');
	await writeFile(jsonPath, JSON.stringify(commands, null, 2), 'utf-8');
}

async function writeCommandFile(dir: string, name: string, content: string): Promise<void> {
	const filePath = path.join(dir, `${name}.md`);
	await writeFile(filePath, content, 'utf-8');
}

beforeEach(async () => {
	tmpDir = path.join(tmpdir(), `elefant-slash-test-${randomUUID()}`);
	await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

describe('loadCommandRegistry', () => {
	it('loads from COMMANDS_REGISTRY.json', async () => {
		await writeRegistry(tmpDir, TEST_REGISTRY);
		const registry = await loadCommandRegistry(tmpDir);
		expect(registry).toHaveLength(3);
		expect(registry[0].name).toBe('plan');
	});

	it('falls back to scanning *.md files when JSON is missing', async () => {
		await writeCommandFile(tmpDir, 'status', '# /status\n\nStatus check');
		await writeCommandFile(tmpDir, 'help', '# /help\n\nHelp listing');

		const registry = await loadCommandRegistry(tmpDir);
		expect(registry.length).toBeGreaterThanOrEqual(2);

		const triggers = registry.map((r) => r.trigger);
		expect(triggers).toContain('/status');
		expect(triggers).toContain('/help');
	});

	it('returns empty array for empty directory with no JSON', async () => {
		const registry = await loadCommandRegistry(tmpDir);
		expect(registry).toEqual([]);
	});

	it('returns empty array for empty JSON registry', async () => {
		await writeRegistry(tmpDir, []);
		const registry = await loadCommandRegistry(tmpDir);
		expect(registry).toEqual([]);
	});
});

describe('parseSlashCommand', () => {
	const p5jsSkillContent = `---
description: Creative coding with p5.js
---

# p5js Skill

Use p5.js for generative art.`;

	const resolveFixtureSkill: ResolveSkillFn = async (name) => {
		if (name === 'p5js') {
			return {
				path: path.join(tmpDir, '.elefant', 'skills', 'p5js', 'SKILL.md'),
				content: p5jsSkillContent,
			};
		}

		if (name === 'plan') {
			return {
				path: path.join(tmpDir, '.elefant', 'skills', 'plan', 'SKILL.md'),
				content: '# Plan Skill\n\nThis skill must not override the workflow command.',
			};
		}

		return null;
	};

	beforeEach(async () => {
		await writeRegistry(tmpDir, TEST_REGISTRY);
		await writeCommandFile(
			tmpDir,
			'plan',
			'# /plan\n\n**Description:** Plan workflow.\n\n## Process\n\n1. Read REQUIREMENTS\n2. Dispatch planner',
		);
		await writeCommandFile(
			tmpDir,
			'discuss',
			'# /discuss\n\n**Description:** Discovery interview.\n\n## Process\n\n1. Ask discovery questions',
		);
	});

	it('matches /plan command and loads content', async () => {
		const match = await parseSlashCommand('/plan', tmpDir);
		expect(match).not.toBeNull();
		expect(match!.command.name).toBe('plan');
		expect(match!.command.trigger).toBe('/plan');
		expect(match!.args).toBe('');
		expect(match!.promptContent).toContain('# /plan');
		expect(match!.promptContent).toContain('Read REQUIREMENTS');
	});

	it('extracts args from /plan with session name', async () => {
		const match = await parseSlashCommand('/plan some-session-name', tmpDir);
		expect(match).not.toBeNull();
		expect(match!.args).toBe('some-session-name');
	});

	it('returns null for unknown command or skill', async () => {
		const match = await parseSlashCommand('/nonexistent', tmpDir, {
			resolveSkillFn: resolveFixtureSkill,
		});
		expect(match).toBeNull();
	});

	it('returns null for non-slash message', async () => {
		const match = await parseSlashCommand('hello world', tmpDir);
		expect(match).toBeNull();
	});

	it('trims leading whitespace before matching', async () => {
		const match = await parseSlashCommand('  /plan my-args', tmpDir);
		expect(match).not.toBeNull();
		expect(match!.command.name).toBe('plan');
		expect(match!.args).toBe('my-args');
	});

	it('loads command content from file', async () => {
		const match = await parseSlashCommand('/discuss', tmpDir);
		expect(match).not.toBeNull();
		expect(match!.promptContent).toContain('# /discuss');
		expect(match!.promptContent).toContain('Discovery interview');
	});

	it('falls back to a skill when no workflow command matches', async () => {
		const match = await parseSlashCommand('/p5js', tmpDir, {
			resolveSkillFn: resolveFixtureSkill,
		});

		expect(match).not.toBeNull();
		expect(match!.command.name).toBe('p5js');
		expect(match!.command.trigger).toBe('/p5js');
		expect(match!.command.description).toBe('Creative coding with p5.js');
		expect(match!.command.category).toBe('skill');
		expect(match!.args).toBe('');
		expect(match!.promptContent).toContain('# p5js Skill');
		expect(match!.promptContent).toContain('Use p5.js for generative art.');
	});

	it('keeps workflow commands ahead of skills with the same name', async () => {
		const match = await parseSlashCommand('/plan', tmpDir, {
			resolveSkillFn: resolveFixtureSkill,
		});

		expect(match).not.toBeNull();
		expect(match!.command.name).toBe('plan');
		expect(match!.command.category).toBe('spec-mode');
		expect(match!.promptContent).toContain('# /plan');
		expect(match!.promptContent).not.toContain('Plan Skill');
	});

	it('captures args for /discuss workflow command', async () => {
		const match = await parseSlashCommand('/discuss session-name', tmpDir, {
			resolveSkillFn: resolveFixtureSkill,
		});

		expect(match).not.toBeNull();
		expect(match!.command.name).toBe('discuss');
		expect(match!.command.category).toBe('spec-mode');
		expect(match!.args).toBe('session-name');
	});

	it('returns null when MD file is missing', async () => {
		await writeRegistry(tmpDir, [
			{
				name: 'missing',
				trigger: '/missing',
				description: 'Missing file',
				category: 'spec-mode',
			},
		]);

		const match = await parseSlashCommand('/missing', tmpDir);
		expect(match).toBeNull();
	});

	it('returns null when trigger has args but command file is missing', async () => {
		const match = await parseSlashCommand('/spec-nofile some args', tmpDir);
		expect(match).toBeNull();
	});

	it('handles multi-line message with slash on first line', async () => {
		const match = await parseSlashCommand('/plan\nmore text here', tmpDir);
		expect(match).not.toBeNull();
		expect(match!.command.name).toBe('plan');
		expect(match!.args).toBe('');
	});

	it('does NOT match slash on second line', async () => {
		const match = await parseSlashCommand('some text\n/plan', tmpDir);
		expect(match).toBeNull();
	});

	it('handles args with multiple spaces', async () => {
		const match = await parseSlashCommand('/discuss    my session   name', tmpDir);
		expect(match).not.toBeNull();
		expect(match!.args).toBe('my session   name');
	});

	it('returns null for empty string', async () => {
		const match = await parseSlashCommand('', tmpDir);
		expect(match).toBeNull();
	});

	it('returns null for whitespace-only message', async () => {
		const match = await parseSlashCommand('   ', tmpDir);
		expect(match).toBeNull();
	});

	it('returns null when registry is empty', async () => {
		await writeRegistry(tmpDir, []);
		const match = await parseSlashCommand('/plan', tmpDir);
		expect(match).toBeNull();
	});
});

describe('suggestCommands', () => {
	const registry: SlashCommandDefinition[] = [
		{ name: 'plan', trigger: '/plan', description: 'Plan', category: 'spec-mode' },
		{ name: 'pause', trigger: '/pause', description: 'Pause', category: 'spec-mode' },
		{ name: 'execute', trigger: '/execute', description: 'Execute', category: 'spec-mode' },
		{ name: 'debug', trigger: '/debug', description: 'Debug', category: 'utility' },
	];
	const fixtureSkills: SkillInfo[] = [
		{
			name: 'p5js',
			description: 'Creative coding with p5.js',
			source: 'project',
			path: '/tmp/p5js/SKILL.md',
		},
	];

	it('returns matching suggestions for partial input', async () => {
		const suggestions = await suggestCommands('/p', registry, 3, {
			listSkillsFn: async () => [],
		});
		expect(suggestions).toContain('/plan');
		expect(suggestions).toContain('/pause');
	});

	it('returns empty array for no matches', async () => {
		const suggestions = await suggestCommands('/foo', registry, 3, {
			listSkillsFn: async () => [],
		});
		expect(suggestions).toEqual([]);
	});

	it('respects limit', async () => {
		const suggestions = await suggestCommands('/', registry, 1, {
			listSkillsFn: async () => [],
		});
		expect(suggestions).toHaveLength(1);
	});

	it('includes skills in fuzzy suggestions', async () => {
		const suggestions = await suggestCommands('/p5j', registry, 3, {
			listSkillsFn: async () => fixtureSkills,
		});

		expect(suggestions).toContain('/p5js');
	});
});

describe('executeAutoProgression', () => {
	function makeStateManager(workflow: { autopilot: boolean } | null): StateManager {
		// We only exercise getSpecWorkflow on the manager.
		return {
			getSpecWorkflow: async () => workflow,
		} as unknown as StateManager;
	}

	beforeEach(async () => {
		await writeRegistry(tmpDir, [
			{ name: 'plan', trigger: '/plan', description: 'Plan', category: 'spec-mode' },
		]);
		await writeCommandFile(tmpDir, 'plan', '# /plan\n\nbody');
	});

	it('returns the next command when autopilot is true', async () => {
		const state = makeStateManager({ autopilot: true });
		const match = await executeAutoProgression('/discuss', state, 'wf', 'proj', tmpDir);
		expect(match).not.toBeNull();
		expect(match!.command.trigger).toBe('/plan');
	});

	it('returns null when autopilot is false', async () => {
		const state = makeStateManager({ autopilot: false });
		const match = await executeAutoProgression('/discuss', state, 'wf', 'proj', tmpDir);
		expect(match).toBeNull();
	});

	it('returns null for /accept (no successor)', async () => {
		const state = makeStateManager({ autopilot: true });
		const match = await executeAutoProgression('/accept', state, 'wf', 'proj', tmpDir);
		expect(match).toBeNull();
	});

	it('returns null when workflow is missing', async () => {
		const state = makeStateManager(null);
		const match = await executeAutoProgression('/discuss', state, 'wf', 'proj', tmpDir);
		expect(match).toBeNull();
	});

	it('AUTO_PROGRESSION covers every non-accept phase command', () => {
		expect(AUTO_PROGRESSION['/discuss']).toBe('/plan');
		expect(AUTO_PROGRESSION['/plan']).toBe('/execute');
		expect(AUTO_PROGRESSION['/execute']).toBe('/audit');
		expect(AUTO_PROGRESSION['/audit']).toBe('/accept');
		expect(AUTO_PROGRESSION['/accept']).toBeUndefined();
	});
});
