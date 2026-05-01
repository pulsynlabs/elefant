import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../../database.ts';
import { SpecLockedError, WorkflowNotFoundError } from '../../../state/errors.ts';
import { MustHavesRepo } from './must-haves.ts';
import { SpecDocumentsRepo } from './documents.ts';
import { SpecWorkflowsRepo } from './workflows.ts';

const tempDirs: string[] = [];
const databases: Database[] = [];

function setup(locked = false): {
	database: Database;
	workflowId: string;
	documents: SpecDocumentsRepo;
	mustHaves: MustHavesRepo;
} {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-documents-'));
	tempDirs.push(dir);
	const database = new Database(join(dir, 'db.sqlite'));
	databases.push(database);
	const projectId = crypto.randomUUID();
	database.db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [projectId, 'test', join(dir, 'project')]);
	const workflow = new SpecWorkflowsRepo(database).create({
		projectId,
		workflowId: `wf-${crypto.randomUUID().slice(0, 8)}`,
		specLocked: locked,
	});
	return {
		database,
		workflowId: workflow.id,
		documents: new SpecDocumentsRepo(database),
		mustHaves: new MustHavesRepo(database),
	};
}

function amendmentRows(database: Database, workflowId: string): { version: number; prior_state: string; new_state: string; rationale: string }[] {
	return database.db
		.query('SELECT version, prior_state, new_state, rationale FROM spec_amendments WHERE workflow_id = ? ORDER BY version ASC')
		.all(workflowId) as { version: number; prior_state: string; new_state: string; rationale: string }[];
}

