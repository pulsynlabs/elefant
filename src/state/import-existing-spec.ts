// Importer for existing .goopspec/<workflow>/SPEC.md and friends.
//
// Scans `<projectPath>/.goopspec/` for workflow subdirectories. For each
// matching `spec_workflows` row, imports any present markdown documents
// (REQUIREMENTS.md, SPEC.md, BLUEPRINT.md) into `spec_documents`. The
// importer is intentionally minimal: it stores the raw markdown so the
// daemon can render it, without parsing must-haves into structured rows.
// Structured parsing is a follow-up — Phase 1 ships content fidelity.
//
// Idempotency: if a workflow already has the corresponding spec_documents
// row, the file is skipped. Callers can run on every project open without
// fearing duplicate writes.

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from '../db/database.ts';
import { SpecDocumentsRepo } from '../db/repo/spec/documents.ts';
import { SpecWorkflowsRepo } from '../db/repo/spec/workflows.ts';

export interface ImportResult {
	imported: number;
	skipped: number;
}

const DOC_FILES: Array<{
	file: string;
	docType: 'REQUIREMENTS' | 'SPEC' | 'BLUEPRINT';
}> = [
	{ file: 'REQUIREMENTS.md', docType: 'REQUIREMENTS' },
	{ file: 'SPEC.md', docType: 'SPEC' },
	{ file: 'BLUEPRINT.md', docType: 'BLUEPRINT' },
];

async function listDirs(root: string): Promise<string[]> {
	try {
		const entries = await readdir(root);
		const out: string[] = [];
		for (const entry of entries) {
			const info = await stat(join(root, entry));
			if (info.isDirectory()) out.push(entry);
		}
		return out;
	} catch {
		return [];
	}
}

async function readIfExists(path: string): Promise<string | null> {
	const file = Bun.file(path);
	if (!(await file.exists())) return null;
	return file.text();
}

/**
 * Import any `.goopspec/<workflow>/{REQUIREMENTS,SPEC,BLUEPRINT}.md` files
 * into matching `spec_documents` rows. Returns counts of newly-imported and
 * skipped (already-present or missing) documents.
 *
 * Best-effort: missing project DB or absent .goopspec dir return zeroes
 * rather than throwing.
 */
export async function importExistingGoopspecFiles(
	projectPath: string,
	projectId: string,
	database: Database,
): Promise<ImportResult> {
	const goopspecDir = join(projectPath, '.goopspec');
	const subdirs = await listDirs(goopspecDir);
	if (subdirs.length === 0) return { imported: 0, skipped: 0 };

	const workflows = new SpecWorkflowsRepo(database);
	const documents = new SpecDocumentsRepo(database);

	let imported = 0;
	let skipped = 0;

	for (const workflowId of subdirs) {
		const workflow = workflows.get(projectId, workflowId);
		if (!workflow) {
			// No matching DB row — caller hasn't created the workflow yet.
			skipped += 1;
			continue;
		}

		for (const { file, docType } of DOC_FILES) {
			const filePath = join(goopspecDir, workflowId, file);
			const content = await readIfExists(filePath);
			if (content === null) continue;

			const existing = documents.get(workflow.id, docType);
			if (existing && existing.contentMd && existing.contentMd.trim().length > 0) {
				skipped += 1;
				continue;
			}

			try {
				if (docType === 'REQUIREMENTS') documents.writeRequirements(workflow.id, content);
				else if (docType === 'SPEC') documents.writeSpec(workflow.id, content, { amend: true });
				else documents.writeBlueprint(workflow.id, content);
				imported += 1;
			} catch {
				// Best-effort import; a single failure should not abort the scan.
				skipped += 1;
			}
		}
	}

	return { imported, skipped };
}
