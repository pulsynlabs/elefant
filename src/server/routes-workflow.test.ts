import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../db/database.ts';
import { SpecAdlRepo } from '../db/repo/spec/adl.ts';
import { SpecChronicleRepo } from '../db/repo/spec/chronicle.ts';
import { SpecDocumentsRepo } from '../db/repo/spec/documents.ts';
import { MustHavesRepo } from '../db/repo/spec/must-haves.ts';
import { SpecTasksRepo } from '../db/repo/spec/tasks.ts';
import { HookRegistry } from '../hooks/registry.ts';
import { StateManager } from '../state/manager.ts';
import { mountWorkflowRoutes } from './routes-workflow.ts';

type TestContext = {
	app: Elysia;
	db: Database;
	hooks: HookRegistry;
	projectId: string;
	projectPath: string;
};

type Envelope<T> = { data: T } | { error: { code: string; message: string } };

let ctx: TestContext;

beforeEach(async () => {
	const projectPath = join(tmpdir(), `elefant-spec-routes-${crypto.randomUUID()}`);
	const elefantDir = join(projectPath, '.elefant');
	await mkdir(elefantDir, { recursive: true });

	const db = new Database(join(elefantDir, 'db.sqlite'));
	const projectId = 'project-1';
	db.db.run(
		'INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)',
		[projectId, 'Project One', projectPath, null],
	);

	const hooks = new HookRegistry();
	const stateManager = new StateManager(projectPath, {
		id: projectId,
		name: 'Project One',
		path: projectPath,
		database: db,
		hookRegistry: hooks,
	});
	const app = new Elysia();
	mountWorkflowRoutes(app, { db, stateManager, hookRegistry: hooks });

	ctx = { app, db, hooks, projectId, projectPath };
});

afterEach(async () => {
	ctx.db.close();
	await rm(ctx.projectPath, { recursive: true, force: true });
});

async function request<T>(path: string, init?: RequestInit): Promise<{ status: number; body: Envelope<T> }> {
	const response = await ctx.app.handle(new Request(`http://localhost${path}`, init));
	return { status: response.status, body: await response.json() as Envelope<T> };
}

async function createWorkflow(workflowId = `workflow-${crypto.randomUUID().slice(0, 8)}`) {
	const created = await request<Record<string, unknown>>(`/api/wf/projects/${ctx.projectId}/workflows`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ workflowId, totalWaves: 2 }),
	});
	expect(created.status).toBe(201);
	if (!('data' in created.body)) throw new Error('workflow creation failed');
	return created.body.data;
}

function workflowPk(publicWorkflowId: string): string {
	const row = ctx.db.db
		.query('SELECT id FROM spec_workflows WHERE workflow_id = ?')
		.get(publicWorkflowId) as { id: string } | null;
	if (!row) throw new Error(`missing workflow ${publicWorkflowId}`);
	return row.id;
}

function seedDocuments(publicWorkflowId: string): { workflowId: string; mustHaveId: string } {
	const workflowId = workflowPk(publicWorkflowId);
	const docs = new SpecDocumentsRepo(ctx.db);
	docs.writeRequirements(workflowId, 'The user needs a visible workflow surface.');
	docs.writeSpec(workflowId, 'Spec content');
	docs.writeBlueprint(workflowId, 'Blueprint content');
	const mustHaves = new MustHavesRepo(ctx.db);
	const mh = mustHaves.create({
		workflowId,
		mhId: 'MH1',
		title: 'Workflow API',
		description: 'Expose workflow state to the GUI.',
		ordinal: 1,
	});
	mustHaves.addAcceptanceCriterion({ mustHaveId: mh.id, acId: 'AC1', text: 'Routes return data.', ordinal: 1 });
	mustHaves.addValidationContract({ mustHaveId: mh.id, vcId: 'VC1', text: 'Envelope is stable.', ordinal: 1 });
	new SpecChronicleRepo(ctx.db).append(workflowId, { kind: 'created', payload: { by: 'test' } });
	new SpecAdlRepo(ctx.db).append(workflowId, { type: 'decision', title: 'Use HTTP', body: 'GUI needs routes.' });
	return { workflowId, mustHaveId: mh.id };
}

function seedBlueprint(publicWorkflowId: string): { taskId: string } {
	const workflowId = workflowPk(publicWorkflowId);
	const blueprintId = crypto.randomUUID();
	ctx.db.db.run('INSERT INTO spec_blueprints (id, workflow_id, version) VALUES (?, ?, ?)', [blueprintId, workflowId, 1]);
	const repo = new SpecTasksRepo(ctx.db, ctx.hooks);
	const wave1 = repo.createWave({ blueprintId, waveNumber: 1, name: 'Foundation', goal: 'Build routes', ordinal: 1 });
	repo.createWave({ blueprintId, waveNumber: 2, name: 'Polish', goal: 'Verify routes', ordinal: 2 });
	const task = repo.create({
		waveId: wave1.id,
		taskId: 'T1',
		name: 'Create routes',
		executor: 'goop-executor-medium',
		files: ['src/server/routes-workflow.ts'],
		action: 'Implement route handlers.',
		done: 'Routes respond.',
		verify: 'bun test',
		ordinal: 1,
	});
	return { taskId: task.id };
}