afterEach(() => {
	for (const database of databases.splice(0)) database.close();
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('SpecDocumentsRepo document writes', () => {
	it('writeRequirements writes and getRequirements returns it', () => {
		const { workflowId, documents } = setup();
		const doc = documents.writeRequirements(workflowId, '# Requirements');
		expect(doc.docType).toBe('REQUIREMENTS');
		expect(documents.getRequirements(workflowId)!.contentMd).toBe('# Requirements');
	});

	it('writeRequirements upserts and increments version without duplicating rows', async () => {
		const { database, workflowId, documents } = setup();
		const first = documents.writeRequirements(workflowId, 'one');
		await new Promise((resolve) => setTimeout(resolve, 10));
		const second = documents.writeRequirements(workflowId, 'two');
		expect(second.id).toBe(first.id);
		expect(second.version).toBe(first.version + 1);
		expect(second.updatedAt).not.toBe(first.updatedAt);
		const count = database.db.query('SELECT COUNT(*) AS c FROM spec_documents WHERE workflow_id = ? AND doc_type = ?').get(workflowId, 'REQUIREMENTS') as { c: number };
		expect(count.c).toBe(1);
	});

	it('writeBlueprint, writeChronicle, and writeAdl write content', () => {
		const { workflowId, documents } = setup();
		expect(documents.writeBlueprint(workflowId, 'blue').contentMd).toBe('blue');
		expect(documents.writeChronicle(workflowId, 'chron').contentMd).toBe('chron');
		expect(documents.writeAdl(workflowId, 'adl').contentMd).toBe('adl');
		expect(documents.getBlueprint(workflowId)!.contentMd).toBe('blue');
		expect(documents.getChronicle(workflowId)!.contentMd).toBe('chron');
		expect(documents.getAdl(workflowId)!.contentMd).toBe('adl');
	});

	it('writeSpec succeeds when unlocked', () => {
		const { workflowId, documents } = setup();
		expect(documents.writeSpec(workflowId, 'spec').contentMd).toBe('spec');
	});

	it('writeSpec on locked workflow throws SpecLockedError and does not update content', () => {
		const { database, workflowId, documents } = setup();
		documents.writeSpec(workflowId, 'old');
		database.db.run('UPDATE spec_workflows SET locked = 1 WHERE id = ?', [workflowId]);
		expect(() => documents.writeSpec(workflowId, 'new')).toThrow(SpecLockedError);
		expect(documents.getSpec(workflowId)!.contentMd).toBe('old');
	});

	it('writeSpec on locked workflow with amend succeeds', () => {
		const { workflowId, documents } = setup(true);
		expect(documents.writeSpec(workflowId, 'new', { amend: true }).contentMd).toBe('new');
	});

	it('writeOutOfScope on locked workflow throws SpecLockedError', () => {
		const { workflowId, documents } = setup(true);
		expect(() => documents.writeOutOfScope(workflowId, [{ item: 'x', reason: 'y' }])).toThrow(SpecLockedError);
	});

	it('writeOutOfScope replaces rows atomically when unlocked', () => {
		const { workflowId, documents } = setup();
		documents.writeOutOfScope(workflowId, [{ item: 'old', reason: 'old reason' }]);
		documents.writeOutOfScope(workflowId, [
			{ item: 'new-a', reason: 'a' },
			{ item: 'new-b', reason: 'b' },
		]);
		expect(documents.getOutOfScope(workflowId).map((row) => row.item)).toEqual(['new-a', 'new-b']);
	});

	it('getOutOfScope returns ordered rows', () => {
		const { workflowId, documents } = setup();
		documents.writeOutOfScope(workflowId, [
			{ item: 'first', reason: 'a' },
			{ item: 'second', reason: 'b' },
		]);
		expect(documents.getOutOfScope(workflowId).map((row) => row.ordinal)).toEqual([1, 2]);
	});

	it('list returns documents ordered by doc_type ASC and get returns null for missing', () => {
		const { workflowId, documents } = setup();
		documents.writeSpec(workflowId, 'spec');
		documents.writeAdl(workflowId, 'adl');
		documents.writeRequirements(workflowId, 'req');
		expect(documents.list(workflowId).map((doc) => doc.docType)).toEqual(['ADL', 'REQUIREMENTS', 'SPEC']);
		expect(documents.get(workflowId, 'BLUEPRINT')).toBeNull();
	});
});

describe('SpecDocumentsRepo.applyAmendment', () => {
	it('captures prior and new state while re-locking a locked workflow', () => {
		const { database, workflowId, documents, mustHaves } = setup();
		const mh = mustHaves.create({ workflowId, mhId: 'MH1', title: 'Old', description: 'Desc', ordinal: 1 });
		documents.writeSpec(workflowId, 'old spec');
		database.db.run('UPDATE spec_workflows SET locked = 1 WHERE id = ?', [workflowId]);

		const result = documents.applyAmendment(workflowId, {
			rationale: 'rename must-have',
			mutate: (ctx) => {
				ctx.mustHaves.update(mh.id, { title: 'New' }, { amend: true });
			},
		});

		expect(result.version).toBe(1);
		expect(mustHaves.getById(mh.id)!.title).toBe('New');
		expect((database.db.query('SELECT locked FROM spec_workflows WHERE id = ?').get(workflowId) as { locked: number }).locked).toBe(1);
		const rows = amendmentRows(database, workflowId);
		expect(rows).toHaveLength(1);
		expect(rows[0]!.rationale).toBe('rename must-have');
		const prior = JSON.parse(rows[0]!.prior_state) as { mustHaves: { title: string }[]; specContentMd: string | null };
		const next = JSON.parse(rows[0]!.new_state) as { mustHaves: { title: string }[]; specContentMd: string | null };
		expect(prior.mustHaves[0]!.title).toBe('Old');
		expect(next.mustHaves[0]!.title).toBe('New');
		expect(prior.specContentMd).toBe('old spec');
	});

	it('increments amendment version on second call', () => {
		const { workflowId, documents, mustHaves } = setup(true);
		const mh = mustHaves.create({ workflowId, mhId: 'MH1', title: 'One', description: 'Desc', ordinal: 1 }, { amend: true });
		documents.applyAmendment(workflowId, { rationale: 'v1', mutate: (ctx) => ctx.mustHaves.update(mh.id, { title: 'Two' }, { amend: true }) });
		const second = documents.applyAmendment(workflowId, { rationale: 'v2', mutate: (ctx) => ctx.mustHaves.update(mh.id, { title: 'Three' }, { amend: true }) });
		expect(second.version).toBe(2);
	});

	it('rolls back mutation, lock change, and amendment row on failure', () => {
		const { database, workflowId, documents, mustHaves } = setup();
		const mh = mustHaves.create({ workflowId, mhId: 'MH1', title: 'Old', description: 'Desc', ordinal: 1 });
		database.db.run('UPDATE spec_workflows SET locked = 1 WHERE id = ?', [workflowId]);

		expect(() => documents.applyAmendment(workflowId, {
			rationale: 'bad',
			mutate: (ctx) => {
				ctx.mustHaves.update(mh.id, { title: 'New' }, { amend: true });
				throw new Error('boom');
			},
		})).toThrow('boom');

		expect(mustHaves.getById(mh.id)!.title).toBe('Old');
		expect((database.db.query('SELECT locked FROM spec_workflows WHERE id = ?').get(workflowId) as { locked: number }).locked).toBe(1);
		expect(amendmentRows(database, workflowId)).toHaveLength(0);
	});

	it('respects initially unlocked workflow and leaves it unlocked', () => {
		const { database, workflowId, documents, mustHaves } = setup(false);
		const mh = mustHaves.create({ workflowId, mhId: 'MH1', title: 'Old', description: 'Desc', ordinal: 1 });
		documents.applyAmendment(workflowId, { rationale: 'unlocked amend', mutate: (ctx) => ctx.mustHaves.update(mh.id, { title: 'New' }, { amend: true }) });
		expect((database.db.query('SELECT locked FROM spec_workflows WHERE id = ?').get(workflowId) as { locked: number }).locked).toBe(0);
	});

	it('missing workflow throws WorkflowNotFoundError', () => {
		const { documents } = setup();
		expect(() => documents.applyAmendment(crypto.randomUUID(), { rationale: 'missing', mutate: () => undefined })).toThrow(WorkflowNotFoundError);
	});

	it('end-to-end lock and amend interaction creates a must-have and amendment row', () => {
		const { database, workflowId, documents, mustHaves } = setup(true);
		expect(() => mustHaves.create({ workflowId, mhId: 'MH1', title: 'A', description: 'A', ordinal: 1 })).toThrow(SpecLockedError);
		documents.applyAmendment(workflowId, {
			rationale: 'add must-have',
			mutate: (ctx) => {
				ctx.mustHaves.create({ workflowId, mhId: 'MH1', title: 'A', description: 'A', ordinal: 1 }, { amend: true });
			},
		});
		expect(mustHaves.get(workflowId, 'MH1')).not.toBeNull();
		expect((database.db.query('SELECT locked FROM spec_workflows WHERE id = ?').get(workflowId) as { locked: number }).locked).toBe(1);
		expect(amendmentRows(database, workflowId)).toHaveLength(1);
	});
});
