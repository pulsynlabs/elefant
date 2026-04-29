import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database as BunDatabase } from 'bun:sqlite';

import { runMigrations } from '../migrations.ts';
import { applyPragmas } from '../pragmas.ts';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function createDb(): { db: BunDatabase; dbPath: string } {
	const dir = createTempDir('elefant-migrations-db-');
	const dbPath = join(dir, 'db.sqlite');
	const db = new BunDatabase(dbPath, { create: true });
	applyPragmas(db);
	return { db, dbPath };
}

function loadMigration(filename: string): string {
	const path = join(import.meta.dirname, '..', 'migrations', filename);
	return readFileSync(path, 'utf-8');
}

function setupAllMigrations(database: { db: BunDatabase }): void {
	// Apply migrations in order (0001, 0002, 0003, 0004)
	const migration1 = loadMigration('0001_init.sql');
	const migration2 = loadMigration('0002_agent_runs.sql');
	const migration3 = loadMigration('0003_agent_run_messages.sql');
	const migration4 = loadMigration('0004_spec_mode.sql');

	database.db.run(migration1);
	database.db.run(migration2);
	database.db.run(migration3);
	database.db.run(migration4);
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('migration 0004_spec_mode', () => {
	it('applies cleanly and creates spec_workflows table with all expected columns', () => {
		const { db } = createDb();
		setupAllMigrations({ db });

		// Verify table exists
		const tableInfo = db
			.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'spec_workflows'")
			.get() as { name: string } | null;
		expect(tableInfo).not.toBeNull();
		expect(tableInfo!.name).toBe('spec_workflows');

		// Verify all expected columns exist with correct types
		const columns = db.query('PRAGMA table_info(spec_workflows)').all() as Array<{
			name: string;
			type: string;
			notnull: number;
			dflt_value: string | null;
		}>;

		const columnMap = new Map(columns.map((c) => [c.name, c]));

		// Check all required columns exist
		const expectedColumns = [
			{ name: 'id', type: 'TEXT', notnull: 1 },
			{ name: 'project_id', type: 'TEXT', notnull: 1 },
			{ name: 'workflow_id', type: 'TEXT', notnull: 1 },
			{ name: 'mode', type: 'TEXT', notnull: 1 },
			{ name: 'depth', type: 'TEXT', notnull: 1 },
			{ name: 'phase', type: 'TEXT', notnull: 1 },
			{ name: 'status', type: 'TEXT', notnull: 1 },
			{ name: 'autopilot', type: 'INTEGER', notnull: 1 },
			{ name: 'lazy_autopilot', type: 'INTEGER', notnull: 1 },
			{ name: 'spec_locked', type: 'INTEGER', notnull: 1 },
			{ name: 'acceptance_confirmed', type: 'INTEGER', notnull: 1 },
			{ name: 'interview_complete', type: 'INTEGER', notnull: 1 },
			{ name: 'interview_completed_at', type: 'TEXT', notnull: 0 },
			{ name: 'current_wave', type: 'INTEGER', notnull: 1 },
			{ name: 'total_waves', type: 'INTEGER', notnull: 1 },
			{ name: 'is_active', type: 'INTEGER', notnull: 1 },
			{ name: 'last_activity', type: 'TEXT', notnull: 1 },
			{ name: 'created_at', type: 'TEXT', notnull: 1 },
			{ name: 'updated_at', type: 'TEXT', notnull: 1 },
		];

		for (const expected of expectedColumns) {
			const col = columnMap.get(expected.name);
			expect(col, `Column ${expected.name} should exist`).toBeDefined();
			expect(col!.type, `Column ${expected.name} type`).toBe(expected.type);
			expect(col!.notnull, `Column ${expected.name} notnull`).toBe(expected.notnull);
		}

		// Check default values for key columns
		const modeCol = columnMap.get('mode')!;
		expect(modeCol.dflt_value).toBe("'standard'");

		const phaseCol = columnMap.get('phase')!;
		expect(phaseCol.dflt_value).toBe("'idle'");

		const autopilotCol = columnMap.get('autopilot')!;
		expect(autopilotCol.dflt_value).toBe('0');

		db.close();
	});

	it('creates expected indexes on spec_workflows', () => {
		const { db } = createDb();
		setupAllMigrations({ db });

		const indexes = db.query('PRAGMA index_list(spec_workflows)').all() as Array<{
			name: string;
			unique: number;
		}>;

		const indexNames = indexes.map((i) => i.name);

		expect(indexNames).toContain('idx_spec_workflows_project_id');
		expect(indexNames).toContain('idx_spec_workflows_active');

		// Verify the active index is on (project_id, is_active)
		const activeIndexCols = db
			.query('PRAGMA index_info(idx_spec_workflows_active)')
			.all() as Array<{ name: string }>;
		const activeColNames = activeIndexCols.map((c) => c.name);
		expect(activeColNames).toContain('project_id');
		expect(activeColNames).toContain('is_active');

		db.close();
	});

	it('registers version 4 in _migrations table when using runMigrations', () => {
		const { db } = createDb();

		// Use the actual migration runner (not manual SQL) to verify version tracking
		runMigrations(db);

		const migrations = db
			.query('SELECT version FROM _migrations ORDER BY version ASC')
			.all() as Array<{ version: number }>;

		const versions = migrations.map((m) => m.version);
		expect(versions).toContain(4);

		db.close();
	});

	it('enforces FK constraint: inserting without matching project fails', () => {
		const { db } = createDb();
		setupAllMigrations({ db });

		// Enable foreign keys for this test
		db.run('PRAGMA foreign_keys = ON');

		// Try to insert a spec_workflows row without a matching project
		expect(() => {
			db.run(
				`INSERT INTO spec_workflows (
					id, project_id, workflow_id, mode, depth, phase, status
				) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				['wf-123', 'nonexistent-project', 'test-workflow', 'standard', 'standard', 'idle', 'idle'],
			);
		}).toThrow();

		db.close();
	});

	it('enforces UNIQUE constraint on (project_id, workflow_id)', () => {
		const { db } = createDb();
		setupAllMigrations({ db });

		// First, insert a project
		const projectId = crypto.randomUUID();
		db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [
			projectId,
			'Test Project',
			`/tmp/test-${projectId}`,
		]);

		// Insert first workflow
		db.run(
			`INSERT INTO spec_workflows (
				id, project_id, workflow_id, mode, depth, phase, status
			) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			['wf-1', projectId, 'my-workflow', 'standard', 'standard', 'idle', 'idle'],
		);

		// Try to insert second workflow with same (project_id, workflow_id)
		expect(() => {
			db.run(
				`INSERT INTO spec_workflows (
					id, project_id, workflow_id, mode, depth, phase, status
				) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				['wf-2', projectId, 'my-workflow', 'quick', 'shallow', 'discuss', 'plan'],
			);
		}).toThrow();

		db.close();
	});

	it('allows multiple workflows per project with different workflow_ids', () => {
		const { db } = createDb();
		setupAllMigrations({ db });

		// Insert a project
		const projectId = crypto.randomUUID();
		db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [
			projectId,
			'Test Project',
			`/tmp/test-${projectId}`,
		]);

		// Insert multiple workflows with different workflow_ids
		db.run(
			`INSERT INTO spec_workflows (
				id, project_id, workflow_id, mode, depth, phase, status
			) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			['wf-1', projectId, 'workflow-a', 'standard', 'standard', 'idle', 'idle'],
		);

		db.run(
			`INSERT INTO spec_workflows (
				id, project_id, workflow_id, mode, depth, phase, status
			) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			['wf-2', projectId, 'workflow-b', 'quick', 'shallow', 'discuss', 'plan'],
		);

		db.run(
			`INSERT INTO spec_workflows (
				id, project_id, workflow_id, mode, depth, phase, status
			) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			['wf-3', projectId, 'workflow-c', 'comprehensive', 'deep', 'plan', 'research'],
		);

		// Verify all three exist
		const workflows = db
			.query('SELECT workflow_id FROM spec_workflows WHERE project_id = ? ORDER BY workflow_id')
			.all(projectId) as Array<{ workflow_id: string }>;

		expect(workflows).toHaveLength(3);
		expect(workflows[0]!.workflow_id).toBe('workflow-a');
		expect(workflows[1]!.workflow_id).toBe('workflow-b');
		expect(workflows[2]!.workflow_id).toBe('workflow-c');

		db.close();
	});

	it('enforces CHECK constraints on enum-like columns', () => {
		const { db } = createDb();
		setupAllMigrations({ db });

		// Insert a project
		const projectId = crypto.randomUUID();
		db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [
			projectId,
			'Test Project',
			`/tmp/test-${projectId}`,
		]);

		// Valid mode values should work
		for (const mode of ['quick', 'standard', 'comprehensive', 'milestone']) {
			const wfId = `wf-mode-${mode}`;
			db.run(
				`INSERT INTO spec_workflows (
					id, project_id, workflow_id, mode, depth, phase, status
				) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				[wfId, projectId, wfId, mode, 'standard', 'idle', 'idle'],
			);
		}

		// Valid depth values should work
		for (const depth of ['shallow', 'standard', 'deep']) {
			const wfId = `wf-depth-${depth}`;
			db.run(
				`INSERT INTO spec_workflows (
					id, project_id, workflow_id, mode, depth, phase, status
				) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				[wfId, projectId, wfId, 'standard', depth, 'idle', 'idle'],
			);
		}

		// Valid phase values should work
		for (const phase of ['idle', 'discuss', 'plan', 'research', 'specify', 'execute', 'audit', 'accept']) {
			const wfId = `wf-phase-${phase}`;
			db.run(
				`INSERT INTO spec_workflows (
					id, project_id, workflow_id, mode, depth, phase, status
				) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				[wfId, projectId, wfId, 'standard', 'standard', phase, phase === 'idle' ? 'idle' : phase],
			);
		}

		// Invalid mode should fail
		expect(() => {
			db.run(
				`INSERT INTO spec_workflows (
					id, project_id, workflow_id, mode, depth, phase, status
				) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				['wf-invalid', projectId, 'invalid-mode', 'invalid', 'standard', 'idle', 'idle'],
			);
		}).toThrow();

		// Invalid depth should fail
		expect(() => {
			db.run(
				`INSERT INTO spec_workflows (
					id, project_id, workflow_id, mode, depth, phase, status
				) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				['wf-invalid2', projectId, 'invalid-depth', 'standard', 'invalid', 'idle', 'idle'],
			);
		}).toThrow();

		// Invalid phase should fail
		expect(() => {
			db.run(
				`INSERT INTO spec_workflows (
					id, project_id, workflow_id, mode, depth, phase, status
				) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				['wf-invalid3', projectId, 'invalid-phase', 'standard', 'standard', 'invalid', 'idle'],
			);
		}).toThrow();

		db.close();
	});

	it('cascades delete when parent project is deleted', () => {
		const { db } = createDb();
		setupAllMigrations({ db });

		// Insert a project
		const projectId = crypto.randomUUID();
		db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [
			projectId,
			'Test Project',
			`/tmp/test-${projectId}`,
		]);

		// Insert multiple workflows
		db.run(
			`INSERT INTO spec_workflows (id, project_id, workflow_id, mode, depth, phase, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			['wf-1', projectId, 'workflow-a', 'standard', 'standard', 'idle', 'idle'],
		);
		db.run(
			`INSERT INTO spec_workflows (id, project_id, workflow_id, mode, depth, phase, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			['wf-2', projectId, 'workflow-b', 'quick', 'shallow', 'discuss', 'plan'],
		);

		// Verify workflows exist
		let workflows = db
			.query('SELECT COUNT(*) as count FROM spec_workflows WHERE project_id = ?')
			.get(projectId) as { count: number };
		expect(workflows.count).toBe(2);

		// Delete the project
		db.run('DELETE FROM projects WHERE id = ?', [projectId]);

		// Workflows should be cascade deleted
		workflows = db
			.query('SELECT COUNT(*) as count FROM spec_workflows WHERE project_id = ?')
			.get(projectId) as { count: number };
		expect(workflows.count).toBe(0);

		db.close();
	});
});
