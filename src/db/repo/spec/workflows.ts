import type { SQLQueryBindings } from 'bun:sqlite';
import { z } from 'zod';

import type { Database } from '../../database.ts';
import {
	SpecWorkflowSchema,
	SpecWorkflowMode,
	SpecWorkflowDepth,
	SpecWorkflowPhase,
	type SpecWorkflow,
} from '../../../state/schema.ts';
import {
	WorkflowExistsError,
	WorkflowNotFoundError,
} from '../../../state/errors.ts';
import {
	BaseRepo,
	RowNotFoundError,
	mapSqliteError,
} from './base.ts';

// ---------------------------------------------------------------------------
// Row type — mirrors the DB column layout (snake_case, integer booleans)
// ---------------------------------------------------------------------------

type SpecWorkflowRow = {
	id: string;
	project_id: string;
	workflow_id: string;
	mode: z.infer<typeof SpecWorkflowMode>;
	depth: z.infer<typeof SpecWorkflowDepth>;
	phase: z.infer<typeof SpecWorkflowPhase>;
	status: string;
	autopilot: number;
	lazy_autopilot: number;
	locked: number;
	acceptance_confirmed: number;
	interview_complete: number;
	interview_completed_at: string | null;
	current_wave: number;
	total_waves: number;
	is_active: number;
	last_activity: string;
	created_at: string;
	updated_at: string;
};

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

export const CreateSpecWorkflowInputSchema = z.object({
	projectId: z.string().min(1),
	workflowId: z.string().min(1).regex(
		/^[a-z0-9]+(-[a-z0-9]+)*$/,
		'workflowId must be kebab-case',
	),
	mode: SpecWorkflowMode.optional().default('standard'),
	depth: SpecWorkflowDepth.optional().default('standard'),
	phase: SpecWorkflowPhase.optional().default('idle'),
	status: z.string().optional().default('idle'),
	autopilot: z.boolean().optional().default(false),
	lazyAutopilot: z.boolean().optional().default(false),
	specLocked: z.boolean().optional().default(false),
	acceptanceConfirmed: z.boolean().optional().default(false),
	interviewComplete: z.boolean().optional().default(false),
	interviewCompletedAt: z.string().nullable().optional().default(null),
	currentWave: z.number().int().nonnegative().optional().default(0),
	totalWaves: z.number().int().nonnegative().optional().default(0),
	isActive: z.boolean().optional().default(false),
});
export type CreateSpecWorkflowInput = z.input<typeof CreateSpecWorkflowInputSchema>;

