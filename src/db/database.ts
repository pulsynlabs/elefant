import { Database as BunDatabase } from 'bun:sqlite';

import { runMigrations } from './migrations.ts';
import { applyPragmas } from './pragmas.ts';

export class Database {
	readonly db: BunDatabase;

	constructor(dbPath: string) {
		this.db = new BunDatabase(dbPath, { create: true });
		applyPragmas(this.db);
		runMigrations(this.db);
	}

	close(): void {
		this.db.close();
	}
}
