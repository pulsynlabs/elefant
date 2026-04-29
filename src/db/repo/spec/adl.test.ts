import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZodError } from 'zod';

import { Database } from '../../database.ts';
import { SpecWorkflowsRepo } from './workflows.ts';
import { SpecAdlRepo } from './adl.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
const databases: Database[] = [];

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-spec-adl-'));
	tempDirs.push(dir);
	return dir;
}

function setup(): { database: Database; workflowId: string; repo: SpecAdlRepo } {
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
		repo: new SpecAdlRepo(database),
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

describe('SpecAdlRepo', () => {
	it('append happy path, all fields', () => {
		const { workflowId, repo } = setup();

		const entry = repo.append(workflowId, {
			type: 'decision',
			title: 'Use SQLite for state',
			body: 'SQLite provides atomic writes and WAL mode.',
			rule: 4,
			files: ['src/state/manager.ts', 'src/db/repo/spec/adl.ts'],
		});

		expect(entry.id.length).toBeGreaterThan(0);
		expect(entry.workflowId).toBe(workflowId);
		expect(entry.type).toBe('decision');
		expect(entry.title).toBe('Use SQLite for state');
		expect(entry.body).toBe('SQLite provides atomic writes and WAL mode.');
		expect(entry.rule).toBe(4);
		expect(entry.files).toEqual(['src/state/manager.ts', 'src/db/repo/spec/adl.ts']);
	});

	it('append with minimal fields defaults body/rule/files', () => {
		const { workflowId, repo } = setup();

		const entry = repo.append(workflowId, {
			type: 'observation',
			title: 'Minimal entry',
		});

		expect(entry.body).toBe('');
		expect(entry.rule).toBeNull();
		expect(entry.files).toEqual([]);
	});

	it('list ordered ASC', () => {
		const { workflowId, repo } = setup();

		repo.append(workflowId, { type: 'decision', title: 'First' });
		repo.append(workflowId, { type: 'observation', title: 'Second' });
		repo.append(workflowId, { type: 'deviation', title: 'Third' });

		const list = repo.list(workflowId);
		expect(list.map((e) => e.title)).toEqual(['First', 'Second', 'Third']);
	});

	it('getLastN returns most recent, ordered DESC, limited', () => {
		const { workflowId, repo } = setup();

		repo.append(workflowId, { type: 'decision', title: 'A' });
		repo.append(workflowId, { type: 'observation', title: 'B' });
		repo.append(workflowId, { type: 'deviation', title: 'C' });
		repo.append(workflowId, { type: 'decision', title: 'D' });

		const last = repo.getLastN(workflowId, 3);
		expect(last.length).toBe(3);
		expect(last.map((e) => e.title)).toEqual(['D', 'C', 'B']);
	});

	it('list with type filter returns only matching entries', () => {
		const { workflowId, repo } = setup();

		repo.append(workflowId, { type: 'decision', title: 'Dec A' });
		repo.append(workflowId, { type: 'observation', title: 'Obs B' });
		repo.append(workflowId, { type: 'decision', title: 'Dec C' });

		const decisions = repo.list(workflowId, { type: 'decision' });
		expect(decisions.length).toBe(2);
		expect(decisions.every((e) => e.type === 'decision')).toBe(true);

		const observations = repo.list(workflowId, { type: 'observation' });
		expect(observations.length).toBe(1);
		expect(observations[0].title).toBe('Obs B');
	});

	it('list with type deviation returns only deviations', () => {
		const { workflowId, repo } = setup();

		repo.append(workflowId, { type: 'decision', title: 'D1' });
		repo.append(workflowId, { type: 'deviation', title: 'Dev1' });
		repo.append(workflowId, { type: 'observation', title: 'O1' });

		const deviations = repo.list(workflowId, { type: 'deviation' });
		expect(deviations.length).toBe(1);
		expect(deviations[0].type).toBe('deviation');
	});

	it('invalid type rejects via Zod before DB write', () => {
		const { workflowId, repo } = setup();

		expect(() =>
			repo.append(workflowId, {
				type: 'invalid' as 'decision',
				title: 'Should fail',
			}),
		).toThrow(ZodError);
	});

	it('files round-trips as JSON array', () => {
		const { workflowId, repo } = setup();

		const entry = repo.append(workflowId, {
			type: 'observation',
			title: 'Files test',
			files: ['a.ts', 'b.ts', 'c.ts'],
		});

		expect(entry.files).toEqual(['a.ts', 'b.ts', 'c.ts']);

		// Verify raw DB storage
		const row = repo['db']
			.query('SELECT files FROM spec_adl_entries WHERE id = ?')
			.get(entry.id) as { files: string };
		expect(JSON.parse(row.files)).toEqual(['a.ts', 'b.ts', 'c.ts']);
	});

	it('no mutation exports: update, delete, remove not in module', async () => {
		const mod = await import('./adl.ts');
		expect('update' in mod).toBe(false);
		expect('delete' in mod).toBe(false);
		expect('remove' in mod).toBe(false);
		expect('patch' in mod).toBe(false);
		expect('replace' in mod).toBe(false);
	});

	it('rule stores and retrieves integer correctly', () => {
		const { workflowId, repo } = setup();

		const e1 = repo.append(workflowId, {
			type: 'deviation',
			title: 'With rule',
			rule: 4,
		});
		expect(e1.rule).toBe(4);

		const e2 = repo.append(workflowId, {
			type: 'observation',
			title: 'No rule',
		});
		expect(e2.rule).toBeNull();
	});
});
