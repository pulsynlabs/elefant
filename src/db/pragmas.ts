import type { Database } from 'bun:sqlite';

export const PRAGMAS = [
	'PRAGMA journal_mode = WAL',
	'PRAGMA foreign_keys = ON',
	'PRAGMA synchronous = NORMAL',
	'PRAGMA busy_timeout = 5000',
	'PRAGMA cache_size = -64000',
] as const;

export function applyPragmas(db: Database): void {
	for (const pragma of PRAGMAS) {
		db.run(pragma);
	}
}
