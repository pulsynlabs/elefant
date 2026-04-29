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
} from './slash-commands.ts';
import type { StateManager } from '../state/manager.ts';

let tmpDir: string;

const TEST_REGISTRY: SlashCommandDefinition[] = [
	{
		name: 'spec-plan',
		trigger: '/spec-plan',
		description: 'Create SPEC + BLUEPRINT from REQUIREMENTS.',
		category: 'spec-mode',
	},
	{
		name: 'spec-execute',
		trigger: '/spec-execute',
		description: 'Begin wave-based implementation.',
		category: 'spec-mode',
	},
	{
		name: 'spec-discuss',
		trigger: '/spec-discuss',
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
		expect(registry[0].name).toBe('spec-plan');
	});

	it('falls back to scanning *.md files when JSON is missing', async () => {
		await writeCommandFile(tmpDir, 'spec-status', '# /spec-status\n\nStatus check');
		await writeCommandFile(tmpDir, 'spec-help', '# /spec-help\n\nHelp listing');

		const registry = await loadCommandRegistry(tmpDir);
		expect(registry.length).toBeGreaterThanOrEqual(2);

		const triggers = registry.map((r) => r.trigger);
		expect(triggers).toContain('/spec-status');
		expect(triggers).toContain('/spec-help');
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
	beforeEach(async () => {
		await writeRegistry(tmpDir, TEST_REGISTRY);
		await writeCommandFile(
			tmpDir,
			'spec-plan',
			'# /spec-plan\n\n**Description:** Plan workflow.\n\n## Process\n\n1. Read REQUIREMENTS\n2. Dispatch planner',
		);
		await writeCommandFile(
			tmpDir,
			'spec-discuss',
			'# /spec-discuss\n\n**Description:** Discovery interview.\n\n## Process\n\n1. Ask discovery questions',
		);
	});

	it('matches /spec-plan command and loads content', async () => {
		const match = await parseSlashCommand('/spec-plan', tmpDir);
		expect(match).not.toBeNull();
		expect(match!.command.name).toBe('spec-plan');
		expect(match!.command.trigger).toBe('/spec-plan');
		expect(match!.args).toBe('');
		expect(match!.promptContent).toContain('# /spec-plan');
		expect(match!.promptContent).toContain('Read REQUIREMENTS');
	});

	it('extracts args from /spec-plan with session name', async () => {
		const match = await parseSlashCommand('/spec-plan some-session-name', tmpDir);
		expect(match).not.toBeNull();
		expect(match!.args).toBe('some-session-name');
	});

	it('returns null for unknown command', async () => {
		const match = await parseSlashCommand('/unknown-command', tmpDir);
		expect(match).toBeNull();
	});

	it('returns null for non-slash message', async () => {
		const match = await parseSlashCommand('hello world', tmpDir);
		expect(match).toBeNull();
	});

	it('trims leading whitespace before matching', async () => {
		const match = await parseSlashCommand('  /spec-plan my-args', tmpDir);
		expect(match).not.toBeNull();
		expect(match!.command.name).toBe('spec-plan');
		expect(match!.args).toBe('my-args');
	});

	it('loads command content from file', async () => {
		const match = await parseSlashCommand('/spec-discuss', tmpDir);
		expect(match).not.toBeNull();
		expect(match!.promptContent).toContain('# /spec-discuss');
		expect(match!.promptContent).toContain('Discovery interview');
	});

	it('returns null when MD file is missing', async () => {
		await writeRegistry(tmpDir, [
			{
				name: 'spec-missing',
				trigger: '/spec-missing',
				description: 'Missing file',
				category: 'spec-mode',
			},
		]);

		const match = await parseSlashCommand('/spec-missing', tmpDir);
		expect(match).toBeNull();
	});

	it('returns null when trigger has args but command file is missing', async () => {
		const match = await parseSlashCommand('/spec-nofile some args', tmpDir);
		expect(match).toBeNull();
	});

	it('handles multi-line message with slash on first line', async () => {
		const match = await parseSlashCommand('/spec-plan\nmore text here', tmpDir);
		expect(match).not.toBeNull();
		expect(match!.command.name).toBe('spec-plan');
		expect(match!.args).toBe('');
	});

	it('does NOT match slash on second line', async () => {
		const match = await parseSlashCommand('some text\n/spec-plan', tmpDir);
		expect(match).toBeNull();
	});

	it('handles args with multiple spaces', async () => {
		const match = await parseSlashCommand('/spec-discuss    my session   name', tmpDir);
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
		const match = await parseSlashCommand('/spec-plan', tmpDir);
		expect(match).toBeNull();
	});
});

describe('suggestCommands', () => {
	const registry: SlashCommandDefinition[] = [
		{ name: 'spec-plan', trigger: '/spec-plan', description: 'Plan', category: 'spec-mode' },
		{ name: 'spec-pause', trigger: '/spec-pause', description: 'Pause', category: 'spec-mode' },
		{ name: 'spec-execute', trigger: '/spec-execute', description: 'Execute', category: 'spec-mode' },
		{ name: 'debug', trigger: '/debug', description: 'Debug', category: 'utility' },
	];

	it('returns matching suggestions for partial input', () => {
		const suggestions = suggestCommands('/spec-p', registry, 3);
		expect(suggestions).toContain('/spec-plan');
		expect(suggestions).toContain('/spec-pause');
	});

	it('returns empty array for no matches', () => {
		const suggestions = suggestCommands('/foo', registry, 3);
		expect(suggestions).toEqual([]);
	});

	it('respects limit', () => {
		const suggestions = suggestCommands('/spec', registry, 1);
		expect(suggestions).toHaveLength(1);
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
			{ name: 'spec-plan', trigger: '/spec-plan', description: 'Plan', category: 'spec-mode' },
		]);
		await writeCommandFile(tmpDir, 'spec-plan', '# /spec-plan\n\nbody');
	});

	it('returns the next command when autopilot is true', async () => {
		const state = makeStateManager({ autopilot: true });
		const match = await executeAutoProgression('/spec-discuss', state, 'wf', 'proj', tmpDir);
		expect(match).not.toBeNull();
		expect(match!.command.trigger).toBe('/spec-plan');
	});

	it('returns null when autopilot is false', async () => {
		const state = makeStateManager({ autopilot: false });
		const match = await executeAutoProgression('/spec-discuss', state, 'wf', 'proj', tmpDir);
		expect(match).toBeNull();
	});

	it('returns null for /spec-accept (no successor)', async () => {
		const state = makeStateManager({ autopilot: true });
		const match = await executeAutoProgression('/spec-accept', state, 'wf', 'proj', tmpDir);
		expect(match).toBeNull();
	});

	it('returns null when workflow is missing', async () => {
		const state = makeStateManager(null);
		const match = await executeAutoProgression('/spec-discuss', state, 'wf', 'proj', tmpDir);
		expect(match).toBeNull();
	});

	it('AUTO_PROGRESSION covers every non-accept phase command', () => {
		expect(AUTO_PROGRESSION['/spec-discuss']).toBe('/spec-plan');
		expect(AUTO_PROGRESSION['/spec-plan']).toBe('/spec-execute');
		expect(AUTO_PROGRESSION['/spec-execute']).toBe('/spec-audit');
		expect(AUTO_PROGRESSION['/spec-audit']).toBe('/spec-accept');
		expect(AUTO_PROGRESSION['/spec-accept']).toBeUndefined();
	});
});
