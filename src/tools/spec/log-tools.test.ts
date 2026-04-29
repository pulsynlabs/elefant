import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../../db/database.ts';
import { StateManager } from '../../state/manager.ts';
import type { SpecToolContext } from './base.ts';
import { SpecToolError } from './errors.ts';
import { SpecCheckpointTool, SpecChronicleTool } from './log-tools.ts';

const tempDirs: string[] = [];

function setup(phase: 'plan' | 'execute' = 'execute'): SpecToolContext & { cleanup: () => void; workflowPk: string } {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-spec-log-tools-'));
	tempDirs.push(dir);
	const database = new Database(join(dir, 'db.sqlite'));
	const projectId = 'project-1';
	database.db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [projectId, 'Project', dir]);
	const stateManager = new StateManager(dir, { id: projectId, name: 'Project', path: dir, database });
	stateManager.createSpecWorkflow({ projectId, workflowId: 'spec-mode', phase, isActive: true });
	const row = database.db.query('SELECT id FROM spec_workflows WHERE workflow_id = ?').get('spec-mode') as { id: string };
	return { database, stateManager, projectId, workflowId: 'spec-mode', workflowPk: row.id, cleanup: () => database.close() };
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('log spec tools', () => {
	it('rejects chronicle append outside execute/audit/accept with INVALID_PHASE', async () => {
		const ctx = setup('plan');
		const result = await new SpecChronicleTool().run(ctx, { action: 'append', projectId: 'project-1', workflowId: 'spec-mode', kind: 'task' });
		expect(result).toBeInstanceOf(SpecToolError);
		expect((result as SpecToolError).code).toBe('INVALID_PHASE');
		const count = ctx.database.db.query('SELECT COUNT(*) AS c FROM spec_chronicle_entries').get() as { c: number };
		expect(count.c).toBe(0);
		ctx.cleanup();
	});

	it('idempotent chronicle append writes exactly one row', async () => {
		const ctx = setup('execute');
		const tool = new SpecChronicleTool();
		const args = { action: 'append', projectId: 'project-1', workflowId: 'spec-mode', kind: 'task-complete', idempotency_key: 'same-key' };
		await tool.run(ctx, args);
		await tool.run(ctx, args);
		const count = ctx.database.db.query('SELECT COUNT(*) AS c FROM spec_chronicle_entries WHERE workflow_id = ?').get(ctx.workflowPk) as { c: number };
		expect(count.c).toBe(1);
		ctx.cleanup();
	});

	it('checkpoint save/load round-trips through chronicle entries', async () => {
		const ctx = setup('execute');
		const tool = new SpecCheckpointTool();
		await tool.run(ctx, { action: 'save', projectId: 'project-1', workflowId: 'spec-mode', id: 'cp-1', context: { note: 'ok' } });
		const loaded = await tool.run(ctx, { action: 'load', projectId: 'project-1', workflowId: 'spec-mode', id: 'cp-1' });
		expect((loaded as { payload: { id: string; context: { note: string } } }).payload.id).toBe('cp-1');
		expect((loaded as { payload: { id: string; context: { note: string } } }).payload.context.note).toBe('ok');
		ctx.cleanup();
	});
});
