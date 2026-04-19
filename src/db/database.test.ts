import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Database } from './database.ts';

const tempDirs: string[] = [];

function createTempDbPath(): string {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-db-'));
	tempDirs.push(dir);
	return join(dir, 'db.sqlite');
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

describe('Database', () => {
	it('initializes all required tables on fresh database', () => {
		const dbPath = createTempDbPath();
		const database = new Database(dbPath);

		const rows = database.db
			.query(
				`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC`,
			)
			.all() as { name: string }[];

		database.close();

		expect(rows.map((row) => row.name)).toEqual([
			'_migrations',
			'agent_runs',
			'checkpoints',
			'events',
			'memory_entries',
			'projects',
			'sessions',
			'work_items',
		]);
	});

	it('applies WAL and foreign key pragmas', () => {
		const dbPath = createTempDbPath();
		const database = new Database(dbPath);

		const journalMode = database.db.query('PRAGMA journal_mode').get() as {
			journal_mode: string;
		};
		const foreignKeys = database.db.query('PRAGMA foreign_keys').get() as {
			foreign_keys: number;
		};

		database.close();

		expect(journalMode.journal_mode.toLowerCase()).toBe('wal');
		expect(foreignKeys.foreign_keys).toBe(1);
	});

	it('creates wal or shm files after write operations', () => {
		const dbPath = createTempDbPath();
		const database = new Database(dbPath);

		database.db.run(
			'INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)',
			['proj-1', 'Project 1', '/tmp/project-1', 'test project'],
		);

		const walPath = `${dbPath}-wal`;
		const shmPath = `${dbPath}-shm`;

		expect(existsSync(walPath) || existsSync(shmPath)).toBe(true);

		database.close();
	});

	it('re-opens existing database idempotently and preserves applied migrations', () => {
		const dbPath = createTempDbPath();
		const firstOpen = new Database(dbPath);
		firstOpen.close();

		const secondOpen = new Database(dbPath);
		const rows = secondOpen.db.query('SELECT version FROM _migrations ORDER BY version ASC').all() as {
			version: number;
		}[];
		secondOpen.close();

		expect(rows).toEqual([{ version: 1 }, { version: 2 }]);
	});
});
