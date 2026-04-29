import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';

import type { Database } from '../../db/database.ts';
import { SpecAdlEntryTypeSchema, type SpecAdlEntry, SpecAdlRepo } from '../../db/repo/spec/adl.ts';
import { SpecChronicleRepo } from '../../db/repo/spec/chronicle.ts';
import { resolveSpecWorkflow, SpecTool, type SpecToolContext } from './base.ts';
import { SpecToolError } from './errors.ts';

/**
 * Distill a spec ADL entry into a memory_entries observation. Only `decision`
 * entries with material content (rule=4 or body length > 100 chars) are
 * persisted — everything else stays inside the workflow's ADL log to avoid
 * memory pollution. Best-effort: if the memory table is missing or the insert
 * throws, we swallow rather than failing the originating tool call.
 *
 * Exported for unit tests.
 */
export async function distillAdlToMemory(entry: SpecAdlEntry, database: Database): Promise<boolean> {
	if (entry.type !== 'decision') return false;
	const significant = entry.rule === 4 || (entry.body?.length ?? 0) > 100;
	if (!significant) return false;

	try {
		database.db
			.prepare(
				`INSERT INTO memory_entries (type, title, content, importance, concepts, source_files, created_at, updated_at)
				 VALUES ('decision', ?, ?, 8, ?, ?, unixepoch(), unixepoch())`,
			)
			.run(
				entry.title,
				entry.body ?? '',
				JSON.stringify(['spec-mode', 'adl', entry.type]),
				JSON.stringify(entry.files ?? []),
			);
		return true;
	} catch {
		// Memory distillation is best-effort.
		return false;
	}
}

const wf = { projectId: z.string().min(1), workflowId: z.string().min(1) };
const idempotency = { idempotency_key: z.string().min(1).optional() };

const chronicleSchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('append'), ...wf, kind: z.string().min(1), payload: z.record(z.string(), z.unknown()).optional(), ...idempotency }),
	z.object({ action: z.literal('read'), ...wf, limit: z.number().int().positive().optional(), since: z.string().optional(), kind: z.string().optional() }),
]);
type ChronicleArgs = z.infer<typeof chronicleSchema>;

/** @example {"action":"read","projectId":"project-1","workflowId":"spec-mode"} */
export class SpecChronicleTool extends SpecTool<ChronicleArgs, unknown> {
	readonly name = 'spec_chronicle';
	readonly description = 'Append to or read from the Spec Mode CHRONICLE log.';
	readonly schema = chronicleSchema;
	readonly allowedPhases = [];
	readonly permissions = { read: true, write: true, execute: false };
	readonly examples = [{ name: 'read', payload: { action: 'read', projectId: 'project-1', workflowId: 'spec-mode' } }];

	async run(ctx: SpecToolContext, rawArgs: unknown): Promise<unknown | SpecToolError> {
		const parsed = this.schema.safeParse(rawArgs);
		if (parsed.success && parsed.data.action === 'append') {
			const workflow = await ctx.stateManager.getSpecWorkflow(parsed.data.projectId, parsed.data.workflowId);
			if (!workflow) return new SpecToolError('WORKFLOW_NOT_FOUND', `Workflow not found: ${parsed.data.workflowId}`);
			if (!['execute', 'audit', 'accept'].includes(workflow.phase)) {
				return new SpecToolError('INVALID_PHASE', 'spec_chronicle.append is only allowed in execute, audit, or accept', { actual: workflow.phase, allowed: ['execute', 'audit', 'accept'] });
			}
		}
		return super.run(ctx, rawArgs);
	}

	protected async execute(ctx: SpecToolContext, args: ChronicleArgs): Promise<unknown> {
		const workflow = await resolveSpecWorkflow(ctx, args);
		const repo = new SpecChronicleRepo(ctx.database);
		if (args.action === 'append') return repo.append(workflow.id, { kind: args.kind, payload: args.payload });
		const entries = repo.list(workflow.id, { limit: args.limit, since: args.since });
		return args.kind ? entries.filter((entry) => entry.kind === args.kind) : entries;
	}
}

const adlSchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('append'), ...wf, type: SpecAdlEntryTypeSchema, title: z.string().min(1), body: z.string().optional(), rule: z.number().int().nullable().optional(), files: z.array(z.string()).optional(), ...idempotency }),
	z.object({ action: z.literal('read'), ...wf, limit: z.number().int().positive().optional(), type: SpecAdlEntryTypeSchema.optional() }),
	z.object({ action: z.literal('last-n'), ...wf, n: z.number().int().positive() }),
]);
type AdlArgs = z.infer<typeof adlSchema>;

/** @example {"action":"read","projectId":"project-1","workflowId":"spec-mode"} */
export class SpecAdlTool extends SpecTool<AdlArgs, unknown> {
	readonly name = 'spec_adl';
	readonly description = 'Append to or read from the Spec Mode architectural decision log.';
	readonly schema = adlSchema;
	readonly allowedPhases = [];
	readonly permissions = { read: true, write: true, execute: false };
	readonly examples = [{ name: 'read', payload: { action: 'read', projectId: 'project-1', workflowId: 'spec-mode' } }];

	protected async execute(ctx: SpecToolContext, args: AdlArgs): Promise<unknown> {
		const workflow = await resolveSpecWorkflow(ctx, args);
		const repo = new SpecAdlRepo(ctx.database);
		if (args.action === 'append') {
			const entry = repo.append(workflow.id, { type: args.type, title: args.title, body: args.body, rule: args.rule, files: args.files });
			// Fire-and-forget memory distillation. Never await failures back into
			// the caller — the ADL append is the primary side effect.
			void distillAdlToMemory(entry, ctx.database);
			return entry;
		}
		if (args.action === 'last-n') return repo.getLastN(workflow.id, args.n);
		return repo.list(workflow.id, { limit: args.limit, type: args.type });
	}
}

const checkpointSchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('save'), ...wf, id: z.string().min(1), context: z.record(z.string(), z.unknown()).optional(), ...idempotency }),
	z.object({ action: z.literal('load'), ...wf, id: z.string().min(1) }),
	z.object({ action: z.literal('list'), ...wf }),
]);
type CheckpointArgs = z.infer<typeof checkpointSchema>;

/** @example {"action":"list","projectId":"project-1","workflowId":"spec-mode"} */
export class SpecCheckpointTool extends SpecTool<CheckpointArgs, unknown> {
	readonly name = 'spec_checkpoint';
	readonly description = 'Save, load, or list workflow checkpoints stored in CHRONICLE entries.';
	readonly schema = checkpointSchema;
	readonly allowedPhases = [];
	readonly permissions = { read: true, write: true, execute: false };
	readonly examples = [{ name: 'list', payload: { action: 'list', projectId: 'project-1', workflowId: 'spec-mode' } }];

	protected async execute(ctx: SpecToolContext, args: CheckpointArgs): Promise<unknown> {
		const workflow = await resolveSpecWorkflow(ctx, args);
		const repo = new SpecChronicleRepo(ctx.database);
		if (args.action === 'save') return repo.append(workflow.id, { kind: 'checkpoint', payload: { id: args.id, context: args.context ?? {}, savedAt: new Date().toISOString() } });
		const checkpoints = repo.list(workflow.id).filter((entry) => entry.kind === 'checkpoint');
		if (args.action === 'list') return checkpoints;
		return checkpoints.find((entry) => entry.payload.id === args.id) ?? null;
	}
}

const skillSchema = z.discriminatedUnion('action', [z.object({ action: z.literal('list') }), z.object({ action: z.literal('load'), name: z.string().min(1) })]);
type SkillArgs = z.infer<typeof skillSchema>;

/** @example {"action":"list"} */
export class SpecSkillTool extends SpecTool<SkillArgs, unknown> {
	readonly name = 'spec_skill';
	readonly description = 'List or load bundled Spec Mode skill markdown resources.';
	readonly schema = skillSchema;
	readonly allowedPhases = [];
	readonly permissions = { read: true, write: false, execute: false };
	readonly examples = [{ name: 'list', payload: { action: 'list' } }];

	async run(ctx: SpecToolContext, rawArgs: unknown): Promise<unknown | SpecToolError> { return this.runWithoutWorkflow(ctx, rawArgs); }
	private async runWithoutWorkflow(ctx: SpecToolContext, rawArgs: unknown): Promise<unknown | SpecToolError> {
		const parsed = this.schema.safeParse(rawArgs);
		if (!parsed.success) return new SpecToolError('VALIDATION_FAILED', `Invalid payload for ${this.name}`, parsed.error.flatten());
		return this.execute(ctx, parsed.data);
	}
	protected async execute(_ctx: SpecToolContext, args: SkillArgs): Promise<unknown> { return readResource('src/agents/skills', args); }
}

const referenceSchema = z.discriminatedUnion('action', [z.object({ action: z.literal('list') }), z.object({ action: z.literal('load'), name: z.string().min(1) }), z.object({ action: z.literal('section'), name: z.string().min(1), section: z.string().min(1) })]);
type ReferenceArgs = z.infer<typeof referenceSchema>;

/** @example {"action":"list"} */
export class SpecReferenceTool extends SpecTool<ReferenceArgs, unknown> {
	readonly name = 'spec_reference';
	readonly description = 'List, load, or extract sections from bundled reference markdown resources.';
	readonly schema = referenceSchema;
	readonly allowedPhases = [];
	readonly permissions = { read: true, write: false, execute: false };
	readonly examples = [{ name: 'list', payload: { action: 'list' } }];

	async run(ctx: SpecToolContext, rawArgs: unknown): Promise<unknown | SpecToolError> { return this.runWithoutWorkflow(ctx, rawArgs); }
	private async runWithoutWorkflow(ctx: SpecToolContext, rawArgs: unknown): Promise<unknown | SpecToolError> {
		const parsed = this.schema.safeParse(rawArgs);
		if (!parsed.success) return new SpecToolError('VALIDATION_FAILED', `Invalid payload for ${this.name}`, parsed.error.flatten());
		return this.execute(ctx, parsed.data);
	}
	protected async execute(_ctx: SpecToolContext, args: ReferenceArgs): Promise<unknown> { return readResource('src/agents/references', args); }
}

async function readResource(root: string, args: { action: string; name?: string; section?: string }): Promise<unknown> {
	const dir = resolve(process.cwd(), root);
	if (args.action === 'list') {
		try { return (await readdir(dir)).filter((name) => name.endsWith('.md')).sort(); }
		catch { return []; }
	}
	const name = args.name?.endsWith('.md') ? args.name : `${args.name}.md`;
	const filePath = join(dir, name ?? '');
	const file = Bun.file(filePath);
	if (!(await file.exists())) return new SpecToolError('VALIDATION_FAILED', `Resource not found: ${args.name}`, { root });
	const content = await file.text();
	if (args.action !== 'section') return { name: args.name, content };
	return { name: args.name, section: args.section, content: extractMarkdownSection(content, args.section ?? '') };
}

function extractMarkdownSection(content: string, section: string): string {
	const lines = content.split('\n');
	const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${section}`.toLowerCase());
	if (start === -1) return '';
	const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
	return lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim();
}
