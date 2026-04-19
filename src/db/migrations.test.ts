import { Database as BunDatabase } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { MIGRATIONS_DIR, runMigrations } from './migrations.ts';
import { applyPragmas } from './pragmas.ts';

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

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

describe('runMigrations', () => {
	it('applies initial migration on a fresh database', () => {
		const { db } = createDb();

		runMigrations(db);

		const applied = db.query('SELECT version FROM _migrations ORDER BY version ASC').all() as {
			version: number;
		}[];

		db.close();

		expect(applied).toEqual([{ version: 1 }, { version: 2 }]);
	});

	it('is idempotent when re-run on an existing database', () => {
		const { db } = createDb();

		runMigrations(db);
		runMigrations(db);

		const count = db.query('SELECT COUNT(*) AS count FROM _migrations').get() as { count: number };

		db.close();

		expect(count.count).toBe(2);
	});

	it('rolls back a failing migration and keeps existing schema intact', () => {
		const { db } = createDb();
		const migrationDir = createTempDir('elefant-migrations-fixture-');

		const migration0001 = readFileSync(join(MIGRATIONS_DIR, '0001_init.sql'), 'utf-8');
		writeFileSync(join(migrationDir, '0001_init.sql'), migration0001, 'utf-8');
		writeFileSync(
			join(migrationDir, '0002_bad.sql'),
			'CREATE TABLE bad_table (id TEXT PRIMARY KEY);\nTHIS IS NOT VALID SQL;',
			'utf-8',
		);

		expect(() => runMigrations(db, migrationDir)).toThrow();

		const applied = db.query('SELECT version FROM _migrations ORDER BY version ASC').all() as {
			version: number;
		}[];

		const projectsTable = db
			.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'")
			.get() as { name: string } | null;

		const badTable = db
			.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'bad_table'")
			.get() as { name: string } | null;

		db.close();

		expect(applied).toEqual([{ version: 1 }]);
		expect(projectsTable).not.toBeNull();
		expect(badTable).toBeNull();
	});
});
