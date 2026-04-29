import type { SQLQueryBindings } from 'bun:sqlite';
import { z } from 'zod';

import type { Database } from '../../database.ts';
import {
	BaseRepo,
	RowNotFoundError,
	mapSqliteError,
	RepoConstraintViolationError,
} from './base.ts';

// ---------------------------------------------------------------------------
// Row types — snake_case, mirrors DB column layout
// ---------------------------------------------------------------------------

type SpecWaveRow = {
	id: string;
	blueprint_id: string;
	wave_number: number;
	name: string;
	goal: string;
	parallel: number;
	ordinal: number;
	created_at: string;
};

type SpecTaskRow = {
	id: string;
	wave_id: string;
	task_id: string;
	name: string;
	executor: string;
	files: string;
	action: string;
	done: string;
	verify: string;
	status: string;
	agent_run_id: string | null;
	ordinal: number;
	started_at: string | null;
	completed_at: string | null;
	created_at: string;
	updated_at: string;
};

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const SpecTaskStatus = z.enum([
	'pending',
	'in_progress',
	'complete',
	'blocked',
	'skipped',
]);
export type SpecTaskStatus = z.infer<typeof SpecTaskStatus>;

export const SpecWaveSchema = z.object({
	id: z.string(),
	blueprintId: z.string(),
	waveNumber: z.number().int().positive(),
	name: z.string(),
	goal: z.string(),
	parallel: z.boolean(),
	ordinal: z.number().int(),
	createdAt: z.string(),
});
export type SpecWave = z.infer<typeof SpecWaveSchema>;

