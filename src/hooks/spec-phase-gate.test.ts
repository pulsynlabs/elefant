import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../db/database.ts';
import { StateManager } from '../state/manager.ts';
import { instantiateSpecTools } from '../tools/spec/index.ts';
import { createPhaseAllowListFromSpecTools, createSpecPhaseGateHandler } from './spec-phase-gate.ts';

function seedProject(db: Database, projectId: string, projectPath: string): void {
	db.db.run(
		'INSERT INTO projects (id, name, path, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
		[projectId, projectId, projectPath, null, new Date().toISOString(), new Date().toISOString()],
	);
}

describe('spec phase gate', () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	async function setup(phase: 'discuss' | 'execute') {
		const projectPath = mkdtempSync(join(tmpdir(), 'elefant-phase-gate-'));
		tempDirs.push(projectPath);
		mkdirSync(join(projectPath, '.elefant'), { recursive: true });
		const db = new Database(join(projectPath, '.elefant', 'db.sqlite'));
		const projectId = 'project-1';
		const workflowId = 'spec-mode';
		seedProject(db, projectId, projectPath);
		const state = new StateManager(projectPath, { id: projectId, name: projectId, path: projectPath, database: db });
		await state.createSpecWorkflow({ projectId, workflowId, phase, isActive: true });
		const handler = createSpecPhaseGateHandler(state, createPhaseAllowListFromSpecTools(instantiateSpecTools()));
		return { db, state, handler, projectId, workflowId };
	}

	it('vetoes wf_chronicle.append in discuss phase', async () => {
		const { db, handler, projectId, workflowId } = await setup('discuss');
		const result = await handler({ toolName: 'wf_chronicle', args: { action: 'append', projectId, workflowId }, conversationId: 'conv-1' });
		expect(result).toEqual({
			veto: true,
			error: {
				code: 'INVALID_PHASE',
				expected: ['execute', 'audit', 'accept'],
				actual: 'discuss',
				tool: 'wf_chronicle',
				message: "Tool 'wf_chronicle' is not allowed in phase 'discuss'. Allowed: execute, audit, accept",
			},
		});
		db.close();
	});

	it('allows wf_chronicle.append in execute phase', async () => {
		const { db, handler, projectId, workflowId } = await setup('execute');
		const result = await handler({ toolName: 'wf_chronicle', args: { action: 'append', projectId, workflowId }, conversationId: 'conv-1' });
		expect(result).toBeUndefined();
		db.close();
	});

	it('allows unrestricted wf_status in any phase', async () => {
		const { db, handler, projectId, workflowId } = await setup('discuss');
		const result = await handler({ toolName: 'wf_status', args: { projectId, workflowId }, conversationId: 'conv-1' });
		expect(result).toBeUndefined();
		db.close();
	});

	it('allows non-spec tools regardless of phase', async () => {
		const { db, handler } = await setup('discuss');
		const result = await handler({ toolName: 'read', args: { filePath: 'src/foo.ts' }, conversationId: 'conv-1' });
		expect(result).toBeUndefined();
		db.close();
	});

	it('phase changes make previously-vetoed calls succeed', async () => {
		const { db, state, handler, projectId, workflowId } = await setup('discuss');
		const first = await handler({ toolName: 'wf_chronicle', args: { action: 'append', projectId, workflowId }, conversationId: 'conv-1' });
		expect(first).toMatchObject({ veto: true });
		await state.transitionSpecPhase(projectId, workflowId, 'plan');
		await state.transitionSpecPhase(projectId, workflowId, 'execute');
		const second = await handler({ toolName: 'wf_chronicle', args: { action: 'append', projectId, workflowId }, conversationId: 'conv-1' });
		expect(second).toBeUndefined();
		db.close();
	});

	it('allows missing workflow id because the tool will validate context', async () => {
		const { db, handler, projectId } = await setup('discuss');
		const result = await handler({ toolName: 'wf_chronicle', args: { action: 'append', projectId }, conversationId: 'conv-1' });
		expect(result).toBeUndefined();
		db.close();
	});
});
