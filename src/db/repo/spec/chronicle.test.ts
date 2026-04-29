import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../../database.ts';
import { RepoConstraintViolationError } from './base.ts';
import { SpecWorkflowsRepo } from './workflows.ts';
import { SpecChronicleRepo } from './chronicle.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
const databases: Database[] = [];

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-spec-chronicle-'));
	tempDirs.push(dir);
	return dir;
}

function setup(): { database: Database; workflowId: string; repo: SpecChronicleRepo } {
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

	return {
		database,
		workflowId: workflow.id,
		repo: new SpecChronicleRepo(database),
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

describe('SpecChronicleRepo', () => {
	it('append inserts a row and list returns it', () => {
		const { workflowId, repo } = setup();

		const entry = repo.append(workflowId, {
			kind: 'task_started',
			payload: { taskId: 'T1' },
		});

		expect(entry.id.length).toBeGreaterThan(0);
		expect(entry.workflowId).toBe(workflowId);
		expect(entry.kind).toBe('task_started');
		expect(entry.payload).toEqual({ taskId: 'T1' });

		const list = repo.list(workflowId);
		expect(list.length).toBe(1);
		expect(list[0].id).toBe(entry.id);
	});

	it('list ordered ASC, getLastN ordered DESC', () => {
		const { workflowId, repo } = setup();

		repo.append(workflowId, { kind: 'first', payload: { n: 1 } });
		repo.append(workflowId, { kind: 'second', payload: { n: 2 } });
		repo.append(workflowId, { kind: 'third', payload: { n: 3 } });

		const asc = repo.list(workflowId);
		expect(asc.map((e) => e.kind)).toEqual(['first', 'second', 'third']);

		const desc = repo.getLastN(workflowId, 2);
		expect(desc.map((e) => e.kind)).toEqual(['third', 'second']);
		expect(desc.length).toBe(2);
	});

	it('list with limit returns only that many', () => {
		const { workflowId, repo } = setup();

		repo.append(workflowId, { kind: 'a' });
		repo.append(workflowId, { kind: 'b' });
		repo.append(workflowId, { kind: 'c' });

		expect(repo.list(workflowId, { limit: 2 }).length).toBe(2);
	});

	it('list with since returns only newer entries', async () => {
		const { workflowId, repo } = setup();

		repo.append(workflowId, { kind: 'old' });
		const between = new Date().toISOString();
		// Ensure the next insert gets a strictly greater timestamp.
		await new Promise((resolve) => setTimeout(resolve, 2));
		repo.append(workflowId, { kind: 'new' });

		const withSince = repo.list(workflowId, { since: between });
		expect(withSince.length).toBe(1);
		expect(withSince[0].kind).toBe('new');
	});

	it('payload round-trips as nested JSON', () => {
		const { workflowId, repo } = setup();

		const entry = repo.append(workflowId, {
			kind: 'complex',
			payload: { nested: { array: [1, 2, 3], bool: true, nullVal: null } },
		});

		expect(entry.payload).toEqual({
			nested: { array: [1, 2, 3], bool: true, nullVal: null },
		});
	});

	it('no mutation exports: update, delete, remove not in module', async () => {
		const mod = await import('./chronicle.ts');
		expect('update' in mod).toBe(false);
		expect('delete' in mod).toBe(false);
		expect('remove' in mod).toBe(false);
		expect('patch' in mod).toBe(false);
		expect('replace' in mod).toBe(false);
	});

	it('missing workflow FK throws RepoConstraintViolationError', () => {
		const { repo } = setup();
		expect(() =>
			repo.append('nonexistent-id', { kind: 'orphan' }),
		).toThrow(RepoConstraintViolationError);
	});

	it('getLastN with 5 entries returns 2 most recent', () => {
		const { workflowId, repo } = setup();

		for (let i = 1; i <= 5; i++) {
			repo.append(workflowId, { kind: `e${i}` });
		}

		const last = repo.getLastN(workflowId, 2);
		expect(last.length).toBe(2);
		expect(last.map((e) => e.kind)).toEqual(['e5', 'e4']);
	});
});
