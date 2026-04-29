import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../db/database.ts';
import { StateManager } from '../state/manager.ts';
import { importExistingGoopspecFiles } from './import-existing-spec.ts';

const tempDirs: string[] = [];

function makeProject(): { projectPath: string; database: Database; projectId: string; state: StateManager } {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-import-spec-'));
	tempDirs.push(dir);
	mkdirSync(join(dir, '.elefant'), { recursive: true });
	const database = new Database(join(dir, '.elefant', 'db.sqlite'));
	const projectId = 'project-1';
	database.db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [
		projectId,
		'Project',
		dir,
	]);
	const state = new StateManager(dir, {
		id: projectId,
		name: 'Project',
		path: dir,
		database,
	});
	return { projectPath: dir, database, projectId, state };
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('importExistingGoopspecFiles', () => {
	it('imports SPEC.md when a matching workflow row exists', async () => {
		const { projectPath, database, projectId, state } = makeProject();
		await state.createSpecWorkflow({ projectId, workflowId: 'feat-auth', phase: 'plan' });

		mkdirSync(join(projectPath, '.goopspec', 'feat-auth'), { recursive: true });
		writeFileSync(
			join(projectPath, '.goopspec', 'feat-auth', 'SPEC.md'),
			'# SPEC\n\n## Must-Haves\n- MH1: do the thing\n',
			'utf-8',
		);

		const result = await importExistingGoopspecFiles(projectPath, projectId, database);
		expect(result.imported).toBe(1);

		// Verify content lands in spec_documents
		const row = database.db
			.query(
				`SELECT content_md FROM spec_documents
				 WHERE workflow_id IN (SELECT id FROM spec_workflows WHERE workflow_id = ?)
				 AND doc_type = 'SPEC'`,
			)
			.get('feat-auth') as { content_md: string } | null;
		expect(row?.content_md).toContain('MH1: do the thing');
		database.close();
	});

	it('is idempotent — a second import does not duplicate content', async () => {
		const { projectPath, database, projectId, state } = makeProject();
		await state.createSpecWorkflow({ projectId, workflowId: 'feat-auth', phase: 'plan' });
		mkdirSync(join(projectPath, '.goopspec', 'feat-auth'), { recursive: true });
		writeFileSync(
			join(projectPath, '.goopspec', 'feat-auth', 'SPEC.md'),
			'# SPEC\nfirst content',
			'utf-8',
		);

		const first = await importExistingGoopspecFiles(projectPath, projectId, database);
		expect(first.imported).toBe(1);

		const second = await importExistingGoopspecFiles(projectPath, projectId, database);
		expect(second.imported).toBe(0);
		expect(second.skipped).toBeGreaterThanOrEqual(1);
		database.close();
	});

	it('skips workflow directories with no matching DB row', async () => {
		const { projectPath, database, projectId } = makeProject();
		mkdirSync(join(projectPath, '.goopspec', 'orphan'), { recursive: true });
		writeFileSync(
			join(projectPath, '.goopspec', 'orphan', 'SPEC.md'),
			'orphan',
			'utf-8',
		);
		const result = await importExistingGoopspecFiles(projectPath, projectId, database);
		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(1);
		database.close();
	});

	it('returns zeroes when .goopspec dir is missing', async () => {
		const { projectPath, database, projectId } = makeProject();
		const result = await importExistingGoopspecFiles(projectPath, projectId, database);
		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(0);
		database.close();
	});

	it('imports multiple doc types in one pass', async () => {
		const { projectPath, database, projectId, state } = makeProject();
		await state.createSpecWorkflow({ projectId, workflowId: 'feat-onboarding', phase: 'plan' });
		const wfDir = join(projectPath, '.goopspec', 'feat-onboarding');
		mkdirSync(wfDir, { recursive: true });
		writeFileSync(join(wfDir, 'REQUIREMENTS.md'), '# REQ', 'utf-8');
		writeFileSync(join(wfDir, 'SPEC.md'), '# SPEC', 'utf-8');
		writeFileSync(join(wfDir, 'BLUEPRINT.md'), '# BP', 'utf-8');

		const result = await importExistingGoopspecFiles(projectPath, projectId, database);
		expect(result.imported).toBe(3);
		database.close();
	});
});
