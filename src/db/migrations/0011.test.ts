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
	const dir = createTempDir('elefant-migrations-0011-');
	const dbPath = join(dir, 'db.sqlite');
	const db = new BunDatabase(dbPath, { create: true });
	applyPragmas(db);
	return { db, dbPath };
}

function loadMigration(filename: string): string {
	const path = join(import.meta.dirname, filename);
	return readFileSync(path, 'utf-8');
}

function setupAllMigrations(database: { db: BunDatabase }): void {
	database.db.run(loadMigration('0001_init.sql'));
	database.db.run(loadMigration('0002_agent_runs.sql'));
	database.db.run(loadMigration('0003_agent_run_messages.sql'));
	database.db.run(loadMigration('0004_spec_mode.sql'));
	database.db.run(loadMigration('0005_spec_mode_documents.sql'));
	database.db.run(loadMigration('0006_spec_idempotency.sql'));
	database.db.run(loadMigration('0007_agent_profile_extended.sql'));
	database.db.run(loadMigration('0008_project_settings.sql'));
	database.db.run(loadMigration('0009_orchestrator_prompt.sql'));
	database.db.run(loadMigration('0010_rename_spec_locked.sql'));
	database.db.run(loadMigration('0011_session_mode.sql'));
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('migration 0011_session_mode', () => {
	it('applies cleanly via runMigrations and registers version 11', () => {
		const { db } = createDb();
		runMigrations(db);

		const migrations = db
			.query('SELECT version FROM _migrations ORDER BY version ASC')
			.all() as Array<{ version: number }>;

		const versions = migrations.map((m) => m.version);
		expect(versions).toContain(11);
		expect(versions).toContain(10);
		expect(versions).toContain(1);

		db.close();
	});

	it('adds mode column to sessions table with correct type and constraints', () => {
		const { db } = createDb();
		setupAllMigrations({ db });

		const cols = db.query('PRAGMA table_info(sessions)').all() as Array<{
			name: string;
			type: string;
			notnull: number;
			dflt_value: string | null;
		}>;

		const modeCol = cols.find((c) => c.name === 'mode');
		expect(modeCol).not.toBeUndefined();
		expect(modeCol!.type).toBe('TEXT');
		expect(modeCol!.notnull).toBe(1);
		expect(modeCol!.dflt_value).toBe("'quick'");

		db.close();
	});

	it('defaults existing session rows to mode=quick before migration is applied', () => {
		const { db } = createDb();

		// Apply all migrations EXCEPT 0011
		db.run(loadMigration('0001_init.sql'));
		db.run(loadMigration('0002_agent_runs.sql'));
		db.run(loadMigration('0003_agent_run_messages.sql'));
		db.run(loadMigration('0004_spec_mode.sql'));
		db.run(loadMigration('0005_spec_mode_documents.sql'));
		db.run(loadMigration('0006_spec_idempotency.sql'));
		db.run(loadMigration('0007_agent_profile_extended.sql'));
		db.run(loadMigration('0008_project_settings.sql'));
		db.run(loadMigration('0009_orchestrator_prompt.sql'));
		db.run(loadMigration('0010_rename_spec_locked.sql'));

		const projectId = crypto.randomUUID();
		db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [
			projectId,
			'Test Project',
			`/tmp/test-${projectId}`,
		]);

		const sessionId = crypto.randomUUID();
		db.run(
			'INSERT INTO sessions (id, project_id, phase, status) VALUES (?, ?, ?, ?)',
			[sessionId, projectId, 'idle', 'pending'],
		);

		// Before migration: no mode column exists yet
		expect(() => db.query('SELECT mode FROM sessions WHERE id = ?').get(sessionId)).toThrow();

		// Apply the migration
		db.run(loadMigration('0011_session_mode.sql'));

		// After migration: mode column exists and defaults to 'quick'
		const row = db.query('SELECT mode FROM sessions WHERE id = ?').get(sessionId) as { mode: string };
		expect(row.mode).toBe('quick');

		db.close();
	});

	it('enforces CHECK constraint — rejects invalid mode values', () => {
		const { db } = createDb();
		setupAllMigrations({ db });

		const projectId = crypto.randomUUID();
		db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [
			projectId,
			'Test Project',
			`/tmp/test-${projectId}`,
		]);

		// Valid: 'spec'
		expect(() => {
			db.run(
				"INSERT INTO sessions (id, project_id, mode) VALUES (?, ?, 'spec')",
				[crypto.randomUUID(), projectId],
			);
		}).not.toThrow();

		// Valid: 'quick'
		expect(() => {
			db.run(
				"INSERT INTO sessions (id, project_id, mode) VALUES (?, ?, 'quick')",
				[crypto.randomUUID(), projectId],
			);
		}).not.toThrow();

		// Invalid: arbitrary string
		expect(() => {
			db.run(
				"INSERT INTO sessions (id, project_id, mode) VALUES (?, ?, 'invalid')",
				[crypto.randomUUID(), projectId],
			);
		}).toThrow();

		// Invalid: empty string
		expect(() => {
			db.run(
				"INSERT INTO sessions (id, project_id, mode) VALUES (?, ?, '')",
				[crypto.randomUUID(), projectId],
			);
		}).toThrow();

		db.close();
	});

	it('allows explicit mode=spec to be inserted and read back', () => {
		const { db } = createDb();
		setupAllMigrations({ db });

		const projectId = crypto.randomUUID();
		db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [
			projectId,
			'Test Project',
			`/tmp/test-${projectId}`,
		]);

		const sessionId = crypto.randomUUID();
		db.run(
			"INSERT INTO sessions (id, project_id, mode) VALUES (?, ?, 'spec')",
			[sessionId, projectId],
		);

		const row = db.query('SELECT mode FROM sessions WHERE id = ?').get(sessionId) as { mode: string };
		expect(row.mode).toBe('spec');

		db.close();
	});
});
