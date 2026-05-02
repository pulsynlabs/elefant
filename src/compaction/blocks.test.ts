import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../db/database.ts';
import { defaultAgentProfiles } from '../config/schema.ts';
import { SpecAdlRepo } from '../db/repo/spec/adl.ts';
import { MustHavesRepo } from '../db/repo/spec/must-haves.ts';
import { emit } from '../hooks/emit.ts';
import { HookRegistry } from '../hooks/registry.ts';
import { insertEvent } from '../db/repo/events.ts';
import { buildInitialMessages } from '../runs/context.ts';
import { StateManager } from '../state/manager.ts';
import { createDefaultState } from '../state/schema.ts';
import {
	__getFileReadCountForTests,
	__resetFileBlockCacheForTests,
	buildAdlBlock,
	buildResumeDirective,
	buildResumeDirectiveFromWorkflow,
	buildSpecBlock,
	buildStateBlock,
	buildToolInstructionsBlock,
	createCompactionBlockTransform,
	buildSpecModeBlock,
} from './blocks.ts';

type DirectiveStateOverrides = Omit<
	Partial<ReturnType<typeof createDefaultState>['workflow']>,
	'workflowId' | 'phase'
> & {
	workflowId?: string | null;
	phase?: string;
};

function createDirectiveState(
	overrides: DirectiveStateOverrides = {},
): ReturnType<StateManager['getState']> {
	const state = createDefaultState({
		id: crypto.randomUUID(),
		name: 'elefant',
		path: '/tmp/project',
	});

	return {
		...state,
		workflow: {
			...state.workflow,
			workflowId: 'workflow-1',
			currentWave: 1,
			totalWaves: 4,
			...overrides,
		},
	} as unknown as ReturnType<StateManager['getState']>;
}

function seedProjectAndSession(
  db: Database,
  projectId: string,
  projectPath: string,
  sessionId: string,
): void {
  db.db.run(
    'INSERT INTO projects (id, name, path, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [projectId, 'elefant', projectPath, null, new Date().toISOString(), new Date().toISOString()],
  );
  db.db.run(
    'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      sessionId,
      projectId,
      'workflow-1',
      'execute',
      'running',
      new Date().toISOString(),
      null,
      new Date().toISOString(),
    ],
  );
}

function seedProject(db: Database, projectId: string, projectPath: string): void {
  db.db.run(
    'INSERT INTO projects (id, name, path, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [projectId, projectId, projectPath, null, new Date().toISOString(), new Date().toISOString()],
  );
}

