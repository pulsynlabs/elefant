import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../db/database.ts';
import { SpecAdlRepo } from '../db/repo/spec/adl.ts';
import { MustHavesRepo } from '../db/repo/spec/must-haves.ts';
import { SpecTasksRepo } from '../db/repo/spec/tasks.ts';
import { SpecWorkflowsRepo } from '../db/repo/spec/workflows.ts';
import { buildSpecModeBlock } from './wf-context-block.ts';

const tempDirs: string[] = [];
const databases: Database[] = [];

function setup(opts?: { lazyAutopilot?: boolean }): {
	database: Database;
	projectId: string;
	workflowId: string;
} {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-wf-context-block-'));
	tempDirs.push(dir);

	const database = new Database(join(dir, 'db.sqlite'));
	databases.push(database);

	const projectId = crypto.randomUUID();
	database.db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [
		projectId,
		'test-project',
		join(dir, 'project'),
	]);

	const workflowId = `wf-${crypto.randomUUID().slice(0, 8)}`;
	const workflowsRepo = new SpecWorkflowsRepo(database);
	const workflow = workflowsRepo.create({
		projectId,
		workflowId,
		phase: 'execute',
		mode: 'standard',
		depth: 'deep',
		autopilot: opts?.lazyAutopilot ?? false,
		lazyAutopilot: opts?.lazyAutopilot ?? false,
		currentWave: 2,
		totalWaves: 4,
	});

	const mustHavesRepo = new MustHavesRepo(database);
	mustHavesRepo.create({
		workflowId: workflow.id,
		mhId: 'MH2',
		title: 'Rich Spec Mode state block',
		description: 'Include resume directive and progress.',
		ordinal: 1,
	});

	const adlRepo = new SpecAdlRepo(database);
	adlRepo.append(workflow.id, {
		type: 'decision',
		title: 'Place resume directive near the top',
	});

	const blueprintId = crypto.randomUUID();
	database.db.run(
		`INSERT INTO spec_blueprints (id, workflow_id, version, created_at)
		 VALUES (?, ?, 1, datetime('now'))`,
		[blueprintId, workflow.id],
	);

	const tasksRepo = new SpecTasksRepo(database);
	const wave = tasksRepo.createWave({
		blueprintId,
		waveNumber: 2,
		name: 'Backend',
		ordinal: 2,
	});
	tasksRepo.create({
		waveId: wave.id,
		taskId: 'T2.1',
		name: 'Completed task',
		executor: 'goop-executor-high',
		action: 'Do it',
		done: 'Done',
		status: 'complete',
		ordinal: 1,
	});
	tasksRepo.create({
		waveId: wave.id,
		taskId: 'T2.2',
		name: 'In-progress task',
		executor: 'goop-executor-high',
		action: 'Do it',
		done: 'Done',
		status: 'in_progress',
		ordinal: 2,
	});
	tasksRepo.create({
		waveId: wave.id,
		taskId: 'T2.3',
		name: 'Pending task',
		executor: 'goop-executor-high',
		action: 'Do it',
		done: 'Done',
		status: 'pending',
		ordinal: 3,
	});

	workflowsRepo.update(workflow.id, { specLocked: true });

	return { database, projectId, workflowId };
}

afterEach(() => {
	for (const database of databases.splice(0)) database.close();
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('buildSpecModeBlock', () => {
	it('places RESUME FROM HERE immediately after the heading', () => {
		const { database, projectId, workflowId } = setup();

		const block = buildSpecModeBlock(database, projectId, workflowId);
		const lines = block.trimEnd().split('\n');

		expect(lines[0]).toBe(`## SPEC MODE — ${workflowId}`);
		expect(lines[1]).toContain('> **RESUME FROM HERE:**');
		expect(lines.findIndex((line) => line.includes('RESUME FROM HERE'))).toBeLessThan(5);
	});

	it('includes canonical 3-step resume guidance', () => {
		const { database, projectId, workflowId } = setup();

		const block = buildSpecModeBlock(database, projectId, workflowId);

		expect(block).toContain('> 1) Run `wf_status` to confirm phase/wave/task state.');
		expect(block).toContain('> 2) Continue the current phase using the appropriate command');
		expect(block).toContain('> 3) Resume the *next incomplete task*; do not restart completed work.');
	});

	it('includes Progress with Done and In Progress counts', () => {
		const { database, projectId, workflowId } = setup();

		const block = buildSpecModeBlock(database, projectId, workflowId);

		expect(block).toContain('## Progress');
		expect(block).toContain('### Done');
		expect(block).toContain('- [x] 1 task completed');
		expect(block).toContain('### In Progress');
		expect(block).toContain('- [ ] 2 tasks remaining');
	});

	it('preserves phase, wave, must-haves, current task summary, and ADL fields', () => {
		const { database, projectId, workflowId } = setup();

		const block = buildSpecModeBlock(database, projectId, workflowId);

		expect(block).toContain('**Phase:** execute | **Mode:** standard | **Depth:** deep');
		expect(block).toContain('**Spec Locked:** 🔒 Yes | **Wave:** 2/4');
		expect(block).toContain('**Current Wave Tasks:** complete: 1, in_progress: 1, pending: 1');
		expect(block).toContain('**Locked Must-Haves (top 5):**');
		expect(block).toContain('- MH2: Rich Spec Mode state block');
		expect(block).toContain('**Last 3 ADL:**');
		expect(block).toContain('[decision] Place resume directive near the top');
	});

	it('puts Lazy Autopilot warning before heading and uses proactive resume wording', () => {
		const { database, projectId, workflowId } = setup({ lazyAutopilot: true });

		const block = buildSpecModeBlock(database, projectId, workflowId);
		const warningIndex = block.indexOf('LAZY AUTOPILOT ACTIVE');
		const headingIndex = block.indexOf('## SPEC MODE');

		expect(warningIndex).toBeGreaterThanOrEqual(0);
		expect(warningIndex).toBeLessThan(headingIndex);
		expect(block).toContain('This is NOT a first wake-up');
		expect(block.split('\n').findIndex((line) => line.includes('RESUME FROM HERE'))).toBeLessThan(5);
	});

	it('returns an empty string for a missing workflow', () => {
		const { database, projectId } = setup();

		expect(buildSpecModeBlock(database, projectId, 'missing-workflow')).toBe('');
	});

	it('block stays under 1500 estimated tokens with typical workload', () => {
		const { database, projectId, workflowId } = setup();

		const block = buildSpecModeBlock(database, projectId, workflowId);
		// V1 heuristic: ~0.75 tokens per word (conservative BPE estimate).
		// Words = split on whitespace, filter empties.
		const words = block.trim().split(/\s+/).filter(Boolean).length;
		const estimatedTokens = Math.ceil(words * 1.33);

		expect(estimatedTokens).toBeLessThan(1500);
	});
});
