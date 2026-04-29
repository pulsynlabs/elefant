import { z } from 'zod';

import { SpecWorkflowDepth, SpecWorkflowMode, SpecWorkflowPhase } from '../../state/schema.ts';
import type { SpecWorkflow } from '../../state/schema.ts';
import { SpecTool, type SpecToolContext } from './base.ts';

const baseWorkflowFields = {
	projectId: z.string().min(1),
	workflowId: z.string().min(1),
};

const statusSchema = z.object(baseWorkflowFields);
export type SpecStatusArgs = z.infer<typeof statusSchema>;

export interface SpecStatusPayload {
	phase: SpecWorkflow['phase'];
	mode: SpecWorkflow['mode'];
	depth: SpecWorkflow['depth'];
	autopilot: boolean;
	lazyAutopilot: boolean;
	specLocked: boolean;
	acceptanceConfirmed: boolean;
	interviewComplete: boolean;
	currentWave: number;
	totalWaves: number;
	lastActivity: string;
	workflowId: string;
	projectId: string;
}

function toStatus(workflow: SpecWorkflow): SpecStatusPayload {
	return {
		phase: workflow.phase,
		mode: workflow.mode,
		depth: workflow.depth,
		autopilot: workflow.autopilot,
		lazyAutopilot: workflow.lazyAutopilot,
		specLocked: workflow.specLocked,
		acceptanceConfirmed: workflow.acceptanceConfirmed,
		interviewComplete: workflow.interviewComplete,
		currentWave: workflow.currentWave,
		totalWaves: workflow.totalWaves,
		lastActivity: workflow.lastActivity,
		workflowId: workflow.workflowId,
		projectId: workflow.projectId,
	};
}

/** @example {"projectId":"project-1","workflowId":"spec-mode"} */
export class SpecStatusTool extends SpecTool<SpecStatusArgs, SpecStatusPayload> {
	readonly name = 'spec_status';
	readonly description = 'Read the active Spec Mode workflow status with an invariant payload shape.';
	readonly schema = statusSchema;
	readonly allowedPhases = [];
	readonly permissions = { read: true, write: false, execute: false };
	readonly examples = [{ name: 'status', payload: { projectId: 'project-1', workflowId: 'spec-mode' } }];

	protected async execute(ctx: SpecToolContext, args: SpecStatusArgs): Promise<SpecStatusPayload> {
		const workflow = await ctx.stateManager.getSpecWorkflow(args.projectId, args.workflowId);
		if (!workflow) throw new Error(`Workflow not found: ${args.workflowId}`);
		return toStatus(workflow);
	}
}

const stateSchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('get'), ...baseWorkflowFields }),
	z.object({ action: z.literal('transition'), ...baseWorkflowFields, to: SpecWorkflowPhase, force: z.boolean().optional() }),
	z.object({ action: z.literal('lock-spec'), ...baseWorkflowFields }),
	z.object({ action: z.literal('unlock-spec'), ...baseWorkflowFields }),
	z.object({ action: z.literal('set-mode'), ...baseWorkflowFields, mode: SpecWorkflowMode }),
	z.object({ action: z.literal('set-depth'), ...baseWorkflowFields, depth: SpecWorkflowDepth }),
	z.object({ action: z.literal('set-autopilot'), ...baseWorkflowFields, autopilot: z.boolean(), lazy: z.boolean().optional() }),
	z.object({ action: z.literal('update-wave'), ...baseWorkflowFields, currentWave: z.number().int().nonnegative(), totalWaves: z.number().int().nonnegative() }),
	z.object({ action: z.literal('complete-interview'), ...baseWorkflowFields }),
]);
export type SpecStateArgs = z.infer<typeof stateSchema>;

/** @example {"action":"get","projectId":"project-1","workflowId":"spec-mode"} */
export class SpecStateTool extends SpecTool<SpecStateArgs, SpecWorkflow | null> {
	readonly name = 'spec_state';
	readonly description = 'Read or mutate Spec Mode workflow state through StateManager operations.';
	readonly schema = stateSchema;
	readonly allowedPhases = [];
	readonly permissions = { read: true, write: true, execute: false };
	readonly examples = [{ name: 'get', payload: { action: 'get', projectId: 'project-1', workflowId: 'spec-mode' } }];

