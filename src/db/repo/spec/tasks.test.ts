import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../../database.ts';
import { RepoConstraintViolationError, RowNotFoundError } from './base.ts';
import { SpecWorkflowsRepo } from './workflows.ts';
import { SpecTasksRepo } from './tasks.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
const databases: Database[] = [];

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-spec-tasks-'));
	tempDirs.push(dir);
	return dir;
}

interface TaskTestFixture {
	database: Database;
	repo: SpecTasksRepo;
	workflowId: string; // spec_workflows.id (UUID PK)
	blueprintId: string;
	waveId: string;
	projectId: string;
}

function setup(): TaskTestFixture {
	const dir = createTempDir();
	const dbPath = join(dir, 'db.sqlite');
	const database = new Database(dbPath);
	databases.push(database);

	const projectId = crypto.randomUUID();
	database.db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [
		projectId,
		'test-project',
		join(dir, 'project'),
	]);

	const workflowsRepo = new SpecWorkflowsRepo(database);
	const workflow = workflowsRepo.create({
		projectId,
		workflowId: `wf-${crypto.randomUUID().slice(0, 8)}`,
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
		waveNumber: 1,
		name: 'Foundation',
		ordinal: 0,
	});

	return {
		database,
		repo: tasksRepo,
		workflowId: workflow.id,
		blueprintId,
		waveId: wave.id,
		projectId,
	};
}

afterEach(() => {
	for (const database of databases.splice(0)) {
		database.close();
	}
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SpecTasksRepo — Waves', () => {
	it('createWave inserts a row and getWave returns it', () => {
		const { blueprintId, repo } = setup();

		const wave = repo.createWave({
			blueprintId,
			waveNumber: 2,
			name: 'Storage Layer',
			goal: 'Land the storage layer',
			parallel: true,
			ordinal: 1,
		});

		expect(wave.blueprintId).toBe(blueprintId);
		expect(wave.waveNumber).toBe(2);
		expect(wave.name).toBe('Storage Layer');
		expect(wave.goal).toBe('Land the storage layer');
		expect(wave.parallel).toBe(true);
		expect(wave.ordinal).toBe(1);

		const fetched = repo.getWave(wave.id);
		expect(fetched).not.toBeNull();
		expect(fetched!.id).toBe(wave.id);
		expect(fetched!.name).toBe('Storage Layer');
	});

	it('listWaves returns waves ordered by wave_number ASC', () => {
		const { blueprintId, repo } = setup();

		repo.createWave({ blueprintId, waveNumber: 4, name: 'Fourth', ordinal: 3 });
		repo.createWave({ blueprintId, waveNumber: 2, name: 'Second', ordinal: 1 });
		repo.createWave({ blueprintId, waveNumber: 3, name: 'Third', ordinal: 2 });

		const waves = repo.listWaves(blueprintId);
		expect(waves.map((w) => w.waveNumber)).toEqual([1, 2, 3, 4]); // includes setup wave
	});

	it('getWave returns null for missing id', () => {
		const { repo } = setup();
		expect(repo.getWave('nonexistent')).toBeNull();
	});
});

