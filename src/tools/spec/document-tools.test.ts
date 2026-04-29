import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../../db/database.ts';
import { MustHavesRepo } from '../../db/repo/spec/must-haves.ts';
import { StateManager } from '../../state/manager.ts';
import type { SpecToolContext } from './base.ts';
import { SpecToolError } from './errors.ts';
import { SpecBlueprintTool, SpecSpecTool } from './document-tools.ts';

const tempDirs: string[] = [];

function setup(): SpecToolContext & { cleanup: () => void; workflowPk: string } {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-spec-document-tools-'));
	tempDirs.push(dir);
	const database = new Database(join(dir, 'db.sqlite'));
	const projectId = 'project-1';
	database.db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [projectId, 'Project', dir]);
	const stateManager = new StateManager(dir, { id: projectId, name: 'Project', path: dir, database });
	stateManager.createSpecWorkflow({ projectId, workflowId: 'spec-mode', phase: 'specify', isActive: true });
	const row = database.db.query('SELECT id FROM spec_workflows WHERE workflow_id = ?').get('spec-mode') as { id: string };
	return { database, stateManager, projectId, workflowId: 'spec-mode', workflowPk: row.id, cleanup: () => database.close() };
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('document spec tools', () => {
	it('rejects lock when validation contracts are incomplete', async () => {
		const ctx = setup();
		new MustHavesRepo(ctx.database).create({ workflowId: ctx.workflowPk, mhId: 'MH1', title: 'Need', description: 'Do it', ordinal: 1 });
		const result = await new SpecSpecTool().run(ctx, { action: 'lock', projectId: 'project-1', workflowId: 'spec-mode' });
		expect(result).toBeInstanceOf(SpecToolError);
		expect((result as SpecToolError).code).toBe('VALIDATION_CONTRACT_INCOMPLETE');
		ctx.cleanup();
	});

	it('returns SPEC_LOCKED for locked spec writes and supports amendment flow', async () => {
		const ctx = setup();
		const repo = new MustHavesRepo(ctx.database);
		const mh = repo.create({ workflowId: ctx.workflowPk, mhId: 'MH1', title: 'Need', description: 'Do it', ordinal: 1 });
		repo.addValidationContract({ mustHaveId: mh.id, vcId: 'VC1.A', text: 'Works', ordinal: 1 });
		const tool = new SpecSpecTool();
		await tool.run(ctx, { action: 'write', projectId: 'project-1', workflowId: 'spec-mode', content: 'before' });
		await tool.run(ctx, { action: 'lock', projectId: 'project-1', workflowId: 'spec-mode' });
		const rejected = await tool.run(ctx, { action: 'write', projectId: 'project-1', workflowId: 'spec-mode', content: 'after' });
		expect(rejected).toBeInstanceOf(SpecToolError);
		expect((rejected as SpecToolError).code).toBe('SPEC_LOCKED');
		const amended = await tool.run(ctx, { action: 'amend', projectId: 'project-1', workflowId: 'spec-mode', rationale: 'update', changes: { content: 'after' } }) as { version: number };
		expect(amended.version).toBe(1);
		ctx.cleanup();
	});

	it('blueprint wave section returns wave tasks', async () => {
		const ctx = setup();
		const bp = ctx.database.db.query(`INSERT INTO spec_blueprints (id, workflow_id, version, created_at) VALUES (?, ?, 1, ?) RETURNING id`).get(crypto.randomUUID(), ctx.workflowPk, new Date().toISOString()) as { id: string };
		const wave = ctx.database.db.query(`INSERT INTO spec_waves (id, blueprint_id, wave_number, name, goal, parallel, ordinal, created_at) VALUES (?, ?, 1, 'Wave', 'Goal', 0, 1, ?) RETURNING id`).get(crypto.randomUUID(), bp.id, new Date().toISOString()) as { id: string };
		ctx.database.db.run(`INSERT INTO spec_tasks (id, wave_id, task_id, name, executor, files, action, done, verify, status, ordinal, created_at, updated_at) VALUES (?, ?, 'T1', 'Task', 'goop-executor-medium', '[]', 'Do', 'Done', 'test', 'pending', 1, ?, ?)`, [crypto.randomUUID(), wave.id, new Date().toISOString(), new Date().toISOString()]);
		const section = await new SpecBlueprintTool().run(ctx, { action: 'section', projectId: 'project-1', workflowId: 'spec-mode', wave: 1 }) as { tasks: unknown[] };
		expect(section.tasks).toHaveLength(1);
		ctx.cleanup();
	});
});
