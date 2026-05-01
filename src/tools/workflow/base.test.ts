import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import { Database } from '../../db/database.ts';
import { StateManager } from '../../state/manager.ts';
import { SpecTool, type SpecToolContext } from './base.ts';
import { SpecToolError } from './errors.ts';

const tempDirs: string[] = [];

function setup(phase = 'execute'): SpecToolContext & { cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-spec-tool-base-'));
	tempDirs.push(dir);
	const database = new Database(join(dir, 'db.sqlite'));
	const projectId = 'project-1';
	database.db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [projectId, 'Project', dir]);
	const stateManager = new StateManager(dir, { id: projectId, name: 'Project', path: dir, database });
	stateManager.createSpecWorkflow({ projectId, workflowId: 'spec-mode', phase: phase as never, isActive: true });
	return { database, stateManager, projectId, workflowId: 'spec-mode', cleanup: () => database.close() };
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

class CountingTool extends SpecTool<{ projectId: string; workflowId: string; value: string; idempotency_key?: string }, { value: string; count: number }> {
	readonly name = 'spec_counting';
	readonly description = 'Counting test tool';
	readonly schema = z.object({ projectId: z.string(), workflowId: z.string(), value: z.string(), idempotency_key: z.string().optional() });
	readonly allowedPhases = ['execute'] as never;
	readonly permissions = { read: true, write: true, execute: false };
	readonly examples = [{ name: 'valid', payload: { projectId: 'project-1', workflowId: 'spec-mode', value: 'ok' } }];
	count = 0;

	protected async execute(_ctx: SpecToolContext, args: { value: string }): Promise<{ value: string; count: number }> {
		this.count += 1;
		return { value: args.value, count: this.count };
	}
}

describe('SpecTool base', () => {
	it('returns VALIDATION_FAILED on bad input', async () => {
		const ctx = setup();
		const result = await new CountingTool().run(ctx, { projectId: 'project-1', workflowId: 'spec-mode' });
		expect(result).toBeInstanceOf(SpecToolError);
		expect((result as SpecToolError).code).toBe('VALIDATION_FAILED');
		ctx.cleanup();
	});

	it('returns INVALID_PHASE when phase precondition fails', async () => {
		const ctx = setup('plan');
		const result = await new CountingTool().run(ctx, { projectId: 'project-1', workflowId: 'spec-mode', value: 'ok' });
		expect(result).toBeInstanceOf(SpecToolError);
		expect((result as SpecToolError).code).toBe('INVALID_PHASE');
		ctx.cleanup();
	});

	it('replays cached idempotent results without re-executing', async () => {
		const ctx = setup();
		const tool = new CountingTool();
		const args = { projectId: 'project-1', workflowId: 'spec-mode', value: 'ok', idempotency_key: 'key-1' };
		const first = await tool.run(ctx, args);
		const second = await tool.run(ctx, args);
		expect(first).toEqual({ value: 'ok', count: 1 });
		expect(second).toEqual({ value: 'ok', count: 1 });
		expect(tool.count).toBe(1);
		ctx.cleanup();
	});
});
