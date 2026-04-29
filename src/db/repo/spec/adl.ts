import type { SQLQueryBindings } from 'bun:sqlite';
import { z } from 'zod';

import type { Database } from '../../database.ts';
import { BaseRepo, mapSqliteError } from './base.ts';

// ---------------------------------------------------------------------------
// Row type — snake_case, mirrors DB column layout
// ---------------------------------------------------------------------------

type AdlEntryRow = {
	id: string;
	workflow_id: string;
	type: string;
	title: string;
	body: string;
	rule: number | null;
	files: string;
	created_at: string;
};

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const SpecAdlEntryTypeSchema = z.enum([
	'decision',
	'deviation',
	'observation',
]);
export type SpecAdlEntryType = z.infer<typeof SpecAdlEntryTypeSchema>;

export const SpecAdlEntrySchema = z.object({
	id: z.string(),
	workflowId: z.string(),
	type: SpecAdlEntryTypeSchema,
	title: z.string(),
	body: z.string(),
	rule: z.number().int().nullable(),
	files: z.array(z.string()),
	createdAt: z.string(),
});
export type SpecAdlEntry = z.infer<typeof SpecAdlEntrySchema>;

export interface CreateAdlEntryInput {
	type: SpecAdlEntryType;
	title: string;
	body?: string;
	rule?: number | null;
	files?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToAdlEntry(row: AdlEntryRow): SpecAdlEntry {
	return SpecAdlEntrySchema.parse({
		id: row.id,
		workflowId: row.workflow_id,
		type: row.type,
		title: row.title,
		body: row.body,
		rule: row.rule,
		files: JSON.parse(row.files) as unknown,
		createdAt: row.created_at,
	});
}

// ---------------------------------------------------------------------------
// Repo (APPEND-ONLY — no update/delete methods exported)
// ---------------------------------------------------------------------------

/**
 * Append-only architectural decision log repository.
 *
 * Entries are written once and never modified.  The module exports no
 * method that mutates existing rows (no update / delete / remove / patch /
 * replace).  This is enforced by the module surface — see the companion
 * test that asserts those symbols are absent from the module namespace.
 */
export class SpecAdlRepo extends BaseRepo {
	constructor(database: Database) {
		super(database);
	}

	append(workflowId: string, entry: CreateAdlEntryInput): SpecAdlEntry {
		// Validate type ahead of DB write so invalid values surface as Zod errors.
		SpecAdlEntryTypeSchema.parse(entry.type);

		const id = crypto.randomUUID();
		const body = entry.body ?? '';
		const rule = entry.rule ?? null;
		const files = entry.files ?? [];
		const now = new Date().toISOString();

		try {
			this.db.run(
				`INSERT INTO spec_adl_entries (id, workflow_id, type, title, body, rule, files, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[id, workflowId, entry.type, entry.title, body, rule, JSON.stringify(files), now],
			);
		} catch (err: unknown) {
			throw mapSqliteError(err, {
				operation: 'append',
				table: 'spec_adl_entries',
			});
		}

		return this.#getById(id)!;
	}

	/**
	 * List entries for a workflow, oldest first.
	 *
	 * Optionally limit the result count and/or filter by entry type.
	 */
	list(
		workflowId: string,
		opts?: { limit?: number; type?: SpecAdlEntryType },
	): SpecAdlEntry[] {
		let sql = 'SELECT * FROM spec_adl_entries WHERE workflow_id = ?';
		const params: SQLQueryBindings[] = [workflowId];

		if (opts?.type) {
			sql += ' AND type = ?';
			params.push(opts.type);
		}

		sql += ' ORDER BY created_at ASC';

		if (opts?.limit) {
			sql += ' LIMIT ?';
			params.push(opts.limit);
		}

		const rows = this.db.query(sql).all(...params) as AdlEntryRow[];
		return rows.map(rowToAdlEntry);
	}

	/**
	 * Return the N most recent entries, newest first.
	 */
	getLastN(workflowId: string, n: number): SpecAdlEntry[] {
		const rows = this.db
			.query(
				`SELECT * FROM spec_adl_entries
				 WHERE workflow_id = ?
				 ORDER BY created_at DESC
				 LIMIT ?`,
			)
			.all(workflowId, n) as AdlEntryRow[];
		return rows.map(rowToAdlEntry);
	}

	// ---- Internal ----------------------------------------------------------

	#getById(id: string): SpecAdlEntry | null {
		const row = this.db
			.query('SELECT * FROM spec_adl_entries WHERE id = ?')
			.get(id) as AdlEntryRow | null;
		return row ? rowToAdlEntry(row) : null;
	}
}
