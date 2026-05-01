import { Elysia, t } from 'elysia';

import commandsRegistry from '../commands/workflow/COMMANDS_REGISTRY.json' with { type: 'json' };
import type { Database } from '../db/database.ts';
import { SpecAdlRepo, SpecAdlEntryTypeSchema } from '../db/repo/spec/adl.ts';
import { SpecChronicleRepo } from '../db/repo/spec/chronicle.ts';
import { SpecDocumentsRepo, SpecDocTypeSchema } from '../db/repo/spec/documents.ts';
import { MustHavesRepo } from '../db/repo/spec/must-haves.ts';
import { SpecRenderer } from '../db/repo/spec/render.ts';
import { SpecTasksRepo, SpecTaskStatus } from '../db/repo/spec/tasks.ts';
import { emit } from '../hooks/emit.ts';
import type { HookRegistry } from '../hooks/registry.ts';
import { StateManager } from '../state/manager.ts';
import { SpecWorkflowDepth, SpecWorkflowMode, SpecWorkflowPhase } from '../state/schema.ts';

type SpecRouteDeps = {
	db: Database;
	stateManager: StateManager;
	hookRegistry?: HookRegistry;
};

type CommandEntry = {
	trigger: string;
	description: string;
	agent?: string;
	phase?: string;
};

// In-memory cache of commands loaded at module initialization
const cachedCommands: CommandEntry[] = commandsRegistry.map((cmd) => ({
	trigger: cmd.trigger,
	description: cmd.description,
	agent: cmd.agent,
	phase: cmd.phase,
}));

type ErrorBody = { error: { code: string; message: string; details?: unknown } };
type DataBody<T> = { data: T };

type WorkflowLookup = {
	id: string;
	projectId: string;
	workflowId: string;
	currentWave: number;
	totalWaves: number;
};

type WaveWithTaskCount = {
	id: string;
	blueprintId: string;
	waveNumber: number;
	name: string;
	goal: string;
	parallel: boolean;
	ordinal: number;
	createdAt: string;
	taskCount: number;
	pendingCount: number;
	inProgressCount: number;
	completeCount: number;
	blockedCount: number;
};

type WaveRow = {
	id: string;
	blueprint_id: string;
	wave_number: number;
	name: string;
	goal: string;
	parallel: number;
	ordinal: number;
	created_at: string;
	task_count: number;
	pending_count: number;
	in_progress_count: number;
	complete_count: number;
	blocked_count: number;
};

const TASK_STATUS_VALUES = SpecTaskStatus.options;
const ADL_TYPE_VALUES = SpecAdlEntryTypeSchema.options;
const DOC_TYPE_VALUES = SpecDocTypeSchema.options.map((value) => value.toLowerCase());

function data<T>(value: T): DataBody<T> {
	return { data: value };
}

function error(code: string, message: string, details?: unknown): ErrorBody {
	return { error: { code, message, details } };
}

function statusForError(code: string): number {
	switch (code) {
		case 'VALIDATION_FAILED':
		case 'VALIDATION_ERROR':
			return 400;
		case 'WORKFLOW_NOT_FOUND':
		case 'TASK_NOT_FOUND':
			return 404;
		case 'WORKFLOW_EXISTS':
		case 'INVALID_PHASE':
			return 409;
		case 'INVALID_TRANSITION':
			return 400;
		case 'SPEC_LOCKED':
			return 423;
		default:
			return 500;
	}
}

function codeFromUnknown(caught: unknown): string {
	if (caught && typeof caught === 'object' && 'name' in caught) {
		const name = (caught as { name?: unknown }).name;
		if (name === 'ZodError') return 'VALIDATION_FAILED';
		if (name === 'RowNotFoundError') return 'WORKFLOW_NOT_FOUND';
	}

	if (caught && typeof caught === 'object' && 'details' in caught) {
		const details = (caught as { details?: unknown }).details;
		if (details && typeof details === 'object' && 'code' in details) {
			const code = (details as { code?: unknown }).code;
			if (typeof code === 'string') return code;
		}
	}

	if (caught && typeof caught === 'object' && 'code' in caught) {
		const code = (caught as { code?: unknown }).code;
		if (typeof code === 'string') return code;
	}

	return 'INTERNAL_ERROR';
}