describe('spec workflow and document routes', () => {
	it('GET /api/wf/projects/:id/workflows returns workflow list', async () => {
		await createWorkflow('alpha');
		const response = await request<unknown[]>(`/api/wf/projects/${ctx.projectId}/workflows`);
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data).toHaveLength(1);
	});

	it('POST /api/wf/projects/:id/workflows creates a workflow', async () => {
		const response = await createWorkflow('created-workflow');
		expect(response.workflowId).toBe('created-workflow');
	});

	it('GET /api/wf/workflows/:id returns a workflow', async () => {
		await createWorkflow('fetchable');
		const response = await request<Record<string, unknown>>('/api/wf/workflows/fetchable');
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data.workflowId).toBe('fetchable');
	});

	it('PATCH /api/wf/workflows/:id/phase transitions phase', async () => {
		await createWorkflow('phaseful');
		const response = await request<Record<string, unknown>>('/api/wf/workflows/phaseful/phase', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ to: 'discuss' }),
		});
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data.phase).toBe('discuss');
	});

	it('POST /api/wf/workflows/:id/lock locks spec and is idempotent', async () => {
		await createWorkflow('lockable');
		const first = await request<Record<string, unknown>>('/api/wf/workflows/lockable/lock', { method: 'POST' });
		const second = await request<Record<string, unknown>>('/api/wf/workflows/lockable/lock', { method: 'POST' });
		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		expect('data' in second.body && second.body.data.specLocked).toBe(true);
	});

	it('POST /api/wf/workflows/:id/unlock unlocks spec', async () => {
		await createWorkflow('unlockable');
		await request('/api/wf/workflows/unlockable/lock', { method: 'POST' });
		const response = await request<Record<string, unknown>>('/api/wf/workflows/unlockable/unlock', { method: 'POST' });
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data.specLocked).toBe(false);
	});

	it('POST /api/wf/workflows/:id/amend triggers amendment flow', async () => {
		await createWorkflow('amendable');
		const response = await request<Record<string, unknown>>('/api/wf/workflows/amendable/amend', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ rationale: 'Clarify scope' }),
		});
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data.specLocked).toBe(true);
	});

	it('POST /api/wf/projects/:id/workflows/active sets active workflow', async () => {
		await createWorkflow('active-one');
		const response = await request<Record<string, unknown>>(`/api/wf/projects/${ctx.projectId}/workflows/active`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ workflowId: 'active-one' }),
		});
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data.isActive).toBe(true);
	});

	it('GET /api/wf/workflows/:id/spec returns structured spec content', async () => {
		await createWorkflow('structured');
		seedDocuments('structured');
		const response = await request<{ mustHaves: unknown[] }>('/api/wf/workflows/structured/spec');
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data.mustHaves).toHaveLength(1);
	});

	it('GET /api/wf/workflows/:id/requirements returns requirements document', async () => {
		await createWorkflow('requirements');
		seedDocuments('requirements');
		const response = await request<Record<string, unknown>>('/api/wf/workflows/requirements/requirements');
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data?.docType).toBe('REQUIREMENTS');
	});

	it('GET /api/wf/workflows/:id/blueprint returns blueprint document', async () => {
		await createWorkflow('blueprint-doc');
		seedDocuments('blueprint-doc');
		const response = await request<Record<string, unknown>>('/api/wf/workflows/blueprint-doc/blueprint');
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data?.docType).toBe('BLUEPRINT');
	});

	it('GET /api/wf/workflows/:id/chronicle lists chronicle entries', async () => {
		await createWorkflow('chronicle-doc');
		seedDocuments('chronicle-doc');
		const response = await request<unknown[]>('/api/wf/workflows/chronicle-doc/chronicle');
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data).toHaveLength(1);
	});

	it('GET /api/wf/workflows/:id/adl lists ADL entries', async () => {
		await createWorkflow('adl-doc');
		seedDocuments('adl-doc');
		const response = await request<unknown[]>('/api/wf/workflows/adl-doc/adl');
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data).toHaveLength(1);
	});

	it('GET /api/wf/workflows/:id/render/requirements returns rendered markdown', async () => {
		await createWorkflow('rendered');
		seedDocuments('rendered');
		const response = await request<{ content: string }>('/api/wf/workflows/rendered/render/requirements');
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data.content).toContain('# REQUIREMENTS: rendered');
	});

	it('returns 400 on invalid phase transition', async () => {
		await createWorkflow('invalid-phase');
		const response = await request('/api/wf/workflows/invalid-phase/phase', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ to: 'audit' }),
		});
		expect(response.status).toBe(400);
		expect('error' in response.body && response.body.error.code).toBe('INVALID_TRANSITION');
	});

	it('returns 404 on unknown workflowId', async () => {
		const response = await request('/api/wf/workflows/missing');
		expect(response.status).toBe(404);
		expect('error' in response.body && response.body.error.code).toBe('WORKFLOW_NOT_FOUND');
	});

	it('returns 409 on duplicate workflow creation', async () => {
		await createWorkflow('duplicate');
		const response = await request(`/api/wf/projects/${ctx.projectId}/workflows`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ workflowId: 'duplicate' }),
		});
		expect(response.status).toBe(409);
		expect('error' in response.body && response.body.error.code).toBe('WORKFLOW_EXISTS');
	});
});

