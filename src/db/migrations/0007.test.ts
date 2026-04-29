import { Database as BunDatabase } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runMigrations } from '../migrations.ts';
import { applyPragmas } from '../pragmas.ts';

const tempDirs: string[] = [];

function createDb(): BunDatabase {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-agent-profile-migration-'));
	tempDirs.push(dir);
	const db = new BunDatabase(join(dir, 'db.sqlite'), { create: true });
	applyPragmas(db);
	return db;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('migration 0007 agent profile extension', () => {
	it('creates extended agent profile columns with context mode constraint', () => {
		const db = createDb();
		runMigrations(db);

		const columns = db.query('PRAGMA table_info(agent_profiles)').all() as { name: string }[];
		const names = new Set(columns.map((column) => column.name));

		expect(names.has('tools_allowlist')).toBe(true);
		expect(names.has('permissions')).toBe(true);
		expect(names.has('context_mode')).toBe(true);
		expect(names.has('prompt_file')).toBe(true);
		expect(names.has('prompt_override')).toBe(true);

		db.run(
			`INSERT INTO agent_profiles (id, label, kind, context_mode) VALUES ('verifier', 'Verifier', 'verifier', 'none')`,
		);

		expect(() => {
			db.run(
				`INSERT INTO agent_profiles (id, label, kind, context_mode) VALUES ('bad', 'Bad', 'custom', 'invalid')`,
			);
		}).toThrow();

		db.close();
	});

	it('is idempotent when migrations are re-run', () => {
		const db = createDb();

		runMigrations(db);
		runMigrations(db);

		const migration = db.query('SELECT version FROM _migrations WHERE version = 7').get() as {
			version: number;
		} | null;

		expect(migration).toEqual({ version: 7 });
		db.close();
	});
});