function messageFromUnknown(caught: unknown): string {
	return caught instanceof Error ? caught.message : String(caught);
}

function respondError(set: { status?: number | string }, caught: unknown): ErrorBody {
	const code = codeFromUnknown(caught);
	set.status = statusForError(code);
	return error(code, messageFromUnknown(caught), caught);
}

function findWorkflow(db: Database, workflowId: string, projectId?: string): WorkflowLookup | null {
	const row = projectId
		? db.db
			.query(
				`SELECT id, project_id, workflow_id, current_wave, total_waves
				 FROM spec_workflows
				 WHERE project_id = ? AND (workflow_id = ? OR id = ?)
				 LIMIT 1`,
			)
			.get(projectId, workflowId, workflowId)
		: db.db
			.query(
				`SELECT id, project_id, workflow_id, current_wave, total_waves
				 FROM spec_workflows
				 WHERE workflow_id = ? OR id = ?
				 ORDER BY last_activity DESC
				 LIMIT 1`,
			)
			.get(workflowId, workflowId);

	if (!row) return null;
	const typed = row as {
		id: string;
		project_id: string;
		workflow_id: string;
		current_wave: number;
		total_waves: number;
	};
	return {
		id: typed.id,
		projectId: typed.project_id,
		workflowId: typed.workflow_id,
		currentWave: typed.current_wave,
		totalWaves: typed.total_waves,
	};
}

function requireWorkflow(db: Database, workflowId: string, projectId?: string): WorkflowLookup {
	const workflow = findWorkflow(db, workflowId, projectId);
	if (!workflow) {
		throw Object.assign(new Error(`Workflow not found: ${workflowId}`), {
			code: 'WORKFLOW_NOT_FOUND',
		});
	}
	return workflow;
}

function listWavesForWorkflow(db: Database, workflowPk: string): WaveWithTaskCount[] {
	const rows = db.db
		.query(
			`SELECT
				w.*,
				COUNT(t.id) AS task_count,
				SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
				SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
				SUM(CASE WHEN t.status = 'complete' THEN 1 ELSE 0 END) AS complete_count,
				SUM(CASE WHEN t.status = 'blocked' THEN 1 ELSE 0 END) AS blocked_count
			 FROM spec_blueprints b
			 JOIN spec_waves w ON w.blueprint_id = b.id
			 LEFT JOIN spec_tasks t ON t.wave_id = w.id
			 WHERE b.workflow_id = ?
			 GROUP BY w.id
			 ORDER BY w.wave_number ASC`,
		)
		.all(workflowPk) as WaveRow[];

	return rows.map((row) => ({
		id: row.id,
		blueprintId: row.blueprint_id,
		waveNumber: row.wave_number,
		name: row.name,
		goal: row.goal,
		parallel: row.parallel === 1,
		ordinal: row.ordinal,
		createdAt: row.created_at,
		taskCount: row.task_count,
		pendingCount: row.pending_count,
		inProgressCount: row.in_progress_count,
		completeCount: row.complete_count,
		blockedCount: row.blocked_count,
	}));
}

function waveTaskCount(db: Database, workflowPk: string, waveNumber: number): number {
	const row = db.db
		.query(
			`SELECT COUNT(t.id) AS count
			 FROM spec_blueprints b
			 JOIN spec_waves w ON w.blueprint_id = b.id
			 LEFT JOIN spec_tasks t ON t.wave_id = w.id
			 WHERE b.workflow_id = ? AND w.wave_number = ?`,
		)
		.get(workflowPk, waveNumber) as { count: number } | null;
	return row?.count ?? 0;
}

function listTasksForWorkflow(
	db: Database,
	workflowPk: string,
	filters: { status?: string; wave?: number },
) {
	const params: Array<string | number> = [workflowPk];
	let sql = `SELECT t.* FROM spec_tasks t
		JOIN spec_waves w ON w.id = t.wave_id
		JOIN spec_blueprints b ON b.id = w.blueprint_id
		WHERE b.workflow_id = ?`;

	if (filters.status) {
		sql += ' AND t.status = ?';
		params.push(filters.status);
	}

	if (typeof filters.wave === 'number') {
		sql += ' AND w.wave_number = ?';
		params.push(filters.wave);
	}

	sql += ' ORDER BY w.wave_number ASC, t.ordinal ASC';

	const rows = db.db.query(sql).all(...params) as Array<{ id: string }>;
	const repo = new SpecTasksRepo(db);
	return rows.map((row) => repo.get(row.id)).filter((task) => task !== null);
}

