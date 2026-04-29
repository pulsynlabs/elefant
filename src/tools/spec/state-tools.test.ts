import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../../db/database.ts';
import { StateManager } from '../../state/manager.ts';
import type { SpecToolContext } from './base.ts';
import { SpecStateTool, SpecStatusTool, SpecWorkflowTool } from './state-tools.ts';

const tempDirs: string[] = [];

function setup(): SpecToolContext & { cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-spec-state-tools-'));
	tempDirs.push(dir);
	const database = new Database(join(dir, 'db.sqlite'));
	const projectId = 'project-1';
	database.db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [projectId, 'Project', dir]);
	const stateManager = new StateManager(dir, { id: projectId, name: 'Project', path: dir, database });
	stateManager.createSpecWorkflow({ projectId, workflowId: 'spec-mode', phase: 'discuss', isActive: true });
	return { database, stateManager, projectId, workflowId: 'spec-mode', cleanup: () => database.close() };
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('state spec tools', () => {
	it('spec_status shape is invariant before and after transition', async () => {
		const ctx = setup();
		const tool = new SpecStatusTool();
		const first = await tool.run(ctx, { projectId: 'project-1', workflowId: 'spec-mode' }) as unknown as Record<string, unknown>;
		await new SpecStateTool().run(ctx, { action: 'transition', projectId: 'project-1', workflowId: 'spec-mode', to: 'plan' });
		const second = await tool.run(ctx, { projectId: 'project-1', workflowId: 'spec-mode' }) as unknown as Record<string, unknown>;
		expect(Object.keys(second).sort()).toEqual(Object.keys(first).sort());
		expect(second.phase).toBe('plan');
		ctx.cleanup();
	});

	it('spec_state updates mode/depth/autopilot/wave/interview', async () => {
		const ctx = setup();
		const tool = new SpecStateTool();
		await tool.run(ctx, { action: 'set-mode', projectId: 'project-1', workflowId: 'spec-mode', mode: 'comprehensive' });
		await tool.run(ctx, { action: 'set-depth', projectId: 'project-1', workflowId: 'spec-mode', depth: 'deep' });
		await tool.run(ctx, { action: 'set-autopilot', projectId: 'project-1', workflowId: 'spec-mode', autopilot: true, lazy: true });
		await tool.run(ctx, { action: 'update-wave', projectId: 'project-1', workflowId: 'spec-mode', currentWave: 2, totalWaves: 13 });
		const result = await tool.run(ctx, { action: 'complete-interview', projectId: 'project-1', workflowId: 'spec-mode' }) as { mode: string; depth: string; lazyAutopilot: boolean; currentWave: number; interviewComplete: boolean };
		expect(result.mode).toBe('comprehensive');
		expect(result.depth).toBe('deep');
		expect(result.lazyAutopilot).toBe(true);
		expect(result.currentWave).toBe(2);
		expect(result.interviewComplete).toBe(true);
		ctx.cleanup();
	});

	it('spec_workflow lists, creates, and activates workflows', async () => {
		const ctx = setup();
		const tool = new SpecWorkflowTool();
		await tool.run(ctx, { action: 'create', projectId: 'project-1', workflowId: 'other-flow' });
		const active = await tool.run(ctx, { action: 'set-active', projectId: 'project-1', workflowId: 'other-flow' }) as { workflowId: string; isActive: boolean };
		const list = await tool.run(ctx, { action: 'list', projectId: 'project-1' }) as unknown[];
		expect(active.workflowId).toBe('other-flow');
		expect(active.isActive).toBe(true);
		expect(list).toHaveLength(2);
		ctx.cleanup();
	});
});
