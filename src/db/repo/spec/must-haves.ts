import type { SQLQueryBindings } from 'bun:sqlite';
import { z } from 'zod';

import { type Database } from '../../database.ts';
import {
	BaseRepo,
	RowNotFoundError,
	mapSqliteError,
} from './base.ts';

type MustHaveRow = {
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

type AcceptanceCriterionRow = {
	id: string;
	must_have_id: string;
	ac_id: string;
	text: string;
	ordinal: number;
	created_at: string;
};

type ValidationContractRow = {
	id: string;
	must_have_id: string;
	vc_id: string;
	text: string;
	severity: 'must' | 'should' | 'may';
	ordinal: number;
	created_at: string;
};

const DependenciesSchema = z.array(z.string());

export const MustHaveSchema = z.object({
	id: z.string(),
	workflowId: z.string(),
	mhId: z.string(),
	title: z.string(),
	description: z.string(),
	dependencies: z.array(z.string()),
	ordinal: z.number().int(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type MustHave = z.infer<typeof MustHaveSchema>;

export const AcceptanceCriterionSchema = z.object({
	id: z.string(),
	mustHaveId: z.string(),
	acId: z.string(),
	text: z.string(),
	ordinal: z.number().int(),
	createdAt: z.string(),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

export const ValidationContractSchema = z.object({
	id: z.string(),
	mustHaveId: z.string(),
	vcId: z.string(),
	text: z.string(),
	severity: z.enum(['must', 'should', 'may']),
	ordinal: z.number().int(),
	createdAt: z.string(),
});
export type ValidationContract = z.infer<typeof ValidationContractSchema>;

export const CreateMustHaveInputSchema = z.object({
	workflowId: z.string().min(1),
	mhId: z.string().min(1),
	title: z.string(),
	description: z.string(),
	dependencies: z.array(z.string()).optional().default([]),
	ordinal: z.number().int(),
});
export type CreateMustHaveInput = z.input<typeof CreateMustHaveInputSchema>;

export const UpdateMustHaveInputSchema = z.object({
	mhId: z.string().min(1).optional(),
	title: z.string().optional(),
	description: z.string().optional(),
	dependencies: z.array(z.string()).optional(),
	ordinal: z.number().int().optional(),
});
export type UpdateMustHaveInput = z.input<typeof UpdateMustHaveInputSchema>;

export const CreateAcceptanceCriterionInputSchema = z.object({
	mustHaveId: z.string().min(1),
	acId: z.string().min(1),
	text: z.string(),
	ordinal: z.number().int(),
});
export type CreateAcceptanceCriterionInput = z.input<typeof CreateAcceptanceCriterionInputSchema>;

export const CreateValidationContractInputSchema = z.object({
	mustHaveId: z.string().min(1),
	vcId: z.string().min(1),
	text: z.string(),
	severity: z.enum(['must', 'should', 'may']).optional().default('must'),
	ordinal: z.number().int(),
});
export type CreateValidationContractInput = z.input<typeof CreateValidationContractInputSchema>;

function rowToMustHave(row: MustHaveRow): MustHave {
	return MustHaveSchema.parse({
		id: row.id,
		workflowId: row.workflow_id,
		mhId: row.mh_id,
		title: row.title,
		description: row.description,
		dependencies: DependenciesSchema.parse(JSON.parse(row.dependencies) as unknown),
		ordinal: row.ordinal,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

function rowToAcceptanceCriterion(row: AcceptanceCriterionRow): AcceptanceCriterion {
	return AcceptanceCriterionSchema.parse({
		id: row.id,
		mustHaveId: row.must_have_id,
		acId: row.ac_id,
		text: row.text,
		ordinal: row.ordinal,
		createdAt: row.created_at,
	});
}

function rowToValidationContract(row: ValidationContractRow): ValidationContract {
	return ValidationContractSchema.parse({
		id: row.id,
		mustHaveId: row.must_have_id,
		vcId: row.vc_id,
		text: row.text,
		severity: row.severity,
		ordinal: row.ordinal,
		createdAt: row.created_at,
	});
}

export class MustHavesRepo extends BaseRepo {
	constructor(database: Database) {
		super(database);
	}

	/** List must-haves for a workflow ordered by ordinal, then id. */
	list(workflowId: string): MustHave[] {
		const rows = this.db
			.query('SELECT * FROM spec_must_haves WHERE workflow_id = ? ORDER BY ordinal ASC, id ASC')
			.all(workflowId) as MustHaveRow[];
		return rows.map(rowToMustHave);
	}

	/** Get one must-have by workflow and public must-have id. */
	get(workflowId: string, mhId: string): MustHave | null {
		const row = this.db
			.query('SELECT * FROM spec_must_haves WHERE workflow_id = ? AND mh_id = ?')
			.get(workflowId, mhId) as MustHaveRow | null;
		return row ? rowToMustHave(row) : null;
	}

	/** Get one must-have by primary key. */
	getById(id: string): MustHave | null {
		const row = this.db
			.query('SELECT * FROM spec_must_haves WHERE id = ?')
			.get(id) as MustHaveRow | null;
		return row ? rowToMustHave(row) : null;
	}

	/**
	 * Create a must-have. Lock check and insert run in one transaction to avoid TOCTOU.
	 */
	create(input: CreateMustHaveInput, opts?: { amend?: boolean }): MustHave {
		const data = CreateMustHaveInputSchema.parse(input);
		const id = crypto.randomUUID();
		const now = new Date().toISOString();

		return this.withTransaction(() => {
			this.assertNotLocked(data.workflowId, 'must_haves', opts);
			try {
				this.db.run(
					`INSERT INTO spec_must_haves (id, workflow_id, mh_id, title, description, dependencies, ordinal, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[id, data.workflowId, data.mhId, data.title, data.description, JSON.stringify(data.dependencies), data.ordinal, now, now],
				);
			} catch (err) {
				throw mapSqliteError(err, { operation: 'create', table: 'spec_must_haves' });
			}
			return this.getById(id)!;
		});
	}

	/** Update a must-have. Lock check and update run in one transaction to avoid TOCTOU. */
	update(id: string, partial: UpdateMustHaveInput, opts?: { amend?: boolean }): MustHave {
		const data = UpdateMustHaveInputSchema.parse(partial);
		return this.withTransaction(() => {
			const existing = this.getById(id);
			if (!existing) throw new RowNotFoundError({ table: 'spec_must_haves', id, idColumn: 'id' });
			this.assertNotLocked(existing.workflowId, 'must_haves', opts);

			const entries = Object.entries(data).filter(([, value]) => value !== undefined);
			if (entries.length > 0) {
				const columns: Record<string, string> = {
					mhId: 'mh_id',
					title: 'title',
					description: 'description',
					dependencies: 'dependencies',
					ordinal: 'ordinal',
				};
				const assignments = entries.map(([key]) => `${columns[key]} = ?`).join(', ');
				const values: SQLQueryBindings[] = entries.map(([key, value]) => {
					if (key === 'dependencies') return JSON.stringify(value);
					return value as SQLQueryBindings;
				});
				try {
					this.db.run(
						`UPDATE spec_must_haves SET ${assignments}, updated_at = ? WHERE id = ?`,
						[...values, new Date().toISOString(), id],
					);
				} catch (err) {
					throw mapSqliteError(err, { operation: 'update', table: 'spec_must_haves' });
				}
			}

			return this.getById(id)!;
		});
	}

	/** Delete a must-have. Lock check and delete run in one transaction to avoid TOCTOU. */
	delete(id: string, opts?: { amend?: boolean }): void {
		this.withTransaction(() => {
			const existing = this.getById(id);
			if (!existing) throw new RowNotFoundError({ table: 'spec_must_haves', id, idColumn: 'id' });
			this.assertNotLocked(existing.workflowId, 'must_haves', opts);
			try {
				this.db.run('DELETE FROM spec_must_haves WHERE id = ?', [id]);
			} catch (err) {
				throw mapSqliteError(err, { operation: 'delete', table: 'spec_must_haves' });
			}
		});
	}

	/** List acceptance criteria for a must-have ordered by ordinal, then id. */
	listAcceptanceCriteria(mustHaveId: string): AcceptanceCriterion[] {
		const rows = this.db
			.query('SELECT * FROM spec_acceptance_criteria WHERE must_have_id = ? ORDER BY ordinal ASC, id ASC')
			.all(mustHaveId) as AcceptanceCriterionRow[];
		return rows.map(rowToAcceptanceCriterion);
	}

	/** Add an acceptance criterion. Lock check and insert run in one transaction to avoid TOCTOU. */
	addAcceptanceCriterion(input: CreateAcceptanceCriterionInput, opts?: { amend?: boolean }): AcceptanceCriterion {
		const data = CreateAcceptanceCriterionInputSchema.parse(input);
		const id = crypto.randomUUID();
		return this.withTransaction(() => {
			const parent = this.getById(data.mustHaveId);
			if (!parent) throw new RowNotFoundError({ table: 'spec_must_haves', id: data.mustHaveId, idColumn: 'id' });
			this.assertNotLocked(parent.workflowId, 'acceptance_criteria', opts);
			try {
				this.db.run(
					`INSERT INTO spec_acceptance_criteria (id, must_have_id, ac_id, text, ordinal, created_at)
					 VALUES (?, ?, ?, ?, ?, ?)`,
					[id, data.mustHaveId, data.acId, data.text, data.ordinal, new Date().toISOString()],
				);
			} catch (err) {
				throw mapSqliteError(err, { operation: 'create', table: 'spec_acceptance_criteria' });
			}
			return this.listAcceptanceCriteria(data.mustHaveId).find((criterion) => criterion.id === id)!;
		});
	}

	/** Remove an acceptance criterion. Lock check and delete run in one transaction to avoid TOCTOU. */
	removeAcceptanceCriterion(id: string, opts?: { amend?: boolean }): void {
		this.withTransaction(() => {
			const row = this.db
				.query(
					`SELECT ac.*, mh.workflow_id FROM spec_acceptance_criteria ac
					 JOIN spec_must_haves mh ON mh.id = ac.must_have_id
					 WHERE ac.id = ?`,
				)
				.get(id) as (AcceptanceCriterionRow & { workflow_id: string }) | null;
			if (!row) throw new RowNotFoundError({ table: 'spec_acceptance_criteria', id, idColumn: 'id' });
			this.assertNotLocked(row.workflow_id, 'acceptance_criteria', opts);
			try {
				this.db.run('DELETE FROM spec_acceptance_criteria WHERE id = ?', [id]);
			} catch (err) {
				throw mapSqliteError(err, { operation: 'delete', table: 'spec_acceptance_criteria' });
			}
		});
	}

	/** List validation contracts for a must-have ordered by ordinal, then id. */
	listValidationContracts(mustHaveId: string): ValidationContract[] {
		const rows = this.db
			.query('SELECT * FROM spec_validation_contracts WHERE must_have_id = ? ORDER BY ordinal ASC, id ASC')
			.all(mustHaveId) as ValidationContractRow[];
		return rows.map(rowToValidationContract);
	}

	/** Add a validation contract. Lock check and insert run in one transaction to avoid TOCTOU. */
	addValidationContract(input: CreateValidationContractInput, opts?: { amend?: boolean }): ValidationContract {
		const data = CreateValidationContractInputSchema.parse(input);
		const id = crypto.randomUUID();
		return this.withTransaction(() => {
			const parent = this.getById(data.mustHaveId);
			if (!parent) throw new RowNotFoundError({ table: 'spec_must_haves', id: data.mustHaveId, idColumn: 'id' });
			this.assertNotLocked(parent.workflowId, 'validation_contracts', opts);
			try {
				this.db.run(
					`INSERT INTO spec_validation_contracts (id, must_have_id, vc_id, text, severity, ordinal, created_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`,
					[id, data.mustHaveId, data.vcId, data.text, data.severity, data.ordinal, new Date().toISOString()],
				);
			} catch (err) {
				throw mapSqliteError(err, { operation: 'create', table: 'spec_validation_contracts' });
			}
			return this.listValidationContracts(data.mustHaveId).find((contract) => contract.id === id)!;
		});
	}

	/** Remove a validation contract. Lock check and delete run in one transaction to avoid TOCTOU. */
	removeValidationContract(id: string, opts?: { amend?: boolean }): void {
		this.withTransaction(() => {
			const row = this.db
				.query(
					`SELECT vc.*, mh.workflow_id FROM spec_validation_contracts vc
					 JOIN spec_must_haves mh ON mh.id = vc.must_have_id
					 WHERE vc.id = ?`,
				)
				.get(id) as (ValidationContractRow & { workflow_id: string }) | null;
			if (!row) throw new RowNotFoundError({ table: 'spec_validation_contracts', id, idColumn: 'id' });
			this.assertNotLocked(row.workflow_id, 'validation_contracts', opts);
			try {
				this.db.run('DELETE FROM spec_validation_contracts WHERE id = ?', [id]);
			} catch (err) {
				throw mapSqliteError(err, { operation: 'delete', table: 'spec_validation_contracts' });
			}
		});
	}

	/** List all acceptance criteria for a workflow ordered by must-have then criterion ordinal. */
	listAcceptanceCriteriaForWorkflow(workflowId: string): AcceptanceCriterion[] {
		const rows = this.db
			.query(
				`SELECT ac.* FROM spec_acceptance_criteria ac
				 JOIN spec_must_haves mh ON mh.id = ac.must_have_id
				 WHERE mh.workflow_id = ?
				 ORDER BY mh.ordinal ASC, mh.id ASC, ac.ordinal ASC, ac.id ASC`,
			)
			.all(workflowId) as AcceptanceCriterionRow[];
		return rows.map(rowToAcceptanceCriterion);
	}

	/** List all validation contracts for a workflow ordered by must-have then contract ordinal. */
	listValidationContractsForWorkflow(workflowId: string): ValidationContract[] {
		const rows = this.db
			.query(
				`SELECT vc.* FROM spec_validation_contracts vc
				 JOIN spec_must_haves mh ON mh.id = vc.must_have_id
				 WHERE mh.workflow_id = ?
				 ORDER BY mh.ordinal ASC, mh.id ASC, vc.ordinal ASC, vc.id ASC`,
			)
			.all(workflowId) as ValidationContractRow[];
		return rows.map(rowToValidationContract);
	}
}