describe('spec wave and task routes', () => {
	it('GET /api/wf/workflows/:id/blueprint/waves lists waves with task counts', async () => {
		await createWorkflow('waves-list');
		seedBlueprint('waves-list');
		const response = await request<Array<{ taskCount: number }>>('/api/wf/workflows/waves-list/blueprint/waves');
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data[0].taskCount).toBe(1);
	});

	it('POST /api/wf/workflows/:id/waves/:n/start starts a wave', async () => {
		await createWorkflow('wave-start');
		seedBlueprint('wave-start');
		const response = await request<Record<string, unknown>>('/api/wf/workflows/wave-start/waves/1/start', { method: 'POST' });
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data.currentWave).toBe(1);
	});

	it('POST /api/wf/workflows/:id/waves/:n/complete completes a wave', async () => {
		await createWorkflow('wave-complete');
		seedBlueprint('wave-complete');
		await request('/api/wf/workflows/wave-complete/waves/1/start', { method: 'POST' });
		const response = await request<Record<string, unknown>>('/api/wf/workflows/wave-complete/waves/1/complete', { method: 'POST' });
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data.currentWave).toBe(2);
	});

	it('GET /api/wf/workflows/:id/tasks lists tasks', async () => {
		await createWorkflow('tasks-list');
		seedBlueprint('tasks-list');
		const response = await request<unknown[]>('/api/wf/workflows/tasks-list/tasks');
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data).toHaveLength(1);
	});

	it('GET /api/wf/workflows/:id/tasks filters tasks by status and wave', async () => {
		await createWorkflow('tasks-filter');
		seedBlueprint('tasks-filter');
		const response = await request<unknown[]>('/api/wf/workflows/tasks-filter/tasks?status=pending&wave=1');
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data).toHaveLength(1);
	});

	it('GET /api/wf/tasks/:taskId returns a task', async () => {
		await createWorkflow('task-get');
		const { taskId } = seedBlueprint('task-get');
		const response = await request<Record<string, unknown>>(`/api/wf/tasks/${taskId}`);
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data.id).toBe(taskId);
	});

	it('POST /api/wf/tasks/:taskId/assign assigns a task', async () => {
		await createWorkflow('task-assign');
		const { taskId } = seedBlueprint('task-assign');
		const response = await request<Record<string, unknown>>(`/api/wf/tasks/${taskId}/assign`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ agentRunId: 'run-1' }),
		});
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data.status).toBe('in_progress');
	});

	it('POST /api/wf/tasks/:taskId/complete completes a task', async () => {
		await createWorkflow('task-complete');
		const { taskId } = seedBlueprint('task-complete');
		const response = await request<Record<string, unknown>>(`/api/wf/tasks/${taskId}/complete`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ outputs: 'done' }),
		});
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data.status).toBe('complete');
	});

	it('POST /api/wf/tasks/:taskId/block blocks a task', async () => {
		await createWorkflow('task-block');
		const { taskId } = seedBlueprint('task-block');
		const response = await request<Record<string, unknown>>(`/api/wf/tasks/${taskId}/block`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ reason: 'blocked by dependency' }),
		});
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data.status).toBe('blocked');
	});

	it('POST /api/wf/tasks/:taskId/reset resets a task', async () => {
		await createWorkflow('task-reset');
		const { taskId } = seedBlueprint('task-reset');
		await request(`/api/wf/tasks/${taskId}/assign`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ agentRunId: 'run-2' }),
		});
		const response = await request<Record<string, unknown>>(`/api/wf/tasks/${taskId}/reset`, { method: 'POST' });
		expect(response.status).toBe(200);
		expect('data' in response.body && response.body.data.status).toBe('pending');
	});
});