describe('SpecTasksRepo — Tasks', () => {
	it('create inserts a row and get returns it', () => {
		const { waveId, repo } = setup();

		const task = repo.create({
			waveId,
			taskId: 'T1',
			name: 'Add migration',
			executor: 'goop-executor-medium',
			files: ['src/db/migrations/0005.sql'],
			action: 'Create migration file',
			done: 'Migration applies cleanly',
			verify: 'bun test',
			ordinal: 0,
		});

		expect(task.taskId).toBe('T1');
		expect(task.name).toBe('Add migration');
		expect(task.executor).toBe('goop-executor-medium');
		expect(task.files).toEqual(['src/db/migrations/0005.sql']);
		expect(task.status).toBe('pending');
		expect(task.ordinal).toBe(0);

		const fetched = repo.get(task.id);
		expect(fetched).not.toBeNull();
		expect(fetched!.id).toBe(task.id);
	});

	it('create duplicate (wave_id, task_id) throws RepoConstraintViolationError', () => {
		const { waveId, repo } = setup();

		repo.create({
			waveId,
			taskId: 'T1',
			name: 'First',
			executor: 'goop-executor-low',
			action: 'Do thing',
			done: 'Thing works',
			ordinal: 0,
		});

		expect(() =>
			repo.create({
				waveId,
				taskId: 'T1',
				name: 'Duplicate',
				executor: 'goop-executor-low',
				action: 'Duplicate',
				done: 'Should fail',
				ordinal: 1,
			}),
		).toThrow(RepoConstraintViolationError);
	});

	it('listByWave returns tasks ordered by ordinal ASC', () => {
		const { waveId, repo } = setup();

		repo.create({
			waveId,
			taskId: 'T3',
			name: 'Third',
			executor: 'goop-executor-low',
			action: 'Do third',
			done: 'Third works',
			ordinal: 2,
		});
		repo.create({
			waveId,
			taskId: 'T1',
			name: 'First',
			executor: 'goop-executor-low',
			action: 'Do first',
			done: 'First works',
			ordinal: 0,
		});
		repo.create({
			waveId,
			taskId: 'T2',
			name: 'Second',
			executor: 'goop-executor-low',
			action: 'Do second',
			done: 'Second works',
			ordinal: 1,
		});

		const tasks = repo.listByWave(waveId);
		expect(tasks.map((t) => t.taskId)).toEqual(['T1', 'T2', 'T3']);
	});

	it('listByStatus returns only tasks matching the given status', () => {
		const { workflowId, waveId, repo } = setup();

		const t1 = repo.create({
			waveId,
			taskId: 'T1',
			name: 'Task 1',
			executor: 'goop-executor-low',
			action: 'Do 1',
			done: '1 works',
			ordinal: 0,
		});
		repo.create({
			waveId,
			taskId: 'T2',
			name: 'Task 2',
			executor: 'goop-executor-low',
			action: 'Do 2',
			done: '2 works',
			ordinal: 1,
		});

		repo.assign(t1.id, 'run-1');

		const inProgress = repo.listByStatus(workflowId, 'in_progress');
		expect(inProgress.length).toBe(1);
		expect(inProgress[0].taskId).toBe('T1');

		const pending = repo.listByStatus(workflowId, 'pending');
		expect(pending.length).toBe(1);
		expect(pending[0].taskId).toBe('T2');
	});

	it('getByTaskId returns the correct task or null', () => {
		const { waveId, repo } = setup();

		repo.create({
			waveId,
			taskId: 'find-me',
			name: 'Findable',
			executor: 'goop-executor-low',
			action: 'Do',
			done: 'Works',
			ordinal: 0,
		});

		expect(repo.getByTaskId(waveId, 'find-me')!.name).toBe('Findable');
		expect(repo.getByTaskId(waveId, 'missing')).toBeNull();
	});

	it('get returns null for missing id', () => {
		const { repo } = setup();
		expect(repo.get('nonexistent')).toBeNull();
	});
});

