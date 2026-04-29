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
	const dir = createTempDir('elefant-migrations-0005-');
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
	const migration1 = loadMigration('0001_init.sql');
	const migration2 = loadMigration('0002_agent_runs.sql');
	const migration3 = loadMigration('0003_agent_run_messages.sql');
	const migration4 = loadMigration('0004_spec_mode.sql');
	const migration5 = loadMigration('0005_spec_mode_documents.sql');

	database.db.run(migration1);
	database.db.run(migration2);
	database.db.run(migration3);
	database.db.run(migration4);
	database.db.run(migration5);
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('migration 0005_spec_mode_documents', () => {
	// ------------------------------------------------------------------
	// Test 1 — Migration applies cleanly via runMigrations
	// ------------------------------------------------------------------
	it('applies cleanly via runMigrations and registers version 5', () => {
		const { db } = createDb();
		runMigrations(db);

		const migrations = db
			.query('SELECT version FROM _migrations ORDER BY version ASC')
			.all() as Array<{ version: number }>;

		const versions = migrations.map((m) => m.version);
		expect(versions).toContain(5);
		expect(versions).toContain(4);
		expect(versions).toContain(1);

		db.close();
	});

	// ------------------------------------------------------------------
	// Test 2 — All 11 new spec_% tables exist
	// ------------------------------------------------------------------
	it('creates all 11 spec_% tables', () => {
		const { db } = createDb();
		setupAllMigrations({ db });

		const tables = db
			.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'spec_%' ORDER BY name")
			.all() as Array<{ name: string }>;

		const names = tables.map((t) => t.name);

		expect(names).toContain('spec_documents');
		expect(names).toContain('spec_must_haves');
		expect(names).toContain('spec_acceptance_criteria');
		expect(names).toContain('spec_validation_contracts');
		expect(names).toContain('spec_out_of_scope');
		expect(names).toContain('spec_amendments');
		expect(names).toContain('spec_blueprints');
		expect(names).toContain('spec_waves');
		expect(names).toContain('spec_tasks');
		expect(names).toContain('spec_chronicle_entries');
		expect(names).toContain('spec_adl_entries');
		// 11 spec_% tables + spec_workflows (from 0004) = 12 total
		expect(names.length).toBe(12);

		db.close();
	});

	// ------------------------------------------------------------------
	// Test 4 — Verify column lists for each table
	// ------------------------------------------------------------------
	it('has correct columns for each document-chain table', () => {
		const { db } = createDb();
		setupAllMigrations({ db });

		function getColumns(table: string): Map<string, { name: string; type: string; notnull: number }> {
			const cols = db.query(`PRAGMA table_info(${table})`).all() as Array<{
				name: string;
				type: string;
				notnull: number;
			}>;
			return new Map(cols.map((c) => [c.name, c]));
		}

		// spec_documents
		const docCols = getColumns('spec_documents');
		expect(docCols.has('id')).toBe(true);
		expect(docCols.get('id')!.type).toBe('TEXT');
		expect(docCols.get('id')!.notnull).toBe(1);

		expect(docCols.has('workflow_id')).toBe(true);
		expect(docCols.has('doc_type')).toBe(true);
		expect(docCols.has('content_md')).toBe(true);
		expect(docCols.has('version')).toBe(true);
		expect(docCols.has('locked')).toBe(true);
		expect(docCols.has('created_at')).toBe(true);
		expect(docCols.has('updated_at')).toBe(true);

		// spec_must_haves
		const mhCols = getColumns('spec_must_haves');
		expect(mhCols.has('id')).toBe(true);
		expect(mhCols.has('workflow_id')).toBe(true);
		expect(mhCols.has('mh_id')).toBe(true);
		expect(mhCols.has('title')).toBe(true);
		expect(mhCols.has('description')).toBe(true);
		expect(mhCols.has('dependencies')).toBe(true);
		expect(mhCols.has('ordinal')).toBe(true);

		// spec_acceptance_criteria
		const acCols = getColumns('spec_acceptance_criteria');
		expect(acCols.has('id')).toBe(true);
		expect(acCols.has('must_have_id')).toBe(true);
		expect(acCols.has('ac_id')).toBe(true);
		expect(acCols.has('text')).toBe(true);
		expect(acCols.has('ordinal')).toBe(true);

		// spec_validation_contracts
		const vcCols = getColumns('spec_validation_contracts');
		expect(vcCols.has('id')).toBe(true);
		expect(vcCols.has('must_have_id')).toBe(true);
		expect(vcCols.has('vc_id')).toBe(true);
		expect(vcCols.has('text')).toBe(true);
		expect(vcCols.has('severity')).toBe(true);

		// spec_out_of_scope
		const oosCols = getColumns('spec_out_of_scope');
		expect(oosCols.has('item')).toBe(true);
		expect(oosCols.has('reason')).toBe(true);

		// spec_amendments
		const amdCols = getColumns('spec_amendments');
		expect(amdCols.has('version')).toBe(true);
		expect(amdCols.has('prior_state')).toBe(true);
		expect(amdCols.has('new_state')).toBe(true);
		expect(amdCols.has('rationale')).toBe(true);

		// spec_blueprints
		const bpCols = getColumns('spec_blueprints');
		expect(bpCols.has('version')).toBe(true);

		// spec_waves
		const waveCols = getColumns('spec_waves');
		expect(waveCols.has('blueprint_id')).toBe(true);
		expect(waveCols.has('wave_number')).toBe(true);
		expect(waveCols.has('name')).toBe(true);
		expect(waveCols.has('goal')).toBe(true);
		expect(waveCols.has('parallel')).toBe(true);

		// spec_tasks
		const taskCols = getColumns('spec_tasks');
		expect(taskCols.has('task_id')).toBe(true);
		expect(taskCols.has('executor')).toBe(true);
		expect(taskCols.has('files')).toBe(true);
		expect(taskCols.has('action')).toBe(true);
		expect(taskCols.has('done')).toBe(true);
		expect(taskCols.has('verify')).toBe(true);
		expect(taskCols.has('status')).toBe(true);
		expect(taskCols.has('agent_run_id')).toBe(true);
		expect(taskCols.has('started_at')).toBe(true);
		expect(taskCols.has('completed_at')).toBe(true);

		// spec_chronicle_entries
		const chrCols = getColumns('spec_chronicle_entries');
		expect(chrCols.has('kind')).toBe(true);
		expect(chrCols.has('payload')).toBe(true);

		// spec_adl_entries
		const adlCols = getColumns('spec_adl_entries');
		expect(adlCols.has('type')).toBe(true);
		expect(adlCols.has('title')).toBe(true);
		expect(adlCols.has('body')).toBe(true);
		expect(adlCols.has('rule')).toBe(true);
		expect(adlCols.has('files')).toBe(true);

		db.close();
	});

	// ------------------------------------------------------------------
	// Test 5 — UNIQUE constraints enforced
	// ------------------------------------------------------------------
	it('enforces UNIQUE constraints on document tables', () => {
		const { db } = createDb();
		setupAllMigrations({ db });

		const projectId = crypto.randomUUID();
		db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [
			projectId,
			'Test Project',
			`/tmp/test-${projectId}`,
		]);

		const wfId = crypto.randomUUID();
		const workflowId = 'uniq-test-workflow';
		db.run(
			`INSERT INTO spec_workflows (id, project_id, workflow_id, mode, depth, phase, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[wfId, projectId, workflowId, 'standard', 'standard', 'idle', 'idle'],
		);

		// spec_documents: UNIQUE(workflow_id, doc_type)
		db.run(
			'INSERT INTO spec_documents (id, workflow_id, doc_type) VALUES (?, ?, ?)',
			[crypto.randomUUID(), wfId, 'SPEC'],
		);
		expect(() => {
			db.run(
				'INSERT INTO spec_documents (id, workflow_id, doc_type) VALUES (?, ?, ?)',
				[crypto.randomUUID(), wfId, 'SPEC'],
			);
		}).toThrow();

		// spec_must_haves: UNIQUE(workflow_id, mh_id)
		db.run(
			'INSERT INTO spec_must_haves (id, workflow_id, mh_id, title, description, ordinal) VALUES (?, ?, ?, ?, ?, ?)',
			[crypto.randomUUID(), wfId, 'MH1', 'Test MH', 'A test must-have', 1],
		);
		expect(() => {
			db.run(
				'INSERT INTO spec_must_haves (id, workflow_id, mh_id, title, description, ordinal) VALUES (?, ?, ?, ?, ?, ?)',
				[crypto.randomUUID(), wfId, 'MH1', 'Dup', 'Duplicate', 2],
			);
		}).toThrow();

		// spec_amendments: UNIQUE(workflow_id, version)
		db.run(
			'INSERT INTO spec_amendments (id, workflow_id, version, prior_state, new_state, rationale) VALUES (?, ?, ?, ?, ?, ?)',
			[crypto.randomUUID(), wfId, 1, '{}', '{}', 'test'],
		);
		expect(() => {
			db.run(
				'INSERT INTO spec_amendments (id, workflow_id, version, prior_state, new_state, rationale) VALUES (?, ?, ?, ?, ?, ?)',
				[crypto.randomUUID(), wfId, 1, '{}', '{}', 'dup'],
			);
		}).toThrow();

		// spec_blueprints: UNIQUE(workflow_id, version)
		db.run(
			'INSERT INTO spec_blueprints (id, workflow_id, version) VALUES (?, ?, ?)',
			[crypto.randomUUID(), wfId, 1],
		);
		expect(() => {
			db.run(
				'INSERT INTO spec_blueprints (id, workflow_id, version) VALUES (?, ?, ?)',
				[crypto.randomUUID(), wfId, 1],
			);
		}).toThrow();

		// spec_waves: UNIQUE(blueprint_id, wave_number)
		const bpId = crypto.randomUUID();
		db.run('INSERT INTO spec_blueprints (id, workflow_id, version) VALUES (?, ?, ?)', [bpId, wfId, 2]);
		db.run(
			'INSERT INTO spec_waves (id, blueprint_id, wave_number, name, ordinal) VALUES (?, ?, ?, ?, ?)',
			[crypto.randomUUID(), bpId, 1, 'Wave 1', 1],
		);
		expect(() => {
			db.run(
				'INSERT INTO spec_waves (id, blueprint_id, wave_number, name, ordinal) VALUES (?, ?, ?, ?, ?)',
				[crypto.randomUUID(), bpId, 1, 'Dup Wave', 2],
			);
		}).toThrow();

		// spec_tasks: UNIQUE(wave_id, task_id)
		const waveId = crypto.randomUUID();
		db.run(
			'INSERT INTO spec_waves (id, blueprint_id, wave_number, name, ordinal) VALUES (?, ?, ?, ?, ?)',
			[waveId, bpId, 2, 'Wave 2', 2],
		);
		db.run(
			`INSERT INTO spec_tasks (id, wave_id, task_id, name, executor, action, done, ordinal)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[crypto.randomUUID(), waveId, '1.1', 'Test Task', 'goop-executor-low', 'do it', 'it works', 1],
		);
		expect(() => {
			db.run(
				`INSERT INTO spec_tasks (id, wave_id, task_id, name, executor, action, done, ordinal)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[crypto.randomUUID(), waveId, '1.1', 'Dup Task', 'goop-executor-low', 'do it', 'it works', 2],
			);
		}).toThrow();

		// spec_acceptance_criteria: UNIQUE(must_have_id, ac_id)
		const mhId = crypto.randomUUID();
		db.run(
			'INSERT INTO spec_must_haves (id, workflow_id, mh_id, title, description, ordinal) VALUES (?, ?, ?, ?, ?, ?)',
			[mhId, wfId, 'MH2', 'Second MH', 'Another', 2],
		);
		db.run(
			'INSERT INTO spec_acceptance_criteria (id, must_have_id, ac_id, text, ordinal) VALUES (?, ?, ?, ?, ?)',
			[crypto.randomUUID(), mhId, 'AC1.1', 'Some criteria', 1],
		);
		expect(() => {
			db.run(
				'INSERT INTO spec_acceptance_criteria (id, must_have_id, ac_id, text, ordinal) VALUES (?, ?, ?, ?, ?)',
				[crypto.randomUUID(), mhId, 'AC1.1', 'Duplicate criteria', 2],
			);
		}).toThrow();

		// spec_validation_contracts: UNIQUE(must_have_id, vc_id)
		db.run(
			'INSERT INTO spec_validation_contracts (id, must_have_id, vc_id, text, ordinal) VALUES (?, ?, ?, ?, ?)',
			[crypto.randomUUID(), mhId, 'VC1.A', 'Contract assertion', 1],
		);
		expect(() => {
			db.run(
				'INSERT INTO spec_validation_contracts (id, must_have_id, vc_id, text, ordinal) VALUES (?, ?, ?, ?, ?)',
				[crypto.randomUUID(), mhId, 'VC1.A', 'Duplicate contract', 2],
			);
		}).toThrow();

		db.close();
	});

	// ------------------------------------------------------------------
	// Test 6 — CHECK constraints enforced
	// ------------------------------------------------------------------
	it('enforces CHECK constraints on enum-like columns', () => {
		const { db } = createDb();
		setupAllMigrations({ db });

		const projectId = crypto.randomUUID();
		db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [
			projectId,
			'Test Project',
			`/tmp/test-${projectId}`,
		]);

		const wfId = crypto.randomUUID();
		db.run(
			`INSERT INTO spec_workflows (id, project_id, workflow_id, mode, depth, phase, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[wfId, projectId, 'check-test-wf', 'standard', 'standard', 'idle', 'idle'],
		);

		// --- doc_type CHECK on spec_documents ---
		const validDocTypes = ['REQUIREMENTS', 'SPEC', 'BLUEPRINT', 'CHRONICLE', 'ADL'] as const;
		for (const dt of validDocTypes) {
			db.run('INSERT INTO spec_documents (id, workflow_id, doc_type) VALUES (?, ?, ?)', [
				crypto.randomUUID(),
				wfId,
				dt,
			]);
		}
		expect(() => {
			db.run('INSERT INTO spec_documents (id, workflow_id, doc_type) VALUES (?, ?, ?)', [
				crypto.randomUUID(),
				wfId,
				'INVALID_TYPE',
			]);
		}).toThrow();

		// --- executor CHECK on spec_tasks ---
		const bpId = crypto.randomUUID();
		db.run('INSERT INTO spec_blueprints (id, workflow_id, version) VALUES (?, ?, ?)', [bpId, wfId, 1]);
		const validWaveId = crypto.randomUUID();
		db.run(
			'INSERT INTO spec_waves (id, blueprint_id, wave_number, name, ordinal) VALUES (?, ?, ?, ?, ?)',
			[validWaveId, bpId, 1, 'Valid Wave', 1],
		);

		const validExecutors = [
			'goop-executor-low',
			'goop-executor-medium',
			'goop-executor-high',
			'goop-executor-frontend',
		] as const;
		for (const exec of validExecutors) {
			db.run(
				`INSERT INTO spec_tasks (id, wave_id, task_id, name, executor, action, done, ordinal)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[crypto.randomUUID(), validWaveId, `task-${exec}`, 'Test', exec, 'do', 'done', 1],
			);
		}
		expect(() => {
			db.run(
				`INSERT INTO spec_tasks (id, wave_id, task_id, name, executor, action, done, ordinal)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[crypto.randomUUID(), validWaveId, 'bad-exec', 'Bad', 'INVALID_EXEC', 'do', 'done', 99],
			);
		}).toThrow();

		// --- severity CHECK on spec_validation_contracts ---
		const mhId = crypto.randomUUID();
		db.run(
			'INSERT INTO spec_must_haves (id, workflow_id, mh_id, title, description, ordinal) VALUES (?, ?, ?, ?, ?, ?)',
			[mhId, wfId, 'MH-CHECK', 'Check MH', 'Desc', 1],
		);
		const validSeverities = ['must', 'should', 'may'] as const;
		for (const sev of validSeverities) {
			db.run(
				'INSERT INTO spec_validation_contracts (id, must_have_id, vc_id, text, severity, ordinal) VALUES (?, ?, ?, ?, ?, ?)',
				[crypto.randomUUID(), mhId, `VC-${sev}`, 'Assertion', sev, 1],
			);
		}
		expect(() => {
			db.run(
				'INSERT INTO spec_validation_contracts (id, must_have_id, vc_id, text, severity, ordinal) VALUES (?, ?, ?, ?, ?, ?)',
				[crypto.randomUUID(), mhId, 'VC-BAD', 'Bad', 'CRITICAL', 99],
			);
		}).toThrow();

		// --- status CHECK on spec_tasks ---
		const validStatuses = ['pending', 'in_progress', 'complete', 'blocked', 'skipped'] as const;
		for (const st of validStatuses) {
			db.run(
				`INSERT INTO spec_tasks (id, wave_id, task_id, name, executor, action, done, status, ordinal)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					crypto.randomUUID(),
					validWaveId,
					`status-${st}`,
					'Test',
					'goop-executor-low',
					'do',
					'done',
					st,
					99,
				],
			);
		}
		expect(() => {
			db.run(
				`INSERT INTO spec_tasks (id, wave_id, task_id, name, executor, action, done, status, ordinal)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					crypto.randomUUID(),
					validWaveId,
					'bad-status',
					'Bad',
					'goop-executor-low',
					'do',
					'done',
					'INVALID_STATUS',
					99,
				],
			);
		}).toThrow();

		// --- type CHECK on spec_adl_entries ---
		const validAdlTypes = ['decision', 'deviation', 'observation'] as const;
		for (const t of validAdlTypes) {
			db.run(
				`INSERT INTO spec_adl_entries (id, workflow_id, type, title, body)
				 VALUES (?, ?, ?, ?, ?)`,
				[crypto.randomUUID(), wfId, t, `Entry ${t}`, 'Body'],
			);
		}
		expect(() => {
			db.run(
				`INSERT INTO spec_adl_entries (id, workflow_id, type, title, body)
				 VALUES (?, ?, ?, ?, ?)`,
				[crypto.randomUUID(), wfId, 'INVALID_TYPE', 'Bad', 'Body'],
			);
		}).toThrow();

		db.close();
	});

	// ------------------------------------------------------------------
	// Test 7 — CASCADE delete: workflow → documents
	// ------------------------------------------------------------------
	it('cascades delete from spec_workflows to spec_documents', () => {
		const { db } = createDb();
		setupAllMigrations({ db });

		const projectId = crypto.randomUUID();
		db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [
			projectId,
			'Test Project',
			`/tmp/test-${projectId}`,
		]);

		const wfId = crypto.randomUUID();
		db.run(
			`INSERT INTO spec_workflows (id, project_id, workflow_id, mode, depth, phase, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[wfId, projectId, 'cascade-test', 'standard', 'standard', 'idle', 'idle'],
		);

		// Insert a spec_documents row referencing the workflow
		const docId = crypto.randomUUID();
		db.run(
			'INSERT INTO spec_documents (id, workflow_id, doc_type, content_md) VALUES (?, ?, ?, ?)',
			[docId, wfId, 'SPEC', '# Test Spec\n\nContent here.'],
		);

		// Insert a spec_must_haves row
		db.run(
			'INSERT INTO spec_must_haves (id, workflow_id, mh_id, title, description, ordinal) VALUES (?, ?, ?, ?, ?, ?)',
			[crypto.randomUUID(), wfId, 'MH1', 'Test', 'Description', 1],
		);

		// Verify they exist
		let docCount = db
			.query('SELECT COUNT(*) as count FROM spec_documents WHERE workflow_id = ?')
			.get(wfId) as { count: number };
		expect(docCount.count).toBe(1);

		let mhCount = db
			.query('SELECT COUNT(*) as count FROM spec_must_haves WHERE workflow_id = ?')
			.get(wfId) as { count: number };
		expect(mhCount.count).toBe(1);

		// Delete the workflow
		db.run('DELETE FROM spec_workflows WHERE id = ?', [wfId]);

		// Both should be cascade-deleted
		docCount = db
			.query('SELECT COUNT(*) as count FROM spec_documents WHERE workflow_id = ?')
			.get(wfId) as { count: number };
		expect(docCount.count).toBe(0);

		mhCount = db
			.query('SELECT COUNT(*) as count FROM spec_must_haves WHERE workflow_id = ?')
			.get(wfId) as { count: number };
		expect(mhCount.count).toBe(0);

		db.close();
	});

	// ------------------------------------------------------------------
	// Test 8 — RESTRICT delete on chronicle and ADL entries
	// ------------------------------------------------------------------
	it('restricts delete of workflows with chronicle or ADL entries', () => {
		const { db } = createDb();
		setupAllMigrations({ db });

		const projectId = crypto.randomUUID();
		db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [
			projectId,
			'Test Project',
			`/tmp/test-${projectId}`,
		]);

		const wfId = crypto.randomUUID();
		db.run(
			`INSERT INTO spec_workflows (id, project_id, workflow_id, mode, depth, phase, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[wfId, projectId, 'restrict-test', 'standard', 'standard', 'idle', 'idle'],
		);

		// Insert a chronicle entry
		const chrId = crypto.randomUUID();
		db.run(
			'INSERT INTO spec_chronicle_entries (id, workflow_id, kind, payload) VALUES (?, ?, ?, ?)',
			[chrId, wfId, 'phase_transition', '{"from":"idle","to":"discuss"}'],
		);

		// Attempt to delete the workflow — should fail due to ON DELETE RESTRICT
		expect(() => {
			db.run('DELETE FROM spec_workflows WHERE id = ?', [wfId]);
		}).toThrow();

		// Verify both still exist
		const wf = db
			.query('SELECT id FROM spec_workflows WHERE id = ?')
			.get(wfId) as { id: string } | null;
		expect(wf).not.toBeNull();

		const chr = db
			.query('SELECT id FROM spec_chronicle_entries WHERE id = ?')
			.get(chrId) as { id: string } | null;
		expect(chr).not.toBeNull();

		// Same test for ADL entries
		const adlId = crypto.randomUUID();
		db.run(
			`INSERT INTO spec_adl_entries (id, workflow_id, type, title, body)
			 VALUES (?, ?, ?, ?, ?)`,
			[adlId, wfId, 'decision', 'Architecture Decision', 'Chose X over Y'],
		);

		expect(() => {
			db.run('DELETE FROM spec_workflows WHERE id = ?', [wfId]);
		}).toThrow();

		const adl = db
			.query('SELECT id FROM spec_adl_entries WHERE id = ?')
			.get(adlId) as { id: string } | null;
		expect(adl).not.toBeNull();

		// Now delete the chronicle and ADL entries, then workflow deletion should succeed
		db.run('DELETE FROM spec_chronicle_entries WHERE id = ?', [chrId]);
		db.run('DELETE FROM spec_adl_entries WHERE id = ?', [adlId]);
		db.run('DELETE FROM spec_workflows WHERE id = ?', [wfId]);

		const wfAfter = db
			.query('SELECT id FROM spec_workflows WHERE id = ?')
			.get(wfId) as { id: string } | null;
		expect(wfAfter).toBeNull();

		db.close();
	});

	// ------------------------------------------------------------------
	// Test 9 — JSON column round-trip (spec_tasks.files)
	// ------------------------------------------------------------------
	it('round-trips JSON columns correctly', () => {
		const { db } = createDb();
		setupAllMigrations({ db });

		const projectId = crypto.randomUUID();
		db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [
			projectId,
			'Test Project',
			`/tmp/test-${projectId}`,
		]);

		const wfId = crypto.randomUUID();
		db.run(
			`INSERT INTO spec_workflows (id, project_id, workflow_id, mode, depth, phase, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[wfId, projectId, 'json-test', 'standard', 'standard', 'idle', 'idle'],
		);

		const bpId = crypto.randomUUID();
		db.run('INSERT INTO spec_blueprints (id, workflow_id, version) VALUES (?, ?, ?)', [bpId, wfId, 1]);

		const waveId = crypto.randomUUID();
		db.run(
			'INSERT INTO spec_waves (id, blueprint_id, wave_number, name, ordinal) VALUES (?, ?, ?, ?, ?)',
			[waveId, bpId, 1, 'JSON Wave', 1],
		);

		const expectedFiles = JSON.stringify([
			'src/db/migrations/0005_spec_mode_documents.sql',
			'src/db/migrations/0005.test.ts',
		]);

		const taskId = crypto.randomUUID();
		db.run(
			`INSERT INTO spec_tasks (id, wave_id, task_id, name, executor, files, action, done, ordinal)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[taskId, waveId, '1.1', 'JSON Task', 'goop-executor-medium', expectedFiles, 'do it', 'done', 1],
		);

		// Read back and parse
		const row = db
			.query('SELECT files FROM spec_tasks WHERE id = ?')
			.get(taskId) as { files: string };

		const parsed: string[] = JSON.parse(row.files);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed).toHaveLength(2);
		expect(parsed[0]).toBe('src/db/migrations/0005_spec_mode_documents.sql');
		expect(parsed[1]).toBe('src/db/migrations/0005.test.ts');

		db.close();
	});
});
