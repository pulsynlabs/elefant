import type { Database as BunDatabase } from 'bun:sqlite';
import { z } from 'zod';

import type { Database } from '../../db/database.ts';
import type { StateManager } from '../../state/manager.ts';
import type { HookRegistry } from '../../hooks/registry.ts';
import type { SpecWorkflow, SpecWorkflowPhase } from '../../state/schema.ts';
import { InvalidTransitionError, SpecLockedError, WorkflowNotFoundError } from '../../state/errors.ts';
import { SpecToolError } from './errors.ts';

export interface SpecToolPermissions {
	read: boolean;
	write: boolean;
	execute: boolean;
}

export interface SpecToolContext {
	database: Database;
	stateManager: StateManager;
	workflowId: string;
	projectId: string;
	runId?: string;
	hookRegistry?: HookRegistry;
}

export type SpecToolResult<TResult> = TResult | SpecToolError;

export interface SpecToolExample {
	name: string;
	payload: unknown;
}

type IdempotentArgs = {
	workflowId?: string;
	projectId?: string;
	idempotency_key?: string;
};

type IdempotencyRow = {
	result_payload: string;
	created_at: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function maybeRecord(value: unknown): IdempotentArgs {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? value as IdempotentArgs
		: {};
}

function isFresh(createdAt: string): boolean {
	const created = Date.parse(createdAt.endsWith('Z') ? createdAt : `${createdAt}Z`);
	return Number.isFinite(created) && Date.now() - created < DAY_MS;
}

export async function resolveSpecWorkflow(ctx: SpecToolContext, args: { workflowId?: string; projectId?: string }): Promise<SpecWorkflow> {
	const projectId = args.projectId ?? ctx.projectId;
	const workflowId = args.workflowId ?? ctx.workflowId;
	const workflow = await ctx.stateManager.getSpecWorkflow(projectId, workflowId);
	if (!workflow) {
		throw new WorkflowNotFoundError({ code: 'WORKFLOW_NOT_FOUND', projectId, workflowId });
	}
	return workflow;
}

export abstract class SpecTool<TArgs = unknown, TResult = unknown> {
	abstract readonly name: string;
	abstract readonly description: string;
	abstract readonly schema: z.ZodType<TArgs>;
	abstract readonly allowedPhases: SpecWorkflowPhase[];
	abstract readonly permissions: SpecToolPermissions;
	abstract readonly examples: SpecToolExample[];

	async run(ctx: SpecToolContext, rawArgs: unknown): Promise<SpecToolResult<TResult>> {
		const parsed = this.schema.safeParse(rawArgs);
		if (!parsed.success) {
			return new SpecToolError('VALIDATION_FAILED', `Invalid payload for ${this.name}`, parsed.error.flatten());
		}

		const recordArgs = maybeRecord(parsed.data);
		const projectId = recordArgs.projectId ?? ctx.projectId;
		const workflowId = recordArgs.workflowId ?? ctx.workflowId;

		let workflow: SpecWorkflow;
		try {
			workflow = await resolveSpecWorkflow(ctx, { projectId, workflowId });
		} catch (error) {
			if (error instanceof WorkflowNotFoundError) {
				return new SpecToolError('WORKFLOW_NOT_FOUND', `Workflow not found: ${workflowId}`, { projectId, workflowId });
			}
			throw error;
		}

		if (this.allowedPhases.length > 0 && !this.allowedPhases.includes(workflow.phase)) {
			return new SpecToolError('INVALID_PHASE', `${this.name} is not available in phase ${workflow.phase}`, {
				actual: workflow.phase,
				allowed: this.allowedPhases,
			});
		}

		const idempotencyKey = recordArgs.idempotency_key;
		if (idempotencyKey) {
			const cached = this.getCached(ctx.database.db, workflow.id, idempotencyKey);
			if (cached) return cached as TResult;
		}

		let result: TResult;
		try {
			result = await this.execute(ctx, parsed.data);
		} catch (error) {
			if (error instanceof SpecLockedError) {
				return new SpecToolError('SPEC_LOCKED', error.message, { workflowId: error.workflowId, attempted: error.attempted, projectId: error.projectId });
			}
			if (error instanceof InvalidTransitionError) {
				return new SpecToolError('INVALID_TRANSITION', error.message, { from: error.from, to: error.to, allowed: error.allowed });
			}
			if (error instanceof WorkflowNotFoundError) {
				return new SpecToolError('WORKFLOW_NOT_FOUND', error.message, { projectId: error.projectId, workflowId: error.workflowId });
			}
			throw error;
		}

		if (idempotencyKey) {
			this.cacheResult(ctx.database.db, workflow.id, idempotencyKey, result);
		}

		return result;
	}

	protected abstract execute(ctx: SpecToolContext, args: TArgs): Promise<TResult>;

	private getCached(db: BunDatabase, workflowId: string, idempotencyKey: string): unknown | null {
		const row = db
			.query(
				`SELECT result_payload, created_at FROM spec_idempotency
				 WHERE workflow_id = ? AND tool_name = ? AND idempotency_key = ?`,
			)
			.get(workflowId, this.name, idempotencyKey) as IdempotencyRow | null;

		if (!row || !isFresh(row.created_at)) return null;
		return JSON.parse(row.result_payload) as unknown;
	}

	private cacheResult(db: BunDatabase, workflowId: string, idempotencyKey: string, result: TResult): void {
		db.run(
			`INSERT INTO spec_idempotency (workflow_id, tool_name, idempotency_key, result_payload)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(workflow_id, tool_name, idempotency_key) DO NOTHING`,
			[workflowId, this.name, idempotencyKey, JSON.stringify(result)],
		);
	}
}
