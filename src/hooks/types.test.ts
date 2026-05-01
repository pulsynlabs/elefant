import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../db/database.ts';
import { MustHavesRepo } from '../db/repo/spec/must-haves.ts';
import { SpecTasksRepo } from '../db/repo/spec/tasks.ts';
import { StateManager } from '../state/manager.ts';
import { SpecBlueprintTool, SpecSpecTool } from '../tools/spec/document-tools.ts';
import type { SpecToolContext } from '../tools/spec/base.ts';
import { HookRegistry } from './registry.ts';
import type { HookContextMap } from './types.ts';

const typePayloads = {
	'wf:locked': { workflowId: 'spec-mode', projectId: 'project-1', lockedAt: new Date().toISOString() },
	'wf:unlocked': { workflowId: 'spec-mode', projectId: 'project-1' },
	'wf:amended': { workflowId: 'spec-mode', projectId: 'project-1', version: 1, rationale: 'test' },
	'wf:phase_transitioned': { workflowId: 'spec-mode', projectId: 'project-1', from: 'plan', to: 'execute', forced: false },
	'blueprint:created': { workflowId: 'spec-mode', projectId: 'project-1' },
	'wave:started': { workflowId: 'spec-mode', projectId: 'project-1', waveNumber: 1, taskCount: 0 },
	'wave:completed': { workflowId: 'spec-mode', projectId: 'project-1', waveNumber: 1 },
	'task:assigned': { workflowId: 'spec-mode', projectId: 'project-1', taskId: 'T1', agentRunId: 'run-1' },
	'task:completed': { workflowId: 'spec-mode', projectId: 'project-1', taskId: 'T1' },
} satisfies Pick<HookContextMap, 'wf:locked' | 'wf:unlocked' | 'wf:amended' | 'wf:phase_transitioned' | 'blueprint:created' | 'wave:started' | 'wave:completed' | 'task:assigned' | 'task:completed'>;

void typePayloads;

function seedProject(db: Database, projectId: string, projectPath: string): void {
	db.db.run(
		'INSERT INTO projects (id, name, path, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
		[projectId, projectId, projectPath, null, new Date().toISOString(), new Date().toISOString()],
	);
}

describe('spec hook event types and emissions', () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	it('emits new spec lifecycle events to registered listeners', async () => {
		const projectPath = mkdtempSync(join(tmpdir(), 'elefant-hook-types-'));
		tempDirs.push(projectPath);
		mkdirSync(join(projectPath, '.elefant'), { recursive: true });
		const db = new Database(join(projectPath, '.elefant', 'db.sqlite'));
		const projectId = 'project-1';
		const workflowId = 'spec-mode';
		seedProject(db, projectId, projectPath);

		const hooks = new HookRegistry();
		const seen: string[] = [];
		for (const event of Object.keys(typePayloads) as Array<keyof typeof typePayloads>) {
			hooks.on(event, (payload) => { seen.push(`${event}:${JSON.stringify(payload)}`); });
		}

		const state = new StateManager(projectPath, { id: projectId, name: projectId, path: projectPath, database: db, hookRegistry: hooks });
		const workflow = await state.createSpecWorkflow({ projectId, workflowId, phase: 'plan', totalWaves: 2, isActive: true });
		await state.lock(projectId, workflowId);
		await state.unlock(projectId, workflowId);
		await state.transitionPhase(projectId, workflowId, 'execute');
		await state.updateWave(projectId, workflowId, 1, 2);
		await state.updateWave(projectId, workflowId, 2, 2);

		const ctx: SpecToolContext = { database: db, stateManager: state, workflowId, projectId, hookRegistry: hooks };
		await new SpecBlueprintTool().run(ctx, { action: 'write', projectId, workflowId, content: '# Blueprint' });

		const mh = new MustHavesRepo(db).create({ workflowId: workflow.id, mhId: 'MH1', title: 'Test', description: 'Test', ordinal: 1 }, { amend: true });
		new MustHavesRepo(db).addValidationContract({ mustHaveId: mh.id, vcId: 'VC1.A', text: 'Test', ordinal: 1 }, { amend: true });
		await new SpecSpecTool().run(ctx, { action: 'amend', projectId, workflowId, rationale: 'Update contract', changes: { content: '# Spec' } });

		const blueprint = { id: crypto.randomUUID() };
		db.db.run('INSERT INTO spec_blueprints (id, workflow_id, version) VALUES (?, ?, ?)', [blueprint.id, workflow.id, 1]);
		const tasks = new SpecTasksRepo(db, hooks);
		const wave = tasks.createWave({ blueprintId: blueprint.id, waveNumber: 1, name: 'Wave 1', ordinal: 1 });
		const task = tasks.create({ waveId: wave.id, taskId: 'T1', name: 'Task', executor: 'goop-executor-high', action: 'Do', done: 'Done', ordinal: 1 });
		tasks.assign(task.id, 'run-1');
		tasks.markComplete(task.id);

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(seen.some((entry) => entry.startsWith('wf:locked:'))).toBe(true);
		expect(seen.some((entry) => entry.includes('"lockedAt"'))).toBe(true);
		expect(seen.some((entry) => entry.startsWith('wf:unlocked:'))).toBe(true);
		expect(seen.some((entry) => entry.includes('"from":"plan"'))).toBe(true);
		expect(seen.some((entry) => entry.startsWith('wave:started:'))).toBe(true);
		expect(seen.some((entry) => entry.startsWith('wave:completed:'))).toBe(true);
		expect(seen.some((entry) => entry.startsWith('blueprint:created:'))).toBe(true);
		expect(seen.some((entry) => entry.includes('"version":1'))).toBe(true);
		expect(seen.some((entry) => entry.startsWith('task:assigned:'))).toBe(true);
		expect(seen.some((entry) => entry.startsWith('task:completed:'))).toBe(true);

		db.close();
	});
});
