import { z } from 'zod';

import { SpecDocumentsRepo } from '../../db/repo/spec/documents.ts';
import { MustHavesRepo } from '../../db/repo/spec/must-haves.ts';
import { SpecRenderer } from '../../db/repo/spec/render.ts';
import { SpecTasksRepo } from '../../db/repo/spec/tasks.ts';
import { emit } from '../../hooks/emit.ts';
import { SpecToolError } from './errors.ts';
import { resolveSpecWorkflow, SpecTool, type SpecToolContext } from './base.ts';

const wf = { projectId: z.string().min(1), workflowId: z.string().min(1) };
const idempotency = { idempotency_key: z.string().min(1).optional() };

const requirementsSchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('read'), ...wf }),
	z.object({ action: z.literal('write'), ...wf, content: z.string(), ...idempotency }),
	z.object({ action: z.literal('section'), ...wf, section: z.enum(['must-haves', 'out-of-scope', 'constraints']) }),
]);
type RequirementsArgs = z.infer<typeof requirementsSchema>;

/** @example {"action":"read","projectId":"project-1","workflowId":"spec-mode"} */
export class SpecRequirementsTool extends SpecTool<RequirementsArgs, unknown> {
	readonly name = 'wf_requirements';
	readonly description = 'Read, write, or extract sections from the REQUIREMENTS document.';
	readonly schema = requirementsSchema;
	readonly allowedPhases = ['discuss', 'plan', 'research', 'specify'] as const satisfies import('../../state/schema.ts').SpecWorkflowPhase[];
	readonly permissions = { read: true, write: true, execute: false };
	readonly examples = [{ name: 'read', payload: { action: 'read', projectId: 'project-1', workflowId: 'spec-mode' } }];

	protected async execute(ctx: SpecToolContext, args: RequirementsArgs): Promise<unknown> {
		const workflow = await resolveSpecWorkflow(ctx, args);
		const docs = new SpecDocumentsRepo(ctx.database);
		const mh = new MustHavesRepo(ctx.database);
		if (args.action === 'read') return { contentMd: new SpecRenderer(ctx.database).renderRequirements(workflow.id), mustHaves: mh.list(workflow.id), outOfScope: docs.getOutOfScope(workflow.id) };
		if (args.action === 'write') return docs.writeRequirements(workflow.id, args.content);
		if (args.section === 'must-haves') return { mustHaves: mh.list(workflow.id) };
		if (args.section === 'out-of-scope') return { outOfScope: docs.getOutOfScope(workflow.id) };
		return { section: args.section, contentMd: docs.getRequirements(workflow.id)?.contentMd ?? '' };
	}
}

const specSchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('read'), ...wf }),
	z.object({ action: z.literal('write'), ...wf, content: z.string(), ...idempotency }),
	z.object({ action: z.literal('lock'), ...wf }),
	z.object({ action: z.literal('amend'), ...wf, rationale: z.string().min(1), changes: z.record(z.string(), z.unknown()).default({}), ...idempotency }),
]);
type SpecArgs = z.infer<typeof specSchema>;

/** @example {"action":"read","projectId":"project-1","workflowId":"spec-mode"} */
export class SpecSpecTool extends SpecTool<SpecArgs, unknown> {
	readonly name = 'wf_spec';
	readonly description = 'Read, write, lock, or amend the locked SPEC contract.';
	readonly schema = specSchema;
	readonly allowedPhases = ['specify', 'execute', 'audit', 'accept'] as const satisfies import('../../state/schema.ts').SpecWorkflowPhase[];
	readonly permissions = { read: true, write: true, execute: false };
	readonly examples = [{ name: 'read', payload: { action: 'read', projectId: 'project-1', workflowId: 'spec-mode' } }];

