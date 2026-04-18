import type { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

function splitSqlStatements(sql: string): string[] {
	return sql
		.split(';')
		.map((statement) => statement.trim())
		.filter((statement) => statement.length > 0);
}

function parseMigrationVersion(fileName: string): number | null {
	const [prefix] = fileName.split('_');
	const version = Number.parseInt(prefix, 10);

	if (!Number.isInteger(version) || version <= 0) {
		return null;
	}

	return version;
}

function getAppliedVersions(db: Database): Set<number> {
	const rows = db.query('SELECT version FROM _migrations ORDER BY version ASC').all() as {
		version: number;
	}[];

	return new Set(rows.map((row) => row.version));
}

export function runMigrations(db: Database, migrationsDir: string = MIGRATIONS_DIR): void {
	db.run(`
		CREATE TABLE IF NOT EXISTS _migrations (
			version INTEGER PRIMARY KEY NOT NULL,
			applied_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`);

	const files = readdirSync(migrationsDir)
		.filter((fileName) => fileName.endsWith('.sql'))
		.sort();

	const appliedVersions = getAppliedVersions(db);

	for (const fileName of files) {
		const version = parseMigrationVersion(fileName);

		if (version === null || appliedVersions.has(version)) {
			continue;
		}

		const sql = readFileSync(join(migrationsDir, fileName), 'utf-8');
		const statements = splitSqlStatements(sql);

		db.transaction(() => {
			for (const statement of statements) {
				try {
					db.run(statement);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					if (!message.includes('duplicate column') && !message.includes('already exists')) {
						throw error;
					}
				}
			}

			db.run('INSERT INTO _migrations (version) VALUES (?)', [version]);
		})();

		appliedVersions.add(version);
	}
}