export const UpdateSpecWorkflowInputSchema = z.object({
	mode: SpecWorkflowMode.optional(),
	depth: SpecWorkflowDepth.optional(),
	phase: SpecWorkflowPhase.optional(),
	status: z.string().optional(),
	autopilot: z.boolean().optional(),
	lazyAutopilot: z.boolean().optional(),
	specLocked: z.boolean().optional(),
	acceptanceConfirmed: z.boolean().optional(),
	interviewComplete: z.boolean().optional(),
	interviewCompletedAt: z.string().nullable().optional(),
	currentWave: z.number().int().nonnegative().optional(),
	totalWaves: z.number().int().nonnegative().optional(),
	isActive: z.boolean().optional(),
	lastActivity: z.string().optional(),
});
export type UpdateSpecWorkflowInput = z.input<typeof UpdateSpecWorkflowInputSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a snake_case DB row into a Zod-validated SpecWorkflow. */
function rowToSpecWorkflow(row: SpecWorkflowRow): SpecWorkflow {
	return SpecWorkflowSchema.parse({
		id: row.id,
		projectId: row.project_id,
		workflowId: row.workflow_id,
		mode: row.mode,
		depth: row.depth,
		phase: row.phase,
		status: row.status,
		autopilot: row.autopilot === 1,
		lazyAutopilot: row.lazy_autopilot === 1,
		specLocked: row.locked === 1,
		acceptanceConfirmed: row.acceptance_confirmed === 1,
		interviewComplete: row.interview_complete === 1,
		interviewCompletedAt: row.interview_completed_at,
		currentWave: row.current_wave,
		totalWaves: row.total_waves,
		isActive: row.is_active === 1,
		lastActivity: row.last_activity,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

/**
 * Build a parameterised UPDATE for only the provided fields.
 * Only keys that appear in `UpdateSpecWorkflowInputSchema` can reach here,
 * so the column-name concatenation is safe (Zod-validated whitelist).
 */
function buildUpdate(
	id: string,
	partial: Record<string, unknown>,
): { sql: string; params: unknown[] } {
	// CamelCase → snake_case mapping for the spec_workflows table
	const fieldToColumn: Record<string, string> = {
		mode: 'mode',
		depth: 'depth',
		phase: 'phase',
		status: 'status',
		autopilot: 'autopilot',
		lazyAutopilot: 'lazy_autopilot',
		specLocked: 'locked',
		acceptanceConfirmed: 'acceptance_confirmed',
		interviewComplete: 'interview_complete',
		interviewCompletedAt: 'interview_completed_at',
		currentWave: 'current_wave',
		totalWaves: 'total_waves',
		isActive: 'is_active',
		lastActivity: 'last_activity',
	};

	const entries = Object.entries(partial).filter(([, v]) => v !== undefined);
	if (entries.length === 0) {
		return { sql: '', params: [] };
	}

	const assignments = entries.map(([key]) => `${fieldToColumn[key] ?? key} = ?`);

	const params: SQLQueryBindings[] = entries.map(([, value]) =>
		typeof value === 'boolean' ? (value ? 1 : 0) : value as SQLQueryBindings,
	);

	const sql = `UPDATE spec_workflows SET ${assignments.join(', ')}, updated_at = datetime('now'), last_activity = datetime('now') WHERE id = ?`;

	return { sql, params: [...params, id] as SQLQueryBindings[] };
}

// ---------------------------------------------------------------------------
// Repo
// ---------------------------------------------------------------------------

export class SpecWorkflowsRepo extends BaseRepo {
	constructor(database: Database) {
		super(database);
	}

	/** List all workflows for a project, newest activity first. */
	list(projectId: string): SpecWorkflow[] {
		const rows = this.db
			.query('SELECT * FROM spec_workflows WHERE project_id = ? ORDER BY last_activity DESC')
			.all(projectId) as SpecWorkflowRow[];

		return rows.map((row) => rowToSpecWorkflow(row));
	}

	/** Get a workflow by its composite key, or null. */
	get(projectId: string, workflowId: string): SpecWorkflow | null {
		const row = this.db
			.query('SELECT * FROM spec_workflows WHERE project_id = ? AND workflow_id = ?')
			.get(projectId, workflowId) as SpecWorkflowRow | null;

		return row ? rowToSpecWorkflow(row) : null;
	}

	/** Get a workflow by primary key (UUID), or null. */
	getById(id: string): SpecWorkflow | null {
		const row = this.db
			.query('SELECT * FROM spec_workflows WHERE id = ?')
			.get(id) as SpecWorkflowRow | null;

		return row ? rowToSpecWorkflow(row) : null;
	}

	/** Return the single active workflow for a project, or null. */
	getActive(projectId: string): SpecWorkflow | null {
		const row = this.db
			.query(
				'SELECT * FROM spec_workflows WHERE project_id = ? AND is_active = 1 LIMIT 1',
			)
			.get(projectId) as SpecWorkflowRow | null;

		return row ? rowToSpecWorkflow(row) : null;
	}

	/**
	 * Insert a new workflow row.
	 *
	 * @throws {WorkflowExistsError} on UNIQUE constraint violation.
	 * @throws {RepoConstraintViolationError} on other constraint failures.
	 */
	create(input: CreateSpecWorkflowInput): SpecWorkflow {
		const data = CreateSpecWorkflowInputSchema.parse(input);
		const id = crypto.randomUUID();
		const now = new Date().toISOString();

		try {
			this.db.run(
				`INSERT INTO spec_workflows (
					id, project_id, workflow_id, mode, depth, phase, status,
					autopilot, lazy_autopilot, locked, acceptance_confirmed,
					interview_complete, interview_completed_at, current_wave, total_waves,
					is_active, last_activity, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					id,
					data.projectId,
					data.workflowId,
					data.mode,
					data.depth,
					data.phase,
					data.status,
					data.autopilot ? 1 : 0,
					data.lazyAutopilot ? 1 : 0,
					data.specLocked ? 1 : 0,
					data.acceptanceConfirmed ? 1 : 0,
					data.interviewComplete ? 1 : 0,
					data.interviewCompletedAt,
					data.currentWave,
					data.totalWaves,
					data.isActive ? 1 : 0,
					now,
					now,
					now,
				],
			);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			if (message.includes('UNIQUE')) {
				throw new WorkflowExistsError({
					code: 'WORKFLOW_EXISTS',
					projectId: data.projectId,
					workflowId: data.workflowId,
				});
			}
			throw mapSqliteError(err, { operation: 'create', table: 'spec_workflows' });
		}

		return this.getById(id)!;
	}

	/**
	 * Update one or more fields of an existing workflow.
	 *
	 * Only the fields present in `partial` are touched; all others are
	 * left unchanged.  `updated_at` and `last_activity` are refreshed.
	 *
	 * @throws {RowNotFoundError} if no row matches the given id.
	 */
	update(id: string, partial: UpdateSpecWorkflowInput): SpecWorkflow {
		const parsed = UpdateSpecWorkflowInputSchema.parse(partial);

		const { sql, params } = buildUpdate(
			id,
			parsed as Record<string, unknown>,
		);

		try {
			if (sql.length > 0) {
				const result = this.db.run(sql, params as SQLQueryBindings[]);
				if (result.changes === 0) {
					throw new RowNotFoundError({ table: 'spec_workflows', id, idColumn: 'id' });
				}
			} else {
				// No fields to update — verify the row exists
				if (!this.getById(id)) {
					throw new RowNotFoundError({ table: 'spec_workflows', id, idColumn: 'id' });
				}
			}
		} catch (err: unknown) {
			if (err instanceof RowNotFoundError) throw err;
			throw mapSqliteError(err, { operation: 'update', table: 'spec_workflows' });
		}

		return this.getById(id)!;
	}

	/**
	 * Delete a workflow by primary key.
	 *
	 * This will cascade-delete child rows in tables with `ON DELETE CASCADE`
	 * (documents, must-haves, blueprints, waves, tasks, amendments).  Tables
	 * with `ON DELETE RESTRICT` (chronicle, adl) will block the deletion.
	 *
	 * @throws {RowNotFoundError} if no row matches the given id.
	 */
	delete(id: string): void {
		try {
			const result = this.db.run('DELETE FROM spec_workflows WHERE id = ?', [id]);
			if (result.changes === 0) {
				throw new RowNotFoundError({ table: 'spec_workflows', id, idColumn: 'id' });
			}
		} catch (err: unknown) {
			if (err instanceof RowNotFoundError) throw err;
			throw mapSqliteError(err, { operation: 'delete', table: 'spec_workflows' });
		}
	}

	/**
	 * Atomically set the active workflow for a project.
	 *
	 * Deactivates all existing active workflows for the project, then
	 * activates the target.  Runs inside a transaction so concurrent
	 * callers see a consistent state.
	 *
	 * @throws {WorkflowNotFoundError} if the target workflow does not exist.
	 */
	setActive(projectId: string, workflowId: string): void {
		this.withTransaction(() => {
			this.db.run(
				'UPDATE spec_workflows SET is_active = 0 WHERE project_id = ? AND is_active = 1',
				[projectId],
			);

			const result = this.db
				.query(
					`UPDATE spec_workflows
					 SET is_active = 1, last_activity = datetime('now'), updated_at = datetime('now')
					 WHERE project_id = ? AND workflow_id = ?`,
				)
				.run(projectId, workflowId);

			if (result.changes === 0) {
				throw new WorkflowNotFoundError({
					code: 'WORKFLOW_NOT_FOUND',
					projectId,
					workflowId,
				});
			}
		});
	}
}
