import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import { Database } from '../../database.ts';
import { SpecLockedError } from '../../../state/errors.ts';
import { RepoConstraintViolationError } from './base.ts';
import { MustHavesRepo } from './must-haves.ts';
import { SpecWorkflowsRepo } from './workflows.ts';

const tempDirs: string[] = [];
const databases: Database[] = [];

function setup(locked = false): { database: Database; workflowId: string; repo: MustHavesRepo } {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-must-haves-'));
	tempDirs.push(dir);
	const database = new Database(join(dir, 'db.sqlite'));
	databases.push(database);
	const projectId = crypto.randomUUID();
	database.db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [projectId, 'test', join(dir, 'project')]);
	const workflows = new SpecWorkflowsRepo(database);
	const workflow = workflows.create({ projectId, workflowId: `wf-${crypto.randomUUID().slice(0, 8)}`, specLocked: locked });
	return { database, workflowId: workflow.id, repo: new MustHavesRepo(database) };
}

afterEach(() => {
	for (const database of databases.splice(0)) database.close();
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('MustHavesRepo', () => {
	it('create inserts a must-have', () => {
		const { workflowId, repo } = setup();
		const created = repo.create({ workflowId, mhId: 'MH1', title: 'Title', description: 'Desc', dependencies: ['MH0'], ordinal: 1 });
		expect(created.mhId).toBe('MH1');
		expect(created.dependencies).toEqual(['MH0']);
	});

	it('create duplicate wraps UNIQUE violations', () => {
		const { workflowId, repo } = setup();
		repo.create({ workflowId, mhId: 'MH1', title: 'A', description: 'A', ordinal: 1 });
		expect(() => repo.create({ workflowId, mhId: 'MH1', title: 'B', description: 'B', ordinal: 2 })).toThrow(RepoConstraintViolationError);
	});

	it('create on locked workflow throws SpecLockedError without persistence', () => {
		const { workflowId, repo } = setup(true);
		expect(() => repo.create({ workflowId, mhId: 'MH1', title: 'A', description: 'A', ordinal: 1 })).toThrow(SpecLockedError);
		expect(repo.list(workflowId)).toHaveLength(0);
	});

	it('create on locked workflow with amend succeeds', () => {
		const { workflowId, repo } = setup(true);
		expect(repo.create({ workflowId, mhId: 'MH1', title: 'A', description: 'A', ordinal: 1 }, { amend: true }).mhId).toBe('MH1');
	});

	it('update changes provided fields', () => {
		const { workflowId, repo } = setup();
		const created = repo.create({ workflowId, mhId: 'MH1', title: 'A', description: 'A', ordinal: 1 });
		const updated = repo.update(created.id, { title: 'B', dependencies: ['MH2'] });
		expect(updated.title).toBe('B');
		expect(updated.dependencies).toEqual(['MH2']);
	});

	it('update on locked workflow throws SpecLockedError', () => {
		const { database, workflowId, repo } = setup();
		const created = repo.create({ workflowId, mhId: 'MH1', title: 'A', description: 'A', ordinal: 1 });
		database.db.run('UPDATE spec_workflows SET locked = 1 WHERE id = ?', [workflowId]);
		expect(() => repo.update(created.id, { title: 'B' })).toThrow(SpecLockedError);
		expect(repo.getById(created.id)!.title).toBe('A');
	});

	it('delete removes a must-have', () => {
		const { workflowId, repo } = setup();
		const created = repo.create({ workflowId, mhId: 'MH1', title: 'A', description: 'A', ordinal: 1 });
		repo.delete(created.id);
		expect(repo.getById(created.id)).toBeNull();
	});

	it('delete on locked workflow throws SpecLockedError', () => {
		const { database, workflowId, repo } = setup();
		const created = repo.create({ workflowId, mhId: 'MH1', title: 'A', description: 'A', ordinal: 1 });
		database.db.run('UPDATE spec_workflows SET locked = 1 WHERE id = ?', [workflowId]);
		expect(() => repo.delete(created.id)).toThrow(SpecLockedError);
		expect(repo.getById(created.id)).not.toBeNull();
	});

	it('list orders by ordinal', () => {
		const { workflowId, repo } = setup();
		repo.create({ workflowId, mhId: 'MH2', title: 'B', description: 'B', ordinal: 2 });
		repo.create({ workflowId, mhId: 'MH1', title: 'A', description: 'A', ordinal: 1 });
		expect(repo.list(workflowId).map((mh) => mh.mhId)).toEqual(['MH1', 'MH2']);
	});

	it('get and getById return must-haves', () => {
		const { workflowId, repo } = setup();
		const created = repo.create({ workflowId, mhId: 'MH1', title: 'A', description: 'A', ordinal: 1 });
		expect(repo.get(workflowId, 'MH1')!.id).toBe(created.id);
		expect(repo.getById(created.id)!.mhId).toBe('MH1');
	});

	it('addAcceptanceCriterion inserts and locked workflow rejects', () => {
		const { database, workflowId, repo } = setup();
		const mh = repo.create({ workflowId, mhId: 'MH1', title: 'A', description: 'A', ordinal: 1 });
		const ac = repo.addAcceptanceCriterion({ mustHaveId: mh.id, acId: 'AC1.1', text: 'Works', ordinal: 1 });
		expect(ac.acId).toBe('AC1.1');
		database.db.run('UPDATE spec_workflows SET locked = 1 WHERE id = ?', [workflowId]);
		expect(() => repo.addAcceptanceCriterion({ mustHaveId: mh.id, acId: 'AC1.2', text: 'Locked', ordinal: 2 })).toThrow(SpecLockedError);
	});

	it('removeAcceptanceCriterion deletes a criterion', () => {
		const { workflowId, repo } = setup();
		const mh = repo.create({ workflowId, mhId: 'MH1', title: 'A', description: 'A', ordinal: 1 });
		const ac = repo.addAcceptanceCriterion({ mustHaveId: mh.id, acId: 'AC1.1', text: 'Works', ordinal: 1 });
		repo.removeAcceptanceCriterion(ac.id);
		expect(repo.listAcceptanceCriteria(mh.id)).toHaveLength(0);
	});

	it('listAcceptanceCriteria orders by ordinal', () => {
		const { workflowId, repo } = setup();
		const mh = repo.create({ workflowId, mhId: 'MH1', title: 'A', description: 'A', ordinal: 1 });
		repo.addAcceptanceCriterion({ mustHaveId: mh.id, acId: 'AC1.2', text: 'B', ordinal: 2 });
		repo.addAcceptanceCriterion({ mustHaveId: mh.id, acId: 'AC1.1', text: 'A', ordinal: 1 });
		expect(repo.listAcceptanceCriteria(mh.id).map((ac) => ac.acId)).toEqual(['AC1.1', 'AC1.2']);
	});

	it('addValidationContract inserts severity and invalid severity is rejected by Zod', () => {
		const { workflowId, repo } = setup();
		const mh = repo.create({ workflowId, mhId: 'MH1', title: 'A', description: 'A', ordinal: 1 });
		const vc = repo.addValidationContract({ mustHaveId: mh.id, vcId: 'VC1.A', text: 'Must', severity: 'should', ordinal: 1 });
		expect(vc.severity).toBe('should');
		expect(() => repo.addValidationContract({ mustHaveId: mh.id, vcId: 'VC1.B', text: 'Bad', severity: 'bad', ordinal: 2 } as never)).toThrow(z.ZodError);
	});

	it('addValidationContract on locked workflow throws SpecLockedError', () => {
		const { database, workflowId, repo } = setup();
		const mh = repo.create({ workflowId, mhId: 'MH1', title: 'A', description: 'A', ordinal: 1 });
		database.db.run('UPDATE spec_workflows SET locked = 1 WHERE id = ?', [workflowId]);
		expect(() => repo.addValidationContract({ mustHaveId: mh.id, vcId: 'VC1.A', text: 'Must', ordinal: 1 })).toThrow(SpecLockedError);
	});

	it('removeValidationContract deletes a contract', () => {
		const { workflowId, repo } = setup();
		const mh = repo.create({ workflowId, mhId: 'MH1', title: 'A', description: 'A', ordinal: 1 });
		const vc = repo.addValidationContract({ mustHaveId: mh.id, vcId: 'VC1.A', text: 'Must', ordinal: 1 });
		repo.removeValidationContract(vc.id);
		expect(repo.listValidationContracts(mh.id)).toHaveLength(0);
	});

	it('workflow-level joined queries include rows across must-haves', () => {
		const { workflowId, repo } = setup();
		const mh1 = repo.create({ workflowId, mhId: 'MH1', title: 'A', description: 'A', ordinal: 1 });
		const mh2 = repo.create({ workflowId, mhId: 'MH2', title: 'B', description: 'B', ordinal: 2 });
		repo.addAcceptanceCriterion({ mustHaveId: mh2.id, acId: 'AC2.1', text: 'B', ordinal: 1 });
		repo.addAcceptanceCriterion({ mustHaveId: mh1.id, acId: 'AC1.1', text: 'A', ordinal: 1 });
		repo.addValidationContract({ mustHaveId: mh2.id, vcId: 'VC2.A', text: 'B', ordinal: 1 });
		repo.addValidationContract({ mustHaveId: mh1.id, vcId: 'VC1.A', text: 'A', ordinal: 1 });
		expect(repo.listAcceptanceCriteriaForWorkflow(workflowId).map((ac) => ac.acId)).toEqual(['AC1.1', 'AC2.1']);
		expect(repo.listValidationContractsForWorkflow(workflowId).map((vc) => vc.vcId)).toEqual(['VC1.A', 'VC2.A']);
	});
});
