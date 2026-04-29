import { afterEach, describe, expect, it } from 'bun:test';
import { Database as BunDatabase } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runMigrations } from '../migrations.ts';
import { applyPragmas } from '../pragmas.ts';

const tempDirs: string[] = [];

function createDb(): BunDatabase {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-migrations-0006-'));
	tempDirs.push(dir);
	const db = new BunDatabase(join(dir, 'db.sqlite'), { create: true });
	applyPragmas(db);
	return db;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('migration 0006_spec_idempotency', () => {
	it('applies cleanly and registers version 6', () => {
		const db = createDb();
		runMigrations(db);

		const versions = db
			.query('SELECT version FROM _migrations ORDER BY version ASC')
			.all()
			.map((row) => (row as { version: number }).version);

		expect(versions).toContain(6);
		expect(versions).toContain(5);
		db.close();
	});

	it('creates the idempotency table and replay primary key', () => {
		const db = createDb();
		runMigrations(db);

		const cols = db.query('PRAGMA table_info(spec_idempotency)').all() as Array<{ name: string }>;
		expect(cols.map((col) => col.name)).toEqual([
			'workflow_id',
			'tool_name',
			'idempotency_key',
			'result_payload',
			'created_at',
		]);

		db.run(
			`INSERT INTO spec_idempotency (workflow_id, tool_name, idempotency_key, result_payload)
			 VALUES (?, ?, ?, ?)`,
			['workflow-1', 'spec_chronicle', 'key-1', '{"ok":true}'],
		);

		expect(() =>
			db.run(
				`INSERT INTO spec_idempotency (workflow_id, tool_name, idempotency_key, result_payload)
				 VALUES (?, ?, ?, ?)`,
				['workflow-1', 'spec_chronicle', 'key-1', '{"ok":true}'],
			),
		).toThrow();

		db.close();
	});
});
