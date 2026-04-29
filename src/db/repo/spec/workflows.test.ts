import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Database } from '../../database.ts';
import {
	WorkflowExistsError,
	WorkflowNotFoundError,
} from '../../../state/errors.ts';
import { SpecWorkflowSchema } from '../../../state/schema.ts';
import {
	RowNotFoundError,
	InvalidTableError,
	RepoConstraintViolationError,
	mapSqliteError,
} from './base.ts';
import { SpecWorkflowsRepo } from './workflows.ts';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
const databases: Database[] = [];

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-spec-repo-'));
	tempDirs.push(dir);
	return dir;
}

function createRepo(): { database: Database; projectId: string; repo: SpecWorkflowsRepo } {
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

	const repo = new SpecWorkflowsRepo(database);
	return { database, projectId, repo };
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

describe('SpecWorkflowsRepo', () => {
	// 1. create happy path
	it('create inserts a row and returns a validated SpecWorkflow with defaults', () => {
		const { projectId, repo } = createRepo();

		const workflow = repo.create({ projectId, workflowId: 'test-flow' });

		// Validate against the Zod schema
		expect(() => SpecWorkflowSchema.parse(workflow)).not.toThrow();
		expect(workflow.id.length).toBeGreaterThan(0);
		expect(workflow.projectId).toBe(projectId);
		expect(workflow.workflowId).toBe('test-flow');

		// Defaults
		expect(workflow.mode).toBe('standard');
		expect(workflow.depth).toBe('standard');
		expect(workflow.phase).toBe('idle');
		expect(workflow.status).toBe('idle');
		expect(workflow.autopilot).toBe(false);
		expect(workflow.lazyAutopilot).toBe(false);
		expect(workflow.specLocked).toBe(false);
		expect(workflow.acceptanceConfirmed).toBe(false);
		expect(workflow.interviewComplete).toBe(false);
		expect(workflow.interviewCompletedAt).toBeNull();
		expect(workflow.currentWave).toBe(0);
		expect(workflow.totalWaves).toBe(0);
		expect(workflow.isActive).toBe(false);

		// Timestamps
		expect(workflow.lastActivity.length).toBeGreaterThan(0);
		expect(workflow.createdAt.length).toBeGreaterThan(0);
		expect(workflow.updatedAt.length).toBeGreaterThan(0);
	});

	// 2. create duplicate
	it('create rejects duplicates with WorkflowExistsError', () => {
		const { projectId, repo } = createRepo();

		repo.create({ projectId, workflowId: 'flow-a' });

		expect(() =>
			repo.create({ projectId, workflowId: 'flow-a' }),
		).toThrow(WorkflowExistsError);

		// The error should carry structured fields
		try {
			repo.create({ projectId, workflowId: 'flow-a' });
		} catch (err) {
			expect(err).toBeInstanceOf(WorkflowExistsError);
			const typed = err as WorkflowExistsError;
			expect(typed.projectId).toBe(projectId);
			expect(typed.workflowId).toBe('flow-a');
		}
	});

	// 3. create with missing project (FK violation)
	it('create wraps FK violations in RepoConstraintViolationError', () => {
		const { database, repo } = createRepo();

		// Enable foreign keys — bun:sqlite defaults to OFF unless PRAGMA is run
		database.db.run('PRAGMA foreign_keys = ON');

		expect(() =>
			repo.create({ projectId: 'nonexistent-project-id', workflowId: 'flow-a' }),
		).toThrow(RepoConstraintViolationError);
	});

	// 4. get returns null for missing
	it('get returns null for a missing workflow', () => {
		const { projectId, repo } = createRepo();

		expect(repo.get(projectId, 'missing')).toBeNull();
	});

	// 5. get returns the inserted row
	it('get returns the inserted workflow', () => {
		const { projectId, repo } = createRepo();

		const created = repo.create({ projectId, workflowId: 'my-workflow' });
		const found = repo.get(projectId, 'my-workflow');

		expect(found).not.toBeNull();
		expect(found!.id).toBe(created.id);
		expect(found!.workflowId).toBe('my-workflow');
	});

	// 6. getById returns the row
	it('getById returns the workflow by primary key', () => {
		const { projectId, repo } = createRepo();

		const created = repo.create({ projectId, workflowId: 'flow-b' });
		const found = repo.getById(created.id);

		expect(found).not.toBeNull();
		expect(found!.id).toBe(created.id);
	});

	it('getById returns null for a missing uuid', () => {
		const { repo } = createRepo();
		expect(repo.getById(crypto.randomUUID())).toBeNull();
	});

	// 7. list orders by last_activity DESC
	it('list returns workflows ordered by last_activity descending', () => {
		const { database, projectId, repo } = createRepo();

		// Create two workflows then set explicit timestamps for determinism
		const old = repo.create({ projectId, workflowId: 'old' });
		const newer = repo.create({ projectId, workflowId: 'newer' });

		// Force deterministic timestamps
		database.db.run(
			'UPDATE spec_workflows SET last_activity = ? WHERE id = ?',
			['2026-01-01T00:00:00.000Z', old.id],
		);
		database.db.run(
			'UPDATE spec_workflows SET last_activity = ? WHERE id = ?',
			['2026-01-02T00:00:00.000Z', newer.id],
		);

		const workflows = repo.list(projectId);
		expect(workflows.map((w) => w.workflowId)).toEqual(['newer', 'old']);
	});

	// 8. update modifies provided fields
	it('update modifies only provided fields and bumps timestamps', async () => {
		const { projectId, repo } = createRepo();

		const created = repo.create({
			projectId,
			workflowId: 'flow-c',
			mode: 'quick',
			depth: 'shallow',
		});

		// Small delay so updated timestamps are detectably different
		await new Promise((r) => setTimeout(r, 10));

		const updated = repo.update(created.id, {
			mode: 'comprehensive',
			currentWave: 3,
		});

		// Changed fields
		expect(updated.mode).toBe('comprehensive');
		expect(updated.currentWave).toBe(3);

		// Unchanged fields preserved
		expect(updated.depth).toBe('shallow');
		expect(updated.phase).toBe('idle');
		expect(updated.workflowId).toBe('flow-c');

		// Timestamps bumped
		expect(updated.updatedAt).not.toBe(created.updatedAt);
		expect(updated.lastActivity).not.toBe(created.lastActivity);
	});

	// 9. update non-existent id
	it('update throws RowNotFoundError for non-existent id', () => {
		const { repo } = createRepo();

		expect(() =>
			repo.update(crypto.randomUUID(), { mode: 'quick' }),
		).toThrow(RowNotFoundError);
	});

	// 10. delete removes the row
	it('delete removes the row and subsequent get returns null', () => {
		const { projectId, repo } = createRepo();

		const created = repo.create({ projectId, workflowId: 'to-delete' });
		expect(repo.getById(created.id)).not.toBeNull();

		repo.delete(created.id);

		expect(repo.getById(created.id)).toBeNull();
		expect(repo.get(projectId, 'to-delete')).toBeNull();
	});

	// 11. delete non-existent id
	it('delete throws RowNotFoundError for non-existent id', () => {
		const { repo } = createRepo();

		expect(() => repo.delete(crypto.randomUUID())).toThrow(RowNotFoundError);
	});

	// 12. delete with chronicle entries (RESTRICT FK)
	it('delete of a workflow with chronicle entries throws', () => {
		const { database, projectId, repo } = createRepo();

		const created = repo.create({ projectId, workflowId: 'with-chronicle' });

		// Manually insert a chronicle entry to trigger RESTRICT FK
		database.db.run(
			'INSERT INTO spec_chronicle_entries (id, workflow_id, kind) VALUES (?, ?, ?)',
			[crypto.randomUUID(), created.id, 'phase_transition'],
		);

		expect(() => repo.delete(created.id)).toThrow();
	});

	// 13. setActive sets exactly one active row
	it('setActive deactivates others and activates the target', () => {
		const { projectId, repo } = createRepo();

		const a = repo.create({ projectId, workflowId: 'flow-a' });
		const b = repo.create({ projectId, workflowId: 'flow-b' });

		repo.setActive(projectId, 'flow-a');
		expect(repo.getById(a.id)!.isActive).toBe(true);
		expect(repo.getById(b.id)!.isActive).toBe(false);

		repo.setActive(projectId, 'flow-b');
		expect(repo.getById(a.id)!.isActive).toBe(false);
		expect(repo.getById(b.id)!.isActive).toBe(true);
	});

	// 14. setActive non-existent target -> rollback
	it('setActive with non-existent target throws WorkflowNotFoundError and rolls back', () => {
		const { projectId, repo } = createRepo();

		const a = repo.create({ projectId, workflowId: 'flow-a', isActive: true });

		expect(() => repo.setActive(projectId, 'nonexistent')).toThrow(
			WorkflowNotFoundError,
		);

		// flow-a should still be active (transaction rolled back)
		expect(repo.getById(a.id)!.isActive).toBe(true);
	});

	// 15. getActive
	it('getActive returns null when none are active, and the active row when one is', () => {
		const { projectId, repo } = createRepo();

		expect(repo.getActive(projectId)).toBeNull();

		repo.create({ projectId, workflowId: 'flow-a', isActive: true });
		repo.create({ projectId, workflowId: 'flow-b', isActive: false });

		const active = repo.getActive(projectId);
		expect(active).not.toBeNull();
		expect(active!.workflowId).toBe('flow-a');
	});

	// 16. assertWorkflowExists
	it('assertWorkflowExists throws RowNotFoundError for unknown workflow', () => {
		const { repo } = createRepo();

		expect(() => repo.assertWorkflowExists('nonexistent')).toThrow(
			RowNotFoundError,
		);
	});

	it('assertWorkflowExists succeeds for a known workflow', () => {
		const { projectId, repo } = createRepo();

		repo.create({ projectId, workflowId: 'exists' });

		// Should not throw
		expect(() => repo.assertWorkflowExists('exists')).not.toThrow();
	});

	// 17. Transaction rollback sanity
	it('withTransaction rolls back on thrown error', () => {
		const { projectId, repo } = createRepo();

		expect(() =>
			repo.withTransaction(() => {
				repo.create({ projectId, workflowId: 'txn-rollback', mode: 'quick' });
				throw new Error('boom');
			}),
		).toThrow('boom');

		// The workflow created inside the rolled-back transaction must NOT exist
		expect(repo.get(projectId, 'txn-rollback')).toBeNull();
	});

	// 18. mapSqliteError unit test
	it('mapSqliteError wraps UNIQUE errors', () => {
		const err = new Error('UNIQUE constraint failed: spec_workflows.project_id, spec_workflows.workflow_id');
		const result = mapSqliteError(err, { operation: 'insert', table: 'spec_workflows' });

		expect(result).toBeInstanceOf(RepoConstraintViolationError);
		expect((result as RepoConstraintViolationError).code).toBe('REPO_CONSTRAINT_VIOLATION');
		expect(result.message).toContain('UNIQUE');
		expect(result.message).toContain('insert');
	});

	it('mapSqliteError wraps FOREIGN KEY errors', () => {
		const err = new Error('FOREIGN KEY constraint failed');
		const result = mapSqliteError(err, { operation: 'insert', table: 'spec_workflows' });

		expect(result).toBeInstanceOf(RepoConstraintViolationError);
		expect(result.message).toContain('FOREIGN KEY');
	});

	it('mapSqliteError passes through generic errors unchanged', () => {
		const err = new Error('some random error');
		const result = mapSqliteError(err, { operation: 'read', table: 'spec_workflows' });

		expect(result).toBe(err); // Same reference — pass-through
	});

	it('mapSqliteError handles non-Error throws', () => {
		const result = mapSqliteError('string error', { operation: 'read', table: 'spec_workflows' });
		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('string error');
	});
});

describe('BaseRepo', () => {
	// assertExists table-name validation
	it('assertExists rejects invalid table names', () => {
		const { repo } = createRepo();
		expect(() =>
			repo.assertExists('injection_DROP_TABLE_spec_workflows__', 'x'),
		).toThrow(InvalidTableError);
	});

	it('assertExists rejects tables not in the whitelist', () => {
		const { repo } = createRepo();
		expect(() => repo.assertExists('some_unknown_table', 'x')).toThrow(InvalidTableError);
	});

	it('assertExists rejects invalid column names', () => {
		const { repo } = createRepo();
		expect(() =>
			repo.assertExists('spec_workflows', 'x', { idColumn: '1; DROP TABLE' }),
		).toThrow(InvalidTableError);
	});
});