function renderDocument(db: Database, workflowPk: string, docType: string): string {
	const normalized = docType.toLowerCase();
	const renderer = new SpecRenderer(db);
	switch (normalized) {
		case 'requirements':
			return renderer.renderRequirements(workflowPk);
		case 'spec':
			return renderer.renderSpec(workflowPk);
		case 'blueprint':
			return renderer.renderBlueprint(workflowPk);
		case 'chronicle':
			return renderer.renderChronicle(workflowPk);
		case 'adl':
			return renderer.renderAdl(workflowPk);
		default:
			throw Object.assign(new Error(`Unsupported document type: ${docType}`), {
				code: 'VALIDATION_FAILED',
			});
	}
}

function createSpecRoutes(deps: SpecRouteDeps) {
	const { db, stateManager, hookRegistry } = deps;

	return new Elysia({ prefix: '/api/wf' })
		.get('/commands', () => {
			// Return cached command list for frontend completions overlay
			return data({ commands: cachedCommands });
		})
		.get('/projects/:projectId/workflows', async ({ params, set }) => {
			try {
				return data(await stateManager.listSpecWorkflows(params.projectId));
			} catch (caught) {
				return respondError(set, caught);
			}
		})
		.post(
			'/projects/:projectId/workflows',
			async ({ params, body, set }) => {
				try {
					const mode = body.mode === undefined ? undefined : SpecWorkflowMode.parse(body.mode);
					const depth = body.depth === undefined ? undefined : SpecWorkflowDepth.parse(body.depth);
					const workflow = await stateManager.createSpecWorkflow({
						projectId: params.projectId,
						workflowId: body.workflowId,
						mode,
						depth,
						autopilot: body.autopilot,
						lazyAutopilot: body.lazyAutopilot,
						totalWaves: body.totalWaves,
						isActive: body.isActive,
					});
					set.status = 201;
					return data(workflow);
				} catch (caught) {
					return respondError(set, caught);
				}
			},
			{
				body: t.Object({
					workflowId: t.String({ minLength: 1 }),
					mode: t.Optional(t.String()),
					depth: t.Optional(t.String()),
					autopilot: t.Optional(t.Boolean()),
					lazyAutopilot: t.Optional(t.Boolean()),
					totalWaves: t.Optional(t.Number({ minimum: 0 })),
					isActive: t.Optional(t.Boolean()),
				}),
			},
		)
		.get('/workflows/:workflowId', async ({ params, set }) => {
			try {
				const lookup = requireWorkflow(db, params.workflowId);
				const workflow = await stateManager.getSpecWorkflow(lookup.projectId, lookup.workflowId);
				if (!workflow) throw Object.assign(new Error('Workflow not found'), { code: 'WORKFLOW_NOT_FOUND' });
				return data(workflow);
			} catch (caught) {
				return respondError(set, caught);
			}
		})
		.patch(
			'/workflows/:workflowId/phase',
			async ({ params, body, set }) => {
				try {
					const lookup = requireWorkflow(db, params.workflowId);
					return data(await stateManager.transitionPhase(lookup.projectId, lookup.workflowId, SpecWorkflowPhase.parse(body.to), {
						force: body.force,
						reason: body.reason,
					}));
				} catch (caught) {
					return respondError(set, caught);
				}
			},
			{
				body: t.Object({
					to: t.String(),
					force: t.Optional(t.Boolean()),
					reason: t.Optional(t.String()),
				}),
			},
		)
		.post('/workflows/:workflowId/lock', async ({ params, set }) => {
			try {
				const lookup = requireWorkflow(db, params.workflowId);
				return data(await stateManager.lock(lookup.projectId, lookup.workflowId));
			} catch (caught) {
				return respondError(set, caught);
			}
		})
		.post('/workflows/:workflowId/unlock', async ({ params, set }) => {
			try {
				const lookup = requireWorkflow(db, params.workflowId);
				return data(await stateManager.unlock(lookup.projectId, lookup.workflowId));
			} catch (caught) {
				return respondError(set, caught);
			}
		})
		.post(
			'/workflows/:workflowId/amend',
			async ({ params, body, set }) => {
				try {
					const lookup = requireWorkflow(db, params.workflowId);
					const workflow = await stateManager.amendSpec(lookup.projectId, lookup.workflowId, {
						rationale: body.rationale,
					});
					return data(workflow);
				} catch (caught) {
					return respondError(set, caught);
				}
			},
			{ body: t.Object({ rationale: t.String({ minLength: 1 }) }) },
		)
		.post(
			'/projects/:projectId/workflows/active',
			async ({ params, body, set }) => {
				try {
					return data(await stateManager.setActiveSpecWorkflow(params.projectId, body.workflowId));
				} catch (caught) {
					return respondError(set, caught);
				}
			},
			{ body: t.Object({ workflowId: t.String({ minLength: 1 }) }) },
		)
		.get('/workflows/:workflowId/spec', ({ params, set }) => {
			try {
				const lookup = requireWorkflow(db, params.workflowId);
				const docs = new SpecDocumentsRepo(db);
				const mustHaves = new MustHavesRepo(db);
				return data({
					document: docs.getSpec(lookup.id),
					mustHaves: mustHaves.list(lookup.id),
					acceptanceCriteria: mustHaves.listAcceptanceCriteriaForWorkflow(lookup.id),
					validationContracts: mustHaves.listValidationContractsForWorkflow(lookup.id),
					outOfScope: docs.getOutOfScope(lookup.id),
				});
			} catch (caught) {
				return respondError(set, caught);
			}
		})
		.get('/workflows/:workflowId/requirements', ({ params, set }) => {
			try {
				const lookup = requireWorkflow(db, params.workflowId);
				return data(new SpecDocumentsRepo(db).getRequirements(lookup.id));
			} catch (caught) {
				return respondError(set, caught);
			}
		})
		.get('/workflows/:workflowId/blueprint', ({ params, set }) => {
			try {
				const lookup = requireWorkflow(db, params.workflowId);
				return data(new SpecDocumentsRepo(db).getBlueprint(lookup.id));
			} catch (caught) {
				return respondError(set, caught);
			}
		})
		.get('/workflows/:workflowId/chronicle', ({ params, query, set }) => {
			try {
				const lookup = requireWorkflow(db, params.workflowId);
				const limit = typeof query.limit === 'string' ? Number(query.limit) : undefined;
				const since = typeof query.since === 'string' ? query.since : undefined;
				return data(new SpecChronicleRepo(db).list(lookup.id, { limit, since }));
			} catch (caught) {
				return respondError(set, caught);
			}
		})
		.get('/workflows/:workflowId/adl', ({ params, query, set }) => {
			try {
				const lookup = requireWorkflow(db, params.workflowId);
				const limit = typeof query.limit === 'string' ? Number(query.limit) : undefined;
				const type = typeof query.type === 'string' && ADL_TYPE_VALUES.includes(query.type as typeof ADL_TYPE_VALUES[number])
					? query.type as typeof ADL_TYPE_VALUES[number]
					: undefined;
				return data(new SpecAdlRepo(db).list(lookup.id, { limit, type }));
			} catch (caught) {
				return respondError(set, caught);
			}
		})
		.get('/workflows/:workflowId/render/:docType', ({ params, set }) => {
			try {
				if (!DOC_TYPE_VALUES.includes(params.docType.toLowerCase())) {
					set.status = 400;
					return error('VALIDATION_FAILED', `Unsupported document type: ${params.docType}`);
				}
				const lookup = requireWorkflow(db, params.workflowId);
				return data({
					content: renderDocument(db, lookup.id, params.docType),
					docType: params.docType,
					workflowId: lookup.workflowId,
				});
			} catch (caught) {
				return respondError(set, caught);
			}
		})
		.get('/workflows/:workflowId/blueprint/waves', ({ params, set }) => {
			try {
				const lookup = requireWorkflow(db, params.workflowId);
				return data(listWavesForWorkflow(db, lookup.id));
			} catch (caught) {
				return respondError(set, caught);
			}
		})
		.post('/workflows/:workflowId/waves/:waveNumber/start', async ({ params, set }) => {
			try {
				const waveNumber = Number(params.waveNumber);
				const lookup = requireWorkflow(db, params.workflowId);
				const totalWaves = Math.max(lookup.totalWaves, waveNumber);
				const workflow = await stateManager.updateWave(lookup.projectId, lookup.workflowId, waveNumber, totalWaves);
				if (hookRegistry && waveNumber <= lookup.currentWave) {
					void emit(hookRegistry, 'wave:started', {
						projectId: lookup.projectId,
						workflowId: lookup.workflowId,
						waveNumber,
						taskCount: waveTaskCount(db, lookup.id, waveNumber),
					}).catch((caught) => console.error('[elefant] Failed to emit wave:started:', caught));
				}
				return data(workflow);
			} catch (caught) {
				return respondError(set, caught);
			}
		})
		.post('/workflows/:workflowId/waves/:waveNumber/complete', async ({ params, set }) => {
			try {
				const waveNumber = Number(params.waveNumber);
				const lookup = requireWorkflow(db, params.workflowId);
				const nextWave = waveNumber >= lookup.totalWaves ? waveNumber : waveNumber + 1;
				const workflow = await stateManager.updateWave(lookup.projectId, lookup.workflowId, nextWave, Math.max(lookup.totalWaves, waveNumber));
				if (hookRegistry && nextWave === lookup.currentWave) {
					void emit(hookRegistry, 'wave:completed', {
						projectId: lookup.projectId,
						workflowId: lookup.workflowId,
						waveNumber,
					}).catch((caught) => console.error('[elefant] Failed to emit wave:completed:', caught));
				}
				return data(workflow);
			} catch (caught) {
				return respondError(set, caught);
			}
		})
		.get('/workflows/:workflowId/tasks', ({ params, query, set }) => {
			try {
				const lookup = requireWorkflow(db, params.workflowId);
				const status = typeof query.status === 'string' && TASK_STATUS_VALUES.includes(query.status as typeof TASK_STATUS_VALUES[number])
					? query.status
					: undefined;
				const wave = typeof query.wave === 'string' ? Number(query.wave) : undefined;
				return data(listTasksForWorkflow(db, lookup.id, { status, wave }));
			} catch (caught) {
				return respondError(set, caught);
			}
		})
		.get('/tasks/:taskId', ({ params, set }) => {
			try {
				const task = new SpecTasksRepo(db).get(params.taskId);
				if (!task) throw Object.assign(new Error(`Task not found: ${params.taskId}`), { code: 'TASK_NOT_FOUND' });
				return data(task);
			} catch (caught) {
				return respondError(set, caught);
			}
		})
		.post(
			'/tasks/:taskId/assign',
			({ params, body, set }) => {
				try {
					return data(new SpecTasksRepo(db, hookRegistry).assign(params.taskId, body.agentRunId));
				} catch (caught) {
					return respondError(set, caught);
				}
			},
			{ body: t.Object({ agentRunId: t.String({ minLength: 1 }) }) },
		)
		.post(
			'/tasks/:taskId/complete',
			({ params, body, set }) => {
				try {
					return data(new SpecTasksRepo(db, hookRegistry).markComplete(params.taskId, { outputs: body.outputs }));
				} catch (caught) {
					return respondError(set, caught);
				}
			},
			{ body: t.Object({ outputs: t.Optional(t.String()), commitSha: t.Optional(t.String()) }) },
		)
		.post(
			'/tasks/:taskId/block',
			({ params, body, set }) => {
				try {
					return data(new SpecTasksRepo(db, hookRegistry).markBlocked(params.taskId, body.reason));
				} catch (caught) {
					return respondError(set, caught);
				}
			},
			{ body: t.Object({ reason: t.String({ minLength: 1 }) }) },
		)
		.post('/tasks/:taskId/reset', ({ params, set }) => {
			try {
				return data(new SpecTasksRepo(db, hookRegistry).reset(params.taskId));
			} catch (caught) {
				return respondError(set, caught);
			}
		});
}

export const workflowRoutes = createSpecRoutes;

export function mountWorkflowRoutes(app: Elysia, deps: SpecRouteDeps): Elysia {
	app.use(createSpecRoutes(deps));
	return app;
}