export const SpecTaskSchema = z.object({
	id: z.string(),
	waveId: z.string(),
	taskId: z.string(),
	name: z.string(),
	executor: z.enum([
		'goop-executor-low',
		'goop-executor-medium',
		'goop-executor-high',
		'goop-executor-frontend',
	]),
	files: z.array(z.string()),
	action: z.string(),
	done: z.string(),
	verify: z.string(),
	status: SpecTaskStatus,
	agentRunId: z.string().nullable(),
	ordinal: z.number().int(),
	startedAt: z.string().nullable(),
	completedAt: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type SpecTask = z.infer<typeof SpecTaskSchema>;

export const CreateWaveInputSchema = z.object({
	blueprintId: z.string().min(1),
	waveNumber: z.number().int().positive(),
	name: z.string(),
	goal: z.string().optional().default(''),
	parallel: z.boolean().optional().default(false),
	ordinal: z.number().int(),
});
export type CreateWaveInput = z.input<typeof CreateWaveInputSchema>;

export const CreateTaskInputSchema = z.object({
	waveId: z.string().min(1),
	taskId: z.string().min(1),
	name: z.string(),
	executor: z.enum([
		'goop-executor-low',
		'goop-executor-medium',
		'goop-executor-high',
		'goop-executor-frontend',
	]),
	files: z.array(z.string()).optional().default([]),
	action: z.string(),
	done: z.string(),
	verify: z.string().optional().default(''),
	status: SpecTaskStatus.optional().default('pending'),
	ordinal: z.number().int(),
});
export type CreateTaskInput = z.input<typeof CreateTaskInputSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToSpecWave(row: SpecWaveRow): SpecWave {
	return SpecWaveSchema.parse({
		id: row.id,
		blueprintId: row.blueprint_id,
		waveNumber: row.wave_number,
		name: row.name,
		goal: row.goal,
		parallel: row.parallel === 1,
		ordinal: row.ordinal,
		createdAt: row.created_at,
	});
}

function rowToSpecTask(row: SpecTaskRow): SpecTask {
	return SpecTaskSchema.parse({
		id: row.id,
		waveId: row.wave_id,
		taskId: row.task_id,
		name: row.name,
		executor: row.executor,
		files: JSON.parse(row.files) as unknown,
		action: row.action,
		done: row.done,
		verify: row.verify,
		status: row.status,
		agentRunId: row.agent_run_id,
		ordinal: row.ordinal,
		startedAt: row.started_at,
		completedAt: row.completed_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

// ---------------------------------------------------------------------------
// Repo
// ---------------------------------------------------------------------------

export class SpecTasksRepo extends BaseRepo {
	constructor(database: Database) {
		super(database);
	}

	// ---- Wave operations ---------------------------------------------------

	createWave(input: CreateWaveInput): SpecWave {
		const data = CreateWaveInputSchema.parse(input);
		const id = crypto.randomUUID();
		const now = new Date().toISOString();

		try {
			this.db.run(
				`INSERT INTO spec_waves (id, blueprint_id, wave_number, name, goal, parallel, ordinal, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					id,
					data.blueprintId,
					data.waveNumber,
					data.name,
					data.goal,
					data.parallel ? 1 : 0,
					data.ordinal,
					now,
				],
			);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			if (message.includes('UNIQUE')) {
				throw new RepoConstraintViolationError(
					`Wave ${data.waveNumber} already exists for blueprint ${data.blueprintId}`,
					err,
				);
			}
			throw mapSqliteError(err, { operation: 'createWave', table: 'spec_waves' });
		}

		return this.getWave(id)!;
	}

	getWave(id: string): SpecWave | null {
		const row = this.db
			.query('SELECT * FROM spec_waves WHERE id = ?')
			.get(id) as SpecWaveRow | null;
		return row ? rowToSpecWave(row) : null;
	}

	listWaves(blueprintId: string): SpecWave[] {
		const rows = this.db
			.query(
				'SELECT * FROM spec_waves WHERE blueprint_id = ? ORDER BY wave_number ASC',
			)
			.all(blueprintId) as SpecWaveRow[];
		return rows.map(rowToSpecWave);
	}

	// ---- Task operations ---------------------------------------------------

	listByWave(waveId: string): SpecTask[] {
		const rows = this.db
			.query(
				'SELECT * FROM spec_tasks WHERE wave_id = ? ORDER BY ordinal ASC',
			)
			.all(waveId) as SpecTaskRow[];
		return rows.map(rowToSpecTask);
	}

	/**
	 * List all tasks matching a given status across all waves of a workflow.
	 *
	 * Joins spec_tasks → spec_waves → spec_blueprints → spec_workflows to
	 * find tasks belonging to the workflow identified by its UUID primary key.
	 */
	listByStatus(workflowId: string, status: SpecTaskStatus): SpecTask[] {
		const rows = this.db
			.query(
				`SELECT t.* FROM spec_tasks t
				 JOIN spec_waves w ON w.id = t.wave_id
				 JOIN spec_blueprints b ON b.id = w.blueprint_id
				 WHERE b.workflow_id = ? AND t.status = ?
				 ORDER BY w.wave_number ASC, t.ordinal ASC`,
			)
			.all(workflowId, status) as SpecTaskRow[];
		return rows.map(rowToSpecTask);
	}

	get(id: string): SpecTask | null {
		const row = this.db
			.query('SELECT * FROM spec_tasks WHERE id = ?')
			.get(id) as SpecTaskRow | null;
		return row ? rowToSpecTask(row) : null;
	}

	getByTaskId(waveId: string, taskId: string): SpecTask | null {
		const row = this.db
			.query('SELECT * FROM spec_tasks WHERE wave_id = ? AND task_id = ?')
			.get(waveId, taskId) as SpecTaskRow | null;
		return row ? rowToSpecTask(row) : null;
	}

	create(input: CreateTaskInput): SpecTask {
		const data = CreateTaskInputSchema.parse(input);
		const id = crypto.randomUUID();
		const now = new Date().toISOString();

		try {
			this.db.run(
				`INSERT INTO spec_tasks (
					id, wave_id, task_id, name, executor, files, action, done,
					verify, status, ordinal, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					id,
					data.waveId,
					data.taskId,
					data.name,
					data.executor,
					JSON.stringify(data.files),
					data.action,
					data.done,
					data.verify,
					data.status,
					data.ordinal,
					now,
					now,
				],
			);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			if (message.includes('UNIQUE')) {
				throw new RepoConstraintViolationError(
					`Task ${data.taskId} already exists in wave ${data.waveId}`,
					err,
				);
			}
			throw mapSqliteError(err, { operation: 'create', table: 'spec_tasks' });
		}

		return this.get(id)!;
	}

	assign(id: string, agentRunId: string): SpecTask {
		return this.mutateStatus(id, {
			status: 'in_progress',
			agentRunId,
			startedAt: new Date().toISOString(),
		});
	}

	/**
	 * Mark a task complete.
	 *
	 * Sets status to `complete` and stamps `completed_at`.  The `outputs`
	 * option is intentionally not persisted to spec_tasks (the table has no
	 * outputs column).  If the caller needs to record outputs, it should
	 * append a chronicle entry separately via SpecChronicleRepo.
	 */
	markComplete(id: string, opts?: { outputs?: string }): SpecTask {
		// opts.outputs is intentionally unused here — documented in JSDoc above.
		void opts;
		return this.mutateStatus(id, {
			status: 'complete',
			completedAt: new Date().toISOString(),
		});
	}

	markBlocked(_id: string, _reason: string): SpecTask {
		// reason is accepted for API compatibility but not persisted (spec_tasks
		// has no reason column).  Callers should append an ADL or chronicle entry.
		return this.mutateStatus(_id, { status: 'blocked' });
	}

	markSkipped(id: string): SpecTask {
		return this.mutateStatus(id, { status: 'skipped' });
	}

	reset(id: string): SpecTask {
		return this.mutateStatus(id, {
			status: 'pending',
			agentRunId: null,
			startedAt: null,
			completedAt: null,
		});
	}

	// ---- Internal helpers --------------------------------------------------

	private mutateStatus(
		id: string,
		fields: {
			status: SpecTaskStatus;
			agentRunId?: string | null;
			startedAt?: string | null;
			completedAt?: string | null;
		},
	): SpecTask {
		const now = new Date().toISOString();

		this.withTransaction(() => {
			const existing = this.get(id);
			if (!existing) {
				throw new RowNotFoundError({ table: 'spec_tasks', id, idColumn: 'id' });
			}

			const setClauses: string[] = ['status = ?', 'updated_at = ?'];
			const params: SQLQueryBindings[] = [fields.status, now];

			if ('agentRunId' in fields) {
				setClauses.push('agent_run_id = ?');
				params.push(fields.agentRunId ?? null);
			}
			if ('startedAt' in fields) {
				setClauses.push('started_at = ?');
				params.push(fields.startedAt ?? null);
			}
			if ('completedAt' in fields) {
				setClauses.push('completed_at = ?');
				params.push(fields.completedAt ?? null);
			}

			params.push(id);

			try {
				this.db.run(
					`UPDATE spec_tasks SET ${setClauses.join(', ')} WHERE id = ?`,
					params,
				);
			} catch (err: unknown) {
				throw mapSqliteError(err, { operation: 'mutateStatus', table: 'spec_tasks' });
			}
		});

		return this.get(id)!;
	}
}