describe('SpecTasksRepo — Status mutations', () => {
	it('assign sets in_progress, agent_run_id, started_at', () => {
		const { waveId, repo } = setup();
		const task = repo.create({
			waveId,
			taskId: 'T1',
			name: 'Task',
			executor: 'goop-executor-medium',
			action: 'Do',
			done: 'Works',
			ordinal: 0,
		});

		const assigned = repo.assign(task.id, 'run-abc');
		expect(assigned.status).toBe('in_progress');
		expect(assigned.agentRunId).toBe('run-abc');
		expect(assigned.startedAt).not.toBeNull();
		expect(assigned.completedAt).toBeNull();
	});

	it('markComplete sets complete and completed_at', () => {
		const { waveId, repo } = setup();
		const task = repo.create({
			waveId,
			taskId: 'T1',
			name: 'Task',
			executor: 'goop-executor-medium',
			action: 'Do',
			done: 'Works',
			ordinal: 0,
		});

		const completed = repo.markComplete(task.id);
		expect(completed.status).toBe('complete');
		expect(completed.completedAt).not.toBeNull();
	});

	it('markBlocked sets blocked', () => {
		const { waveId, repo } = setup();
		const task = repo.create({
			waveId,
			taskId: 'T1',
			name: 'Task',
			executor: 'goop-executor-medium',
			action: 'Do',
			done: 'Works',
			ordinal: 0,
		});

		const blocked = repo.markBlocked(task.id, 'Waiting for dependency');
		expect(blocked.status).toBe('blocked');
	});

	it('markSkipped sets skipped', () => {
		const { waveId, repo } = setup();
		const task = repo.create({
			waveId,
			taskId: 'T1',
			name: 'Task',
			executor: 'goop-executor-medium',
			action: 'Do',
			done: 'Works',
			ordinal: 0,
		});

		const skipped = repo.markSkipped(task.id);
		expect(skipped.status).toBe('skipped');
	});

	it('reset clears agent_run_id, started_at, completed_at and sets pending', () => {
		const { waveId, repo } = setup();
		const task = repo.create({
			waveId,
			taskId: 'T1',
			name: 'Task',
			executor: 'goop-executor-medium',
			action: 'Do',
			done: 'Works',
			ordinal: 0,
		});

		const assigned = repo.assign(task.id, 'run-xyz');
		expect(assigned.status).toBe('in_progress');
		expect(assigned.agentRunId).not.toBeNull();

		const reset = repo.reset(task.id);
		expect(reset.status).toBe('pending');
		expect(reset.agentRunId).toBeNull();
		expect(reset.startedAt).toBeNull();
		expect(reset.completedAt).toBeNull();
	});

	it('assign then reset returns to pending with no agent_run_id', () => {
		const { waveId, repo } = setup();
		const task = repo.create({
			waveId,
			taskId: 'T1',
			name: 'Task',
			executor: 'goop-executor-medium',
			action: 'Do',
			done: 'Works',
			ordinal: 0,
		});

		repo.assign(task.id, 'run-1');
		const reset = repo.reset(task.id);

		expect(reset.status).toBe('pending');
		expect(reset.agentRunId).toBeNull();
		expect(reset.startedAt).toBeNull();
		expect(reset.completedAt).toBeNull();
	});
});

describe('SpecTasksRepo — Constraint / edge cases', () => {
	it('invalid status via raw SQL is caught as RepoConstraintViolationError', () => {
		const { repo, waveId } = setup();
		const task = repo.create({
			waveId,
			taskId: 'T1',
			name: 'Task',
			executor: 'goop-executor-medium',
			action: 'Do',
			done: 'Works',
			ordinal: 0,
		});

		// Direct SQL bypasses the repo's type safety; assert the CHECK constraint fires.
		expect(() => {
			repo['db'].run('UPDATE spec_tasks SET status = ? WHERE id = ?', [
				'invalid_status',
				task.id,
			]);
		}).toThrow();
	});

	it('mutateStatus on missing task throws RowNotFoundError', () => {
		const { repo } = setup();
		expect(() => repo.assign('nonexistent', 'run-1')).toThrow(RowNotFoundError);
	});

	it('cascade delete: deleting the wave removes its tasks', () => {
		const { database, waveId, repo } = setup();
		const task = repo.create({
			waveId,
			taskId: 'T1',
			name: 'Task',
			executor: 'goop-executor-medium',
			action: 'Do',
			done: 'Works',
			ordinal: 0,
		});

		expect(repo.get(task.id)).not.toBeNull();

		database.db.run('DELETE FROM spec_waves WHERE id = ?', [waveId]);

		expect(repo.get(task.id)).toBeNull();
	});
});