	protected async execute(ctx: SpecToolContext, args: SpecArgs): Promise<unknown> {
		const workflow = await resolveSpecWorkflow(ctx, args);
		const docs = new SpecDocumentsRepo(ctx.database);
		const mh = new MustHavesRepo(ctx.database);
		if (args.action === 'read') {
			return { contentMd: new SpecRenderer(ctx.database).renderSpec(workflow.id), mustHaves: mh.list(workflow.id).map((item) => ({ ...item, validationContracts: mh.listValidationContracts(item.id) })) };
		}
		if (args.action === 'write') return docs.writeSpec(workflow.id, args.content);
		if (args.action === 'lock') {
			const missing = mh.list(workflow.id).filter((item) => mh.listValidationContracts(item.id).length === 0);
			if (missing.length > 0) return new SpecToolError('VALIDATION_CONTRACT_INCOMPLETE', 'Every must-have requires at least one validation contract before lock', { missing: missing.map((item) => item.mhId) });
			return ctx.stateManager.lockSpec(args.projectId, args.workflowId);
		}
		const result = docs.applyAmendment(workflow.id, {
			rationale: args.rationale,
			mutate: (tx) => {
				const content = typeof args.changes.content === 'string' ? args.changes.content : docs.getSpec(workflow.id)?.contentMd ?? '';
				tx.documents.writeSpec(workflow.id, content, { amend: true });
			},
		});
		if (ctx.hookRegistry) {
			void emit(ctx.hookRegistry, 'spec:amended', {
				workflowId: args.workflowId,
				projectId: args.projectId,
				version: result.version,
				rationale: args.rationale,
			}).catch((error) => console.error('[elefant] Failed to emit spec:amended:', error));
		}
		return result;
	}
}

const blueprintSchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('read'), ...wf }),
	z.object({ action: z.literal('write'), ...wf, content: z.string(), ...idempotency }),
	z.object({ action: z.literal('section'), ...wf, wave: z.number().int().positive() }),
]);
type BlueprintArgs = z.infer<typeof blueprintSchema>;

/** @example {"action":"read","projectId":"project-1","workflowId":"spec-mode"} */
export class SpecBlueprintTool extends SpecTool<BlueprintArgs, unknown> {
	readonly name = 'wf_blueprint';
	readonly description = 'Read, write, or query wave sections from the BLUEPRINT document.';
	readonly schema = blueprintSchema;
	readonly allowedPhases = ['plan', 'specify', 'execute', 'audit'] as const satisfies import('../../state/schema.ts').SpecWorkflowPhase[];
	readonly permissions = { read: true, write: true, execute: false };
	readonly examples = [{ name: 'read', payload: { action: 'read', projectId: 'project-1', workflowId: 'spec-mode' } }];

	protected async execute(ctx: SpecToolContext, args: BlueprintArgs): Promise<unknown> {
		const workflow = await resolveSpecWorkflow(ctx, args);
		const docs = new SpecDocumentsRepo(ctx.database);
		if (args.action === 'read') return { contentMd: new SpecRenderer(ctx.database).renderBlueprint(workflow.id) };
		if (args.action === 'write') {
			const creating = docs.getBlueprint(workflow.id) === null;
			const result = docs.writeBlueprint(workflow.id, args.content);
			if (creating && ctx.hookRegistry) {
				void emit(ctx.hookRegistry, 'blueprint:created', {
					workflowId: args.workflowId,
					projectId: args.projectId,
				}).catch((error) => console.error('[elefant] Failed to emit blueprint:created:', error));
			}
			return result;
		}
		const blueprint = ctx.database.db.query('SELECT id FROM spec_blueprints WHERE workflow_id = ? ORDER BY version DESC LIMIT 1').get(workflow.id) as { id: string } | null;
		if (!blueprint) return { wave: args.wave, tasks: [] };
		const wave = new SpecTasksRepo(ctx.database).listWaves(blueprint.id).find((item) => item.waveNumber === args.wave);
		return { wave, tasks: wave ? new SpecTasksRepo(ctx.database).listByWave(wave.id) : [] };
	}
}