	protected async execute(ctx: SpecToolContext, args: SpecStateArgs): Promise<SpecWorkflow | null> {
		switch (args.action) {
			case 'get': return ctx.stateManager.getSpecWorkflow(args.projectId, args.workflowId);
			case 'transition': return ctx.stateManager.transitionSpecPhase(args.projectId, args.workflowId, args.to, { force: args.force });
			case 'lock-spec': return ctx.stateManager.lockSpec(args.projectId, args.workflowId);
			case 'unlock-spec': return ctx.stateManager.unlockSpec(args.projectId, args.workflowId);
			case 'set-mode': return ctx.stateManager.setMode(args.projectId, args.workflowId, args.mode);
			case 'set-depth': return ctx.stateManager.setDepth(args.projectId, args.workflowId, args.depth);
			case 'set-autopilot': return ctx.stateManager.setAutopilot(args.projectId, args.workflowId, args.autopilot, args.lazy);
			case 'update-wave': return ctx.stateManager.updateWave(args.projectId, args.workflowId, args.currentWave, args.totalWaves);
			case 'complete-interview': return ctx.stateManager.completeInterview(args.projectId, args.workflowId);
		}
	}
}

const workflowSchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('list'), projectId: z.string().min(1) }),
	z.object({ action: z.literal('create'), projectId: z.string().min(1), workflowId: z.string().min(1), mode: SpecWorkflowMode.optional(), depth: SpecWorkflowDepth.optional(), autopilot: z.boolean().optional(), lazyAutopilot: z.boolean().optional() }),
	z.object({ action: z.literal('set-active'), ...baseWorkflowFields }),
]);
export type SpecWorkflowArgs = z.infer<typeof workflowSchema>;

/** @example {"action":"list","projectId":"project-1"} */
export class SpecWorkflowTool extends SpecTool<SpecWorkflowArgs, SpecWorkflow[] | SpecWorkflow> {
	readonly name = 'spec_workflow';
	readonly description = 'List, create, or activate Spec Mode workflows for a project.';
	readonly schema = workflowSchema;
	readonly allowedPhases = [];
	readonly permissions = { read: true, write: true, execute: false };
	readonly examples = [{ name: 'list', payload: { action: 'list', projectId: 'project-1' } }];

	async run(ctx: SpecToolContext, rawArgs: unknown): Promise<SpecWorkflow[] | SpecWorkflow | import('./errors.ts').SpecToolError> {
		const record = typeof rawArgs === 'object' && rawArgs !== null ? rawArgs as Record<string, unknown> : {};
		if (record.action === 'list' || record.action === 'create') {
			return this.runWithoutExistingWorkflow(ctx, rawArgs);
		}
		return super.run(ctx, rawArgs);
	}

	private async runWithoutExistingWorkflow(ctx: SpecToolContext, rawArgs: unknown): Promise<SpecWorkflow[] | SpecWorkflow | import('./errors.ts').SpecToolError> {
		const { SpecToolError } = await import('./errors.ts');
		const parsed = this.schema.safeParse(rawArgs);
		if (!parsed.success) return new SpecToolError('VALIDATION_FAILED', `Invalid payload for ${this.name}`, parsed.error.flatten());
		return this.execute(ctx, parsed.data);
	}

	protected async execute(ctx: SpecToolContext, args: SpecWorkflowArgs): Promise<SpecWorkflow[] | SpecWorkflow> {
		switch (args.action) {
			case 'list': return ctx.stateManager.listSpecWorkflows(args.projectId);
			case 'create': return ctx.stateManager.createSpecWorkflow({ projectId: args.projectId, workflowId: args.workflowId, mode: args.mode, depth: args.depth, autopilot: args.autopilot, lazyAutopilot: args.lazyAutopilot });
			case 'set-active': return ctx.stateManager.setActiveSpecWorkflow(args.projectId, args.workflowId);
		}
	}
}
