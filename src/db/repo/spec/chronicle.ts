import type { SQLQueryBindings } from 'bun:sqlite';
import { z } from 'zod';

import type { Database } from '../../database.ts';
import { BaseRepo, mapSqliteError } from './base.ts';

// ---------------------------------------------------------------------------
// Row type — snake_case, mirrors DB column layout
// ---------------------------------------------------------------------------

type ChronicleEntryRow = {
	id: string;
	workflow_id: string;
	kind: string;
	payload: string;
	created_at: string;
};

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

export const SpecChronicleEntrySchema = z.object({
	id: z.string(),
	workflowId: z.string(),
	kind: z.string(),
	payload: z.record(z.string(), z.unknown()),
	createdAt: z.string(),
});
export type SpecChronicleEntry = z.infer<typeof SpecChronicleEntrySchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToChronicleEntry(row: ChronicleEntryRow): SpecChronicleEntry {
	return SpecChronicleEntrySchema.parse({
		id: row.id,
		workflowId: row.workflow_id,
		kind: row.kind,
		payload: JSON.parse(row.payload) as unknown,
		createdAt: row.created_at,
	});
}

// ---------------------------------------------------------------------------
// Repo (APPEND-ONLY — no update/delete methods exported)
// ---------------------------------------------------------------------------

/**
 * Append-only chronicle repository.
 *
 * Entries are written once and never modified.  The module exports no
 * method that mutates existing rows (no update / delete / remove / patch /
 * replace).  This is enforced by the module surface — see the companion
 * test that asserts those symbols are absent from the module namespace.
 */
export class SpecChronicleRepo extends BaseRepo {
	constructor(database: Database) {
		super(database);
	}

	append(
		workflowId: string,
		entry: { kind: string; payload?: Record<string, unknown> },
	): SpecChronicleEntry {
		const id = crypto.randomUUID();
		const payload = entry.payload ?? {};
		const now = new Date().toISOString();

		try {
			this.db.run(
				`INSERT INTO spec_chronicle_entries (id, workflow_id, kind, payload, created_at)
				 VALUES (?, ?, ?, ?, ?)`,
				[id, workflowId, entry.kind, JSON.stringify(payload), now],
			);
		} catch (err: unknown) {
			throw mapSqliteError(err, {
				operation: 'append',
				table: 'spec_chronicle_entries',
			});
		}

		return this.#getById(id)!;
	}

	/**
	 * List entries for a workflow, oldest first.
	 *
	 * Optionally limit the result count and/or filter to entries created
	 * after a given ISO timestamp.
	 */
	list(
		workflowId: string,
		opts?: { limit?: number; since?: string },
	): SpecChronicleEntry[] {
		let sql =
			'SELECT * FROM spec_chronicle_entries WHERE workflow_id = ?';
		const params: SQLQueryBindings[] = [workflowId];

		if (opts?.since) {
			sql += ' AND created_at > ?';
			params.push(opts.since);
		}

		sql += ' ORDER BY created_at ASC';

		if (opts?.limit) {
			sql += ' LIMIT ?';
			params.push(opts.limit);
		}

		const rows = this.db.query(sql).all(...params) as ChronicleEntryRow[];
		return rows.map(rowToChronicleEntry);
	}

	/**
	 * Return the N most recent entries, newest first.
	 */
	getLastN(workflowId: string, n: number): SpecChronicleEntry[] {
		const rows = this.db
			.query(
				`SELECT * FROM spec_chronicle_entries
				 WHERE workflow_id = ?
				 ORDER BY created_at DESC
				 LIMIT ?`,
			)
			.all(workflowId, n) as ChronicleEntryRow[];
		// Reverse to maintain DESC contract: already DESC from SQL.
		return rows.map(rowToChronicleEntry);
	}

	// ---- Internal ----------------------------------------------------------

	#getById(id: string): SpecChronicleEntry | null {
		const row = this.db
			.query('SELECT * FROM spec_chronicle_entries WHERE id = ?')
			.get(id) as ChronicleEntryRow | null;
		return row ? rowToChronicleEntry(row) : null;
	}
}
