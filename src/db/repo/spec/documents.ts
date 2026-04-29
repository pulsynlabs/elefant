import { z } from 'zod';

import { type Database } from '../../database.ts';
import { WorkflowNotFoundError } from '../../../state/errors.ts';
import { BaseRepo, mapSqliteError } from './base.ts';
import { MustHavesRepo } from './must-haves.ts';

export type SpecDocType = 'REQUIREMENTS' | 'SPEC' | 'BLUEPRINT' | 'CHRONICLE' | 'ADL';

export const SpecDocTypeSchema = z.enum(['REQUIREMENTS', 'SPEC', 'BLUEPRINT', 'CHRONICLE', 'ADL']);

export const SpecDocumentSchema = z.object({
	id: z.string(),
	workflowId: z.string(),
	docType: SpecDocTypeSchema,
	contentMd: z.string(),
	version: z.number().int().positive(),
	locked: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type SpecDocument = z.infer<typeof SpecDocumentSchema>;

export const OutOfScopeItemSchema = z.object({
	id: z.string(),
	workflowId: z.string(),
	item: z.string(),
	reason: z.string(),
	ordinal: z.number().int(),
	createdAt: z.string(),
});
export type OutOfScopeItem = z.infer<typeof OutOfScopeItemSchema>;

export interface AmendmentTransactionContext {
	documents: SpecDocumentsRepo;
	mustHaves: MustHavesRepo;
}

type SpecDocumentRow = {
	id: string;
	workflow_id: string;
	doc_type: SpecDocType;
	content_md: string;
	version: number;
	locked: number;
	created_at: string;
	updated_at: string;
};

type WorkflowLockRow = {
	id: string;
	project_id: string;
	workflow_id: string;
	spec_locked: number;
};

type AmendmentVersionRow = { v: number };

type SnapshotMustHaveRow = {
	id: string;
	workflow_id: string;
	mh_id: string;
	title: string;
	description: string;
	dependencies: string;
	ordinal: number;
	created_at: string;
	updated_at: string;
};

type SnapshotAcceptanceCriterionRow = {
	id: string;
	must_have_id: string;
	ac_id: string;
	text: string;
	ordinal: number;
	created_at: string;
};

type SnapshotValidationContractRow = {
	id: string;
	must_have_id: string;
	vc_id: string;
	text: string;
	severity: string;
	ordinal: number;
	created_at: string;
};

type SnapshotOutOfScopeRow = {
	id: string;
	workflow_id: string;
	item: string;
	reason: string;
	ordinal: number;
	created_at: string;
};

type ProtectedStateSnapshot = {
	mustHaves: SnapshotMustHaveRow[];
	acceptanceCriteria: SnapshotAcceptanceCriterionRow[];
	validationContracts: SnapshotValidationContractRow[];
	outOfScope: SnapshotOutOfScopeRow[];
	specContentMd: string | null;
};

function rowToDocument(row: SpecDocumentRow): SpecDocument {
	return SpecDocumentSchema.parse({
		id: row.id,
		workflowId: row.workflow_id,
		docType: row.doc_type,
		contentMd: row.content_md,
		version: row.version,
		locked: row.locked === 1,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

function rowToOutOfScope(row: SnapshotOutOfScopeRow): OutOfScopeItem {
	return OutOfScopeItemSchema.parse({
		id: row.id,
		workflowId: row.workflow_id,
		item: row.item,
		reason: row.reason,
		ordinal: row.ordinal,
		createdAt: row.created_at,
	});
}

export class SpecDocumentsRepo extends BaseRepo {
	constructor(database: Database) {
		super(database);
	}

	/** List documents for a workflow ordered by doc_type ASC for deterministic output. */
	list(workflowId: string): SpecDocument[] {
		const rows = this.db
			.query('SELECT * FROM spec_documents WHERE workflow_id = ? ORDER BY doc_type ASC')
			.all(workflowId) as SpecDocumentRow[];
		return rows.map(rowToDocument);
	}

	/** Get a document by workflow and type, or null when missing. */
	get(workflowId: string, docType: SpecDocType): SpecDocument | null {
		const row = this.db
			.query('SELECT * FROM spec_documents WHERE workflow_id = ? AND doc_type = ?')
			.get(workflowId, docType) as SpecDocumentRow | null;
		return row ? rowToDocument(row) : null;
	}

	/** Get the REQUIREMENTS document. */
	getRequirements(workflowId: string): SpecDocument | null { return this.get(workflowId, 'REQUIREMENTS'); }
	/** Get the SPEC document. */
	getSpec(workflowId: string): SpecDocument | null { return this.get(workflowId, 'SPEC'); }
	/** Get the BLUEPRINT document. */
	getBlueprint(workflowId: string): SpecDocument | null { return this.get(workflowId, 'BLUEPRINT'); }
	/** Get the CHRONICLE document. */
	getChronicle(workflowId: string): SpecDocument | null { return this.get(workflowId, 'CHRONICLE'); }
	/** Get the ADL document. */
	getAdl(workflowId: string): SpecDocument | null { return this.get(workflowId, 'ADL'); }

	private writeDocument(workflowId: string, docType: SpecDocType, content: string): SpecDocument {
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		try {
			this.db.run(
				`INSERT INTO spec_documents (id, workflow_id, doc_type, content_md, version, locked, created_at, updated_at)
				 VALUES (?, ?, ?, ?, 1, 0, ?, ?)
				 ON CONFLICT(workflow_id, doc_type) DO UPDATE SET
				 content_md = excluded.content_md,
				 version = spec_documents.version + 1,
				 updated_at = excluded.updated_at`,
				[id, workflowId, docType, content, now, now],
			);
		} catch (err) {
			throw mapSqliteError(err, { operation: 'write', table: 'spec_documents' });
		}

		return this.get(workflowId, docType)!;
	}

	/** Write REQUIREMENTS content. Not lock-protected in Wave 1. */
	writeRequirements(workflowId: string, content: string): SpecDocument {
		return this.writeDocument(workflowId, 'REQUIREMENTS', content);
	}

	/** Write BLUEPRINT content. Not lock-protected in Wave 1. */
	writeBlueprint(workflowId: string, content: string): SpecDocument {
		return this.writeDocument(workflowId, 'BLUEPRINT', content);
	}

	/** Write CHRONICLE content. Not lock-protected in Wave 1. */
	writeChronicle(workflowId: string, content: string): SpecDocument {
		return this.writeDocument(workflowId, 'CHRONICLE', content);
	}

	/** Write ADL content. Not lock-protected in Wave 1. */
	writeAdl(workflowId: string, content: string): SpecDocument {
		return this.writeDocument(workflowId, 'ADL', content);
	}

	/**
	 * Write SPEC content. Lock check and document update run in one transaction to avoid TOCTOU.
	 */
	writeSpec(workflowId: string, content: string, opts?: { amend?: boolean }): SpecDocument {
		return this.withTransaction(() => {
			this.assertNotLocked(workflowId, 'spec', opts);
			return this.writeDocument(workflowId, 'SPEC', content);
		});
	}

	/** Return out-of-scope items ordered by ordinal, then id. */
	getOutOfScope(workflowId: string): OutOfScopeItem[] {
		const rows = this.db
			.query('SELECT * FROM spec_out_of_scope WHERE workflow_id = ? ORDER BY ordinal ASC, id ASC')
			.all(workflowId) as SnapshotOutOfScopeRow[];
		return rows.map(rowToOutOfScope);
	}

	/**
	 * Replace all out-of-scope items for a workflow. Lock check and replace run in one transaction to avoid TOCTOU.
	 */
	writeOutOfScope(
		workflowId: string,
		items: { item: string; reason: string }[],
		opts?: { amend?: boolean },
	): OutOfScopeItem[] {
		return this.withTransaction(() => {
			this.assertNotLocked(workflowId, 'out_of_scope', opts);
			try {
				this.db.run('DELETE FROM spec_out_of_scope WHERE workflow_id = ?', [workflowId]);
				const now = new Date().toISOString();
				for (const [index, item] of items.entries()) {
					this.db.run(
						`INSERT INTO spec_out_of_scope (id, workflow_id, item, reason, ordinal, created_at)
						 VALUES (?, ?, ?, ?, ?, ?)`,
						[crypto.randomUUID(), workflowId, item.item, item.reason, index + 1, now],
					);
				}
			} catch (err) {
				throw mapSqliteError(err, { operation: 'replace', table: 'spec_out_of_scope' });
			}

			return this.getOutOfScope(workflowId);
		});
	}

	/**
	 * Apply a spec amendment as one SQLite transaction with prior+new snapshots.
	 *
	 * The mutation callback is synchronous and receives repos sharing this repo's
	 * underlying `Database` wrapper, so all protected writes participate in the
	 * active transaction on the same SQLite connection.
	 */
	applyAmendment(
		workflowId: string,
		amendment: { rationale: string; mutate: (tx: AmendmentTransactionContext) => void },
	): { version: number; amendmentId: string } {
		return this.withTransaction(() => {
			const workflow = this.db
				.query('SELECT id, project_id, workflow_id, spec_locked FROM spec_workflows WHERE id = ?')
				.get(workflowId) as WorkflowLockRow | null;
			if (!workflow) {
				throw new WorkflowNotFoundError({ code: 'WORKFLOW_NOT_FOUND', projectId: 'unknown', workflowId });
			}

			const wasLocked = workflow.spec_locked === 1;
			const priorState = this.snapshotProtectedState(workflowId);
			const versionRow = this.db
				.query('SELECT COALESCE(MAX(version), 0) AS v FROM spec_amendments WHERE workflow_id = ?')
				.get(workflowId) as AmendmentVersionRow;
			const nextVersion = versionRow.v + 1;

			if (wasLocked) {
				this.db.run('UPDATE spec_workflows SET spec_locked = 0, updated_at = ?, last_activity = ? WHERE id = ?', [
					new Date().toISOString(),
					new Date().toISOString(),
					workflowId,
				]);
			}

			const ctx: AmendmentTransactionContext = {
				documents: this,
				mustHaves: new MustHavesRepo(this.database),
			};
			amendment.mutate(ctx);

			if (wasLocked) {
				const now = new Date().toISOString();
				this.db.run('UPDATE spec_workflows SET spec_locked = 1, updated_at = ?, last_activity = ? WHERE id = ?', [now, now, workflowId]);
			}

			const newState = this.snapshotProtectedState(workflowId);
			const amendmentId = crypto.randomUUID();
			try {
				this.db.run(
					`INSERT INTO spec_amendments (id, workflow_id, version, prior_state, new_state, rationale, created_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`,
					[
						amendmentId,
						workflowId,
						nextVersion,
						JSON.stringify(priorState),
						JSON.stringify(newState),
						amendment.rationale,
						new Date().toISOString(),
					],
				);
			} catch (err) {
				throw mapSqliteError(err, { operation: 'create', table: 'spec_amendments' });
			}

			return { version: nextVersion, amendmentId };
		});
	}

	private snapshotProtectedState(workflowId: string): ProtectedStateSnapshot {
		const mustHaves = this.db
			.query('SELECT * FROM spec_must_haves WHERE workflow_id = ? ORDER BY ordinal ASC, id ASC')
			.all(workflowId) as SnapshotMustHaveRow[];
		const acceptanceCriteria = this.db
			.query(
				`SELECT ac.* FROM spec_acceptance_criteria ac
				 JOIN spec_must_haves mh ON mh.id = ac.must_have_id
				 WHERE mh.workflow_id = ?
				 ORDER BY mh.ordinal ASC, mh.id ASC, ac.ordinal ASC, ac.id ASC`,
			)
			.all(workflowId) as SnapshotAcceptanceCriterionRow[];
		const validationContracts = this.db
			.query(
				`SELECT vc.* FROM spec_validation_contracts vc
				 JOIN spec_must_haves mh ON mh.id = vc.must_have_id
				 WHERE mh.workflow_id = ?
				 ORDER BY mh.ordinal ASC, mh.id ASC, vc.ordinal ASC, vc.id ASC`,
			)
			.all(workflowId) as SnapshotValidationContractRow[];
		const outOfScope = this.db
			.query('SELECT * FROM spec_out_of_scope WHERE workflow_id = ? ORDER BY ordinal ASC, id ASC')
			.all(workflowId) as SnapshotOutOfScopeRow[];
		const specDoc = this.db
			.query('SELECT content_md FROM spec_documents WHERE workflow_id = ? AND doc_type = ?')
			.get(workflowId, 'SPEC') as { content_md: string } | null;

		return {
			mustHaves,
			acceptanceCriteria,
			validationContracts,
			outOfScope,
			specContentMd: specDoc?.content_md ?? null,
		};
	}
}