describe('compaction blocks', () => {
  const tempDirs: string[] = [];

	afterEach(() => {
		__resetFileBlockCacheForTests();
		for (const directory of tempDirs.splice(0)) {
			rmSync(directory, { recursive: true, force: true });
		}
	});

  it('buildStateBlock returns workflow state details', () => {
    const state = createDefaultState({
      id: crypto.randomUUID(),
      name: 'elefant',
      path: '/tmp/project',
    });

    const block = buildStateBlock(state);

    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain('Phase: idle');
    expect(block).toContain('Mode: standard');
  });

	it('buildResumeDirective returns Quick Mode fallback without a workflowId', () => {
		const directive = buildResumeDirective(createDirectiveState({ workflowId: null }));

		expect(directive.startsWith('> **RESUME FROM HERE:** Continue from where you left off.')).toBe(true);
	});

	it('buildResumeDirective tells Quick Mode to scan recent messages', () => {
		const directive = buildResumeDirective(createDirectiveState({ workflowId: null }));

		expect(directive).toContain('scan the most recent messages');
	});

	it('buildResumeDirective uses lazy autopilot first-wake-up wording', () => {
		const directive = buildResumeDirective(
			createDirectiveState({ lazyAutopilot: true, phase: 'execute' }),
		);

		expect(directive).toContain('NOT a first wake-up');
	});

	it('buildResumeDirective tells lazy autopilot not to ask questions', () => {
		const directive = buildResumeDirective(
			createDirectiveState({ lazyAutopilot: true, phase: 'execute' }),
		);

		expect(directive).toContain('Do NOT ask questions');
	});

	it('buildResumeDirective includes execute phase wave progress', () => {
		const directive = buildResumeDirective(
			createDirectiveState({ phase: 'execute', currentWave: 2, totalWaves: 4 }),
		);

		expect(directive).toContain('Wave 2/4 in progress');
	});

	it('buildResumeDirective includes plan phase guidance', () => {
		const directive = buildResumeDirective(createDirectiveState({ phase: 'plan' }));

		expect(directive).toContain('finalize SPEC.md/BLUEPRINT.md');
	});

	it('buildResumeDirective includes audit phase guidance', () => {
		const directive = buildResumeDirective(createDirectiveState({ phase: 'audit' }));

		expect(directive).toContain('run `/audit`');
	});

	it('buildResumeDirective includes accept phase guidance', () => {
		const directive = buildResumeDirective(createDirectiveState({ phase: 'accept' }));

		expect(directive).toContain('run `/accept`');
	});

	it('buildResumeDirective includes discuss phase guidance', () => {
		const directive = buildResumeDirective(createDirectiveState({ phase: 'discuss' }));

		expect(directive).toContain('continue clarifying requirements');
	});

	it('buildResumeDirective uses Quick Mode fallback for idle without workflowId', () => {
		const directive = buildResumeDirective(
			createDirectiveState({ phase: 'idle', workflowId: null }),
		);

		expect(directive.startsWith('> **RESUME FROM HERE:** Continue from where you left off.')).toBe(true);
	});

	it('buildResumeDirectiveFromWorkflow accepts minimal workflow input', () => {
		const directive = buildResumeDirectiveFromWorkflow({
			workflowId: 'workflow-1',
			phase: 'execute',
			currentWave: 2,
			totalWaves: 4,
		});

		expect(directive).toContain('Wave 2/4 in progress');
	});

	it('buildStateBlock ends with the resume directive', () => {
		const state = createDirectiveState({
			phase: 'execute',
			currentWave: 2,
			totalWaves: 4,
		});
		const block = buildStateBlock(state);
		const lines = block.split('\n').filter((line) => line !== '');

		expect(lines.at(-1)).toBe(
			'> **RESUME FROM HERE:** Wave 2/4 in progress — run `wf_status` to confirm task state, then resume incomplete tasks via `/execute`.',
		);
		expect(block).not.toContain('Read project state and spec before taking action');
	});

  it('buildAdlBlock returns empty string when no decisions exist', () => {
    const directory = mkdtempSync(join(tmpdir(), 'elefant-compaction-blocks-empty-'));
    tempDirs.push(directory);

    const db = new Database(join(directory, 'db.sqlite'));
    const block = buildAdlBlock(db);

    expect(block).toBe('');
    db.close();
  });

  it('buildAdlBlock returns entries for decision events', () => {
    const directory = mkdtempSync(join(tmpdir(), 'elefant-compaction-blocks-adl-'));
    tempDirs.push(directory);

    const db = new Database(join(directory, 'db.sqlite'));
    const projectId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    seedProjectAndSession(db, projectId, directory, sessionId);

    const inserted = insertEvent(db, {
      id: crypto.randomUUID(),
      session_id: sessionId,
      type: 'decision',
      data: JSON.stringify({
        description: 'Use WAL mode',
        action: 'Applied pragmas',
      }),
    });
    expect(inserted.ok).toBe(true);

    const block = buildAdlBlock(db);
    expect(block).toContain('Recent Decisions (ADL)');
    expect(block).toContain('Use WAL mode');
    expect(block).toContain('Applied pragmas');

    db.close();
  });

  it('buildToolInstructionsBlock returns empty string for empty tool list', () => {
    const block = buildToolInstructionsBlock([]);
    expect(block).toBe('');
  });

	it('buildToolInstructionsBlock includes registered tool names', () => {
		const block = buildToolInstructionsBlock(['read', 'write']);
		expect(block).toContain('read, write');
	});

	it('createCompactionBlockTransform injects block content via system:transform hook', async () => {
		const hooks = new HookRegistry();
		hooks.register(
			'system:transform',
			createCompactionBlockTransform({
				blocks: [
					{ name: 'workflow', render: () => '## State\n- Phase: execute' },
				],
				budget: 1_000,
			}),
		);

		const transformed = await emit(hooks, 'system:transform', {
			messages: [{ role: 'user', content: 'hello' }],
			sessionId: 'session-1',
			conversationId: 'conv-1',
			state: null,
			budgets: { tokens: 1_000 },
		});

		expect(transformed.messages[0]).toEqual({
			role: 'system',
			content: '## State\n- Phase: execute',
		});
		expect(transformed.messages[1]).toEqual({ role: 'user', content: 'hello' });
	});

	it('createCompactionBlockTransform injects Spec Mode block from dual-mode builder', async () => {
		const hooks = new HookRegistry();
		const activeSpec = { projectId: 'project-1', workflowId: 'workflow-1' };
		hooks.register(
			'system:transform',
			createCompactionBlockTransform({
				blocks: [
					{
						name: 'spec-mode-context',
						render: () =>
							activeSpec
								? `## SPEC MODE — ${activeSpec.workflowId}\n> **RESUME FROM HERE:** Continue.`
								: buildStateBlock(createDirectiveState({ workflowId: null })),
					},
				],
				budget: 1_000,
			}),
		);

		const transformed = await emit(hooks, 'system:transform', {
			messages: [{ role: 'user', content: 'continue' }],
			sessionId: 'session-spec',
			conversationId: 'conv-spec',
			state: null,
			budgets: { tokens: 1_000 },
		});

		expect(transformed.messages[0]?.content).toContain('## SPEC MODE — workflow-1');
		expect(transformed.messages[1]).toEqual({ role: 'user', content: 'continue' });
	});

	it('createCompactionBlockTransform injects state block when no active spec exists', async () => {
		const hooks = new HookRegistry();
		const activeSpec: { projectId: string; workflowId: string } | null = null;
		hooks.register(
			'system:transform',
			createCompactionBlockTransform({
				blocks: [
					{
						name: 'spec-mode-context',
						render: () =>
							activeSpec
								? '## SPEC MODE — workflow-1'
								: buildStateBlock(createDirectiveState({ workflowId: null })),
					},
				],
				budget: 1_000,
			}),
		);

		const transformed = await emit(hooks, 'system:transform', {
			messages: [{ role: 'user', content: 'continue' }],
			sessionId: 'session-quick',
			conversationId: 'conv-quick',
			state: null,
			budgets: { tokens: 1_000 },
		});

		expect(transformed.messages[0]?.content).toContain('## 🔮 Workflow State');
		expect(transformed.messages[0]?.content).toContain('Continue from where you left off');
		expect(transformed.messages[1]).toEqual({ role: 'user', content: 'continue' });
	});

	it('createCompactionBlockTransform does not double inject an existing Spec Mode block', async () => {
		const hooks = new HookRegistry();
		hooks.register(
			'system:transform',
			createCompactionBlockTransform({
				blocks: [{ name: 'spec-mode-context', render: () => '## SPEC MODE — duplicate' }],
				budget: 1_000,
			}),
		);

		const messages = [
			{ role: 'system' as const, content: '## SPEC MODE — existing' },
			{ role: 'user' as const, content: 'continue' },
		];
		const transformed = await emit(hooks, 'system:transform', {
			messages,
			sessionId: 'session-dedup',
			conversationId: 'conv-dedup',
			state: null,
			budgets: { tokens: 1_000 },
		});

		expect(transformed.messages).toEqual(messages);
		expect(
			transformed.messages.filter(
				(message) => message.content.startsWith('## SPEC MODE'),
			),
		).toHaveLength(1);
	});

	it('contextMode none agents are kept block-free by caller-level guard', async () => {
		expect(defaultAgentProfiles.verifier.contextMode).toBe('none');
		const source = buildInitialMessages({
			contextMode: defaultAgentProfiles.verifier.contextMode,
			sessionId: 'session-verifier',
			db: { getSessionMessages: () => [{ role: 'system', content: '## SPEC MODE — parent' }] },
		});
		const messages = [
			{ role: 'system' as const, content: 'verifier profile prompt' },
			...source.getMessages(),
			{ role: 'user' as const, content: 'verify the work' },
		];

		const transformed =
			defaultAgentProfiles.verifier.contextMode === 'none'
				? { messages }
				: await emit(new HookRegistry(), 'system:transform', {
						messages,
						sessionId: 'session-verifier',
						conversationId: 'conv-verifier',
						state: null,
						budgets: { tokens: 1_000 },
					});

		expect(transformed.messages.map((message) => message.content)).toEqual([
			'verifier profile prompt',
			'verify the work',
		]);
	});

	it('clamps oversized injected content to token budget and logs warning', async () => {
		const hooks = new HookRegistry();
		const originalWarn = console.warn;
		const warnings: string[] = [];
		console.warn = (message?: unknown) => {
			warnings.push(String(message ?? ''));
		};

		hooks.register(
			'system:transform',
			createCompactionBlockTransform({
				blocks: [{ name: 'huge', render: () => 'x'.repeat(200) }],
				budget: 10,
			}),
		);

		const transformed = await emit(hooks, 'system:transform', {
			messages: [{ role: 'user', content: 'hello' }],
			sessionId: 'session-budget',
			conversationId: 'conv-budget',
			state: null,
			budgets: { tokens: 10 },
		});

		console.warn = originalWarn;

		expect(warnings.length).toBe(1);
		expect(transformed.messages[0]?.role).toBe('system');
		expect(transformed.messages[0]?.content.length).toBeLessThan(200);
		expect(transformed.messages[1]).toEqual({ role: 'user', content: 'hello' });
	});

	it('file-backed block cache hits on same file and mtime', () => {
		const directory = mkdtempSync(join(tmpdir(), 'elefant-compaction-cache-hit-'));
		tempDirs.push(directory);
		const specPath = join(directory, 'SPEC.md');
		writeFileSync(specPath, '## Must-Haves\n- One\n## Out of Scope\n- Two\n', 'utf-8');

		const first = buildSpecBlock(specPath);
		const second = buildSpecBlock(specPath);

		expect(first.length).toBeGreaterThan(0);
		expect(second).toBe(first);
		expect(__getFileReadCountForTests(specPath)).toBe(1);
	});

	it('file-backed block cache misses when mtime changes', () => {
		const directory = mkdtempSync(join(tmpdir(), 'elefant-compaction-cache-miss-'));
		tempDirs.push(directory);
		const specPath = join(directory, 'SPEC.md');
		writeFileSync(specPath, '## Must-Haves\n- One\n## Out of Scope\n- Two\n', 'utf-8');

		const first = buildSpecBlock(specPath);
		expect(first.length).toBeGreaterThan(0);
		expect(__getFileReadCountForTests(specPath)).toBe(1);

		writeFileSync(specPath, '## Must-Haves\n- Updated\n## Out of Scope\n- Two\n', 'utf-8');
		const now = new Date();
		utimesSync(specPath, now, new Date(now.getTime() + 2_000));

		const second = buildSpecBlock(specPath);
		expect(second).toContain('Updated');
		expect(__getFileReadCountForTests(specPath)).toBe(2);
	});

	it('produces deterministic message ordering across identical invocations', async () => {
		const hooks = new HookRegistry();
		hooks.register(
			'system:transform',
			createCompactionBlockTransform({
				blocks: [
					{ name: 'a', render: () => 'A' },
					{ name: 'b', render: () => 'B' },
				],
				budget: 1_000,
			}),
		);

		const input = {
			messages: [
				{ role: 'system' as const, content: 'fixed header' },
				{ role: 'user' as const, content: 'task' },
			],
			sessionId: 'session-det',
			conversationId: 'conv-det',
			state: { phase: 'execute' },
			budgets: { tokens: 1_000 },
		};

		const first = await emit(hooks, 'system:transform', input);
		const second = await emit(hooks, 'system:transform', input);

		expect(JSON.stringify(first.messages)).toBe(JSON.stringify(second.messages));
		expect(first.messages.map((message) => message.content)).toEqual([
			'fixed header',
			'A',
			'B',
			'task',
		]);
	});

	it('buildSpecModeBlock includes workflow, must-haves, and ADL details', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'elefant-spec-mode-block-'));
		tempDirs.push(directory);
		mkdirSync(join(directory, '.elefant'), { recursive: true });
		const db = new Database(join(directory, '.elefant', 'db.sqlite'));
		const projectId = 'project-1';
		const workflowId = 'spec-mode';
		seedProject(db, projectId, directory);
		const state = new StateManager(directory, { id: projectId, name: projectId, path: directory, database: db });
		const workflow = await state.createSpecWorkflow({ projectId, workflowId, phase: 'execute', mode: 'standard', depth: 'deep', specLocked: true, currentWave: 3, totalWaves: 5 });
		const mustHaves = new MustHavesRepo(db);
		for (let index = 1; index <= 3; index += 1) {
			mustHaves.create({ workflowId: workflow.id, mhId: `MH${index}`, title: `Requirement ${index}`, description: 'Desc', ordinal: index }, { amend: true });
		}
		const adl = new SpecAdlRepo(db);
		adl.append(workflow.id, { type: 'decision', title: 'Use hooks' });
		adl.append(workflow.id, { type: 'observation', title: 'Keep block small' });

		const block = buildSpecModeBlock(db, projectId, workflowId);
		expect(block).toContain('## SPEC MODE — spec-mode');
		expect(block).toContain('**Phase:** execute | **Mode:** standard | **Depth:** deep');
		expect(block).toContain('**Spec Locked:** 🔒 Yes | **Wave:** 3/5');
		expect(block).toContain('**Locked Must-Haves (top 5):**');
		expect(block).toContain('- MH1: Requirement 1');
		expect(block).toContain('**Last 3 ADL:**');
		expect(block).toContain('[decision] Use hooks');
		expect(block).toContain('[observation] Keep block small');
		db.close();
	});

	it('buildSpecModeBlock prepends lazy autopilot directive', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'elefant-spec-mode-lazy-'));
		tempDirs.push(directory);
		mkdirSync(join(directory, '.elefant'), { recursive: true });
		const db = new Database(join(directory, '.elefant', 'db.sqlite'));
		const projectId = 'project-1';
		seedProject(db, projectId, directory);
		const state = new StateManager(directory, { id: projectId, name: projectId, path: directory, database: db });
		await state.createSpecWorkflow({ projectId, workflowId: 'spec-mode', phase: 'execute', autopilot: true, lazyAutopilot: true });
		const block = buildSpecModeBlock(db, projectId, 'spec-mode');
		expect(block.startsWith('> **LAZY AUTOPILOT ACTIVE — DO NOT ASK QUESTIONS, INFER FROM CONTEXT.**')).toBe(true);
		db.close();
	});

	it('buildSpecModeBlock omits lazy directive when lazyAutopilot is false', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'elefant-spec-mode-not-lazy-'));
		tempDirs.push(directory);
		mkdirSync(join(directory, '.elefant'), { recursive: true });
		const db = new Database(join(directory, '.elefant', 'db.sqlite'));
		const projectId = 'project-1';
		seedProject(db, projectId, directory);
		const state = new StateManager(directory, { id: projectId, name: projectId, path: directory, database: db });
		await state.createSpecWorkflow({ projectId, workflowId: 'spec-mode', phase: 'execute', autopilot: false, lazyAutopilot: false });
		const block = buildSpecModeBlock(db, projectId, 'spec-mode');
		expect(block).not.toContain('LAZY AUTOPILOT ACTIVE');
		db.close();
	});

	it('buildSpecModeBlock returns empty string for missing workflows', () => {
		const directory = mkdtempSync(join(tmpdir(), 'elefant-spec-mode-missing-'));
		tempDirs.push(directory);
		const db = new Database(join(directory, 'db.sqlite'));
		expect(buildSpecModeBlock(db, 'project-1', 'missing')).toBe('');
		db.close();
	});

	it('buildSpecModeBlock caps must-haves at five entries', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'elefant-spec-mode-cap-'));
		tempDirs.push(directory);
		mkdirSync(join(directory, '.elefant'), { recursive: true });
		const db = new Database(join(directory, '.elefant', 'db.sqlite'));
		const projectId = 'project-1';
		seedProject(db, projectId, directory);
		const state = new StateManager(directory, { id: projectId, name: projectId, path: directory, database: db });
		const workflow = await state.createSpecWorkflow({ projectId, workflowId: 'spec-mode', phase: 'execute' });
		const mustHaves = new MustHavesRepo(db);
		for (let index = 1; index <= 7; index += 1) {
			mustHaves.create({ workflowId: workflow.id, mhId: `MH${index}`, title: `Requirement ${index}`, description: 'Desc', ordinal: index }, { amend: true });
		}
		const block = buildSpecModeBlock(db, projectId, 'spec-mode');
		expect((block.match(/^- MH/gm) ?? []).length).toBe(5);
		expect(block).toContain('- MH5: Requirement 5');
		expect(block).not.toContain('- MH6: Requirement 6');
		db.close();
	});
});
