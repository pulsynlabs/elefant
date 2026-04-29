import type { Database as BunDatabase } from 'bun:sqlite';

import type { Database } from '../../database.ts';
import {
	SpecLockedError,
	WorkflowNotFoundError,
} from '../../../state/errors.ts';

// ---------------------------------------------------------------------------
// Table-name validation whitelist (all tables from migrations 0004–0005)
// ---------------------------------------------------------------------------
const KNOWN_SPEC_TABLES = [
	'spec_workflows',
	'spec_documents',
	'spec_must_haves',
	'spec_acceptance_criteria',
	'spec_validation_contracts',
	'spec_out_of_scope',
	'spec_amendments',
	'spec_blueprints',
	'spec_waves',
	'spec_tasks',
	'spec_chronicle_entries',
	'spec_adl_entries',
] as const;

const TABLE_NAME_RE = /^[a-z_]+$/;

// ---------------------------------------------------------------------------
// Error classes (repo-layer specific — shared concepts stay in state/errors.ts)
// ---------------------------------------------------------------------------

/** Thrown when a row is not found by an existence check or mutation. */
export class RowNotFoundError extends Error {
	readonly code = 'ROW_NOT_FOUND' as const;
	readonly table: string;
	readonly id: string;
	readonly idColumn: string;

	constructor(input: { table: string; id: string; idColumn: string }) {
		super(`Row not found in ${input.table} where ${input.idColumn}=${input.id}`);
		this.name = 'RowNotFoundError';
		this.table = input.table;
		this.id = input.id;
		this.idColumn = input.idColumn;
	}
}

/** Thrown when a table name fails the whitelist+regex validation. */
export class InvalidTableError extends Error {
	readonly code = 'INVALID_TABLE' as const;

	constructor(table: string) {
		super(`Invalid table name: ${table}`);
		this.name = 'InvalidTableError';
	}
}

/**
 * Structured wrapper around SQLite constraint violations (UNIQUE, FK, etc.).
 * Future subclasses (Task 1.3) may extend this for specific constraint types.
 */
export class RepoConstraintViolationError extends Error {
	readonly code = 'REPO_CONSTRAINT_VIOLATION' as const;
	readonly cause?: unknown;

	constructor(message: string, cause?: unknown) {
		super(message);
		this.name = 'RepoConstraintViolationError';
		this.cause = cause;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validates a table or column name against a whitelist plus a regex guard.
 * Throws InvalidTableError on mismatch.  This is the SQL-injection defence for
 * dynamic SQL identifiers in `assertExists` and similar helpers.
 */
function validateTableName(name: string, kind: 'table' | 'column'): void {
	if (!TABLE_NAME_RE.test(name)) {
		throw new InvalidTableError(`${kind} "${name}" fails regex validation`);
	}
	if (kind === 'table' && !KNOWN_SPEC_TABLES.includes(name as (typeof KNOWN_SPEC_TABLES)[number])) {
		throw new InvalidTableError(`Table "${name}" is not in the spec-mode whitelist`);
	}
}

/**
 * Inspects bun:sqlite error messages for UNIQUE / FOREIGN KEY violations and
 * returns a typed `RepoConstraintViolationError`.  Pass-through for other errors.
 *
 * Call this inside every repo `catch` block so constraint failures surface as
 * structured errors the caller can inspect.
 */
export function mapSqliteError(
	err: unknown,
	context: { operation: string; table: string },
): Error {
	if (!(err instanceof Error)) {
		return err instanceof Error ? err : new Error(String(err));
	}

	const message = err.message;

	if (message.includes('UNIQUE constraint') || message.includes('UNIQUE')) {
		return new RepoConstraintViolationError(
			`UNIQUE constraint violation on ${context.table} during ${context.operation}: ${message}`,
			err,
		);
	}

	if (message.includes('FOREIGN KEY constraint') || message.includes('FOREIGN KEY')) {
		return new RepoConstraintViolationError(
			`FOREIGN KEY constraint violation on ${context.table} during ${context.operation}: ${message}`,
			err,
		);
	}

	if (message.includes('CHECK constraint') || message.includes('CHECK')) {
		return new RepoConstraintViolationError(
			`CHECK constraint violation on ${context.table} during ${context.operation}: ${message}`,
			err,
		);
	}

	return err;
}

// ---------------------------------------------------------------------------
// BaseRepo
// ---------------------------------------------------------------------------

/**
 * Shared base for all spec-mode repository classes.
 *
 * Provides a direct reference to the raw `bun:sqlite` database handle as well
 * as the Elefant `Database` wrapper, a safe `withTransaction` helper, and
 * validated existence checks.
 */
export class BaseRepo {
	protected readonly db: BunDatabase;
	protected readonly database: Database;

	constructor(database: Database) {
		this.database = database;
		this.db = database.db;
	}

	/**
	 * Execute a callback synchronously inside a bun:sqlite transaction.
	 *
	 * If the callback throws, the transaction is automatically rolled back by
	 * SQLite (see https://bun.sh/docs/api/sqlite#transactions).  The return
	 * value of the callback is forwarded to the caller.
	 */
	withTransaction<T>(fn: () => T): T {
		return this.db.transaction(fn)();
	}

	/**
	 * Assert that at least one row exists in `table` where `idColumn = id`.
	 *
	 * `table` is validated against a whitelist of known spec-mode table names
	 * and a `/^[a-z_]+$/` regex.  `idColumn` is also regex-validated.
	 *
	 * @throws {InvalidTableError} if table or idColumn fail validation.
	 * @throws {RowNotFoundError} if no matching row is found.
	 */
	assertExists(table: string, id: string, options?: { idColumn?: string }): void {
		const idColumn = options?.idColumn ?? 'id';

		validateTableName(table, 'table');
		validateTableName(idColumn, 'column');

		const row = this.db.query(`SELECT 1 FROM ${table} WHERE ${idColumn}=? LIMIT 1`).get(id);
		if (!row) {
			throw new RowNotFoundError({ table, id, idColumn });
		}
	}

	/** Convenience wrapper around `assertExists` for the `spec_workflows` table. */
	assertWorkflowExists(workflowId: string): void {
		this.assertExists('spec_workflows', workflowId, { idColumn: 'workflow_id' });
	}

	/**
	 * Assert that a protected write can proceed for a workflow.
	 *
	 * This helper reads `spec_workflows.spec_locked` and throws `SpecLockedError`
	 * when the workflow is locked and the caller is not running an amendment.
	 * Outside a transaction, the read+subsequent write would be a TOCTOU window;
	 * therefore every lock-protected public write MUST call this from inside
	 * `withTransaction`, making the lock check and protected table mutation atomic
	 * on the shared SQLite connection.
	 *
	 * @throws {WorkflowNotFoundError} when the workflow primary key is unknown.
	 * @throws {SpecLockedError} when the workflow is locked and opts.amend is not true.
	 */
	protected assertNotLocked(
		workflowId: string,
		attempted: string,
		opts?: { amend?: boolean },
	): void {
		if (opts?.amend) return;

		const row = this.db
			.query('SELECT project_id, workflow_id, spec_locked FROM spec_workflows WHERE id = ?')
			.get(workflowId) as { project_id: string; workflow_id: string; spec_locked: number } | null;

		if (!row) {
			throw new WorkflowNotFoundError({
				code: 'WORKFLOW_NOT_FOUND',
				projectId: 'unknown',
				workflowId,
			});
		}

		if (row.spec_locked === 1) {
			throw new SpecLockedError({
				workflowId,
				attempted,
				projectId: row.project_id,
			});
		}
	}
}
