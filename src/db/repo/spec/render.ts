import type { Database } from '../../database.ts';
import { RowNotFoundError } from './base.ts';
import { SpecDocumentsRepo, type OutOfScopeItem } from './documents.ts';
import type { SpecDocType } from './documents.ts';
import { MustHavesRepo, type MustHave, type AcceptanceCriterion, type ValidationContract } from './must-haves.ts';
import { SpecWorkflowsRepo } from './workflows.ts';
import type { SpecWorkflow } from '../../../state/schema.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Join lines with \n and append a single trailing newline. */
function render(lines: string[]): string {
	return lines.join('\n') + '\n';
}

/**
 * Render the Out of Scope section used by both renderRequirements and renderSpec.
 * Items are sorted by ordinal ASC by the repo.
 */
function renderOutOfScope(items: OutOfScopeItem[]): string[] {
	const lines: string[] = [];
	lines.push('## Out of Scope');
	lines.push('');
	if (items.length === 0) {
		lines.push('_None defined yet._');
	} else {
		for (const oos of items) {
			lines.push(`- **${oos.item}** — ${oos.reason}`);
		}
	}
	return lines;
}

/**
 * Render the Acceptance Criteria inside a must-have block.
 * ACs are sorted by ordinal ASC by the repo.
 */
function renderAcceptanceCriteria(acs: AcceptanceCriterion[]): string[] {
	const lines: string[] = [];
	for (const ac of acs) {
		lines.push(`    - [ ] ${ac.acId}: ${ac.text}`);
	}
	return lines;
}

/**
 * Render the Validation Contracts inside a SPEC must-have block.
 * VCs are sorted by ordinal ASC by the repo.
 */
function renderValidationContracts(vcs: ValidationContract[]): string[] {
	const lines: string[] = [];
	for (const vc of vcs) {
		lines.push(`- **${vc.vcId}** [${vc.severity.toUpperCase()}]: ${vc.text}`);
	}
	return lines;
}

/**
 * Render the Access Criteria with leading checklist format for SPEC.
 */
function renderAcceptanceCriteriaSpec(acs: AcceptanceCriterion[]): string[] {
	const lines: string[] = [];
	for (const ac of acs) {
		lines.push(`- [ ] **${ac.acId}:** ${ac.text}`);
	}
	return lines;
}

// ---------------------------------------------------------------------------
// SpecRenderer
// ---------------------------------------------------------------------------

/**
 * Byte-stable markdown renderer that converts structured DB rows for each
 * document type into deterministic markdown output.
 *
 * Determinism guarantees:
 * - All collections are sorted by ordinal ASC, id ASC (NEVER by Map iteration order)
 * - No Date.now() or runtime-generated timestamps in the output
 * - \n line endings exclusively
 * - Single trailing newline always present
 * - Header timestamps come from spec_workflows.created_at and updated_at only
 */
export class SpecRenderer {
	constructor(private readonly database: Database) {}

	// -----------------------------------------------------------------------
	// Internal helpers
	// -----------------------------------------------------------------------

	/**
	 * Resolve a workflow by primary key UUID. Throws RowNotFoundError if missing.
	 */
	private getWorkflow(workflowId: string): SpecWorkflow {
		const repo = new SpecWorkflowsRepo(this.database);
		const workflow = repo.getById(workflowId);
		if (!workflow) {
			throw new RowNotFoundError({ table: 'spec_workflows', id: workflowId, idColumn: 'id' });
		}
		return workflow;
	}

	// -----------------------------------------------------------------------
	// Public render methods
	// -----------------------------------------------------------------------

	renderRequirements(workflowId: string): string {
		const workflow = this.getWorkflow(workflowId);
		const docsRepo = new SpecDocumentsRepo(this.database);
		const mhRepo = new MustHavesRepo(this.database);

		const requirementsDoc = docsRepo.getRequirements(workflowId);
		const mustHaves = mhRepo.list(workflowId);
		const outOfScope = docsRepo.getOutOfScope(workflowId);

		const lines: string[] = [];

		// Header
		lines.push(`# REQUIREMENTS: ${workflow.workflowId}`);
		lines.push('');
		lines.push(`**Generated:** ${workflow.createdAt}`);
		lines.push(`**Workflow:** ${workflow.workflowId}`);
		lines.push(`**Interview Status:** ${workflow.interviewComplete ? 'Complete' : 'In Progress'}`);
		lines.push(`**Ready for Planning:** ${workflow.interviewComplete ? 'Yes' : 'No'}`);
		lines.push('');
		lines.push('---');
		lines.push('');
		lines.push('## Vision');
		lines.push('');
		lines.push(requirementsDoc?.contentMd || '_No vision statement recorded yet._');
		lines.push('');
		lines.push('---');
		lines.push('');
		lines.push('## Must-Haves (The Contract)');
		lines.push('');

		// Must-Haves
		for (const mh of mustHaves) {
			const acs = mhRepo.listAcceptanceCriteria(mh.id);
			lines.push(`- [ ] **${mh.mhId}**: ${mh.title}`);
			lines.push(`  - ${mh.description}`);
			const deps = mh.dependencies.length > 0 ? mh.dependencies.join(', ') : 'None';
			lines.push(`  - **Dependencies:** ${deps}`);
			lines.push('  - **Acceptance Criteria:**');
			for (const line of renderAcceptanceCriteria(acs)) {
				lines.push(line);
			}
			lines.push('');
		}

		lines.push('---');
		lines.push('');

		// Out of Scope
		for (const line of renderOutOfScope(outOfScope)) {
			lines.push(line);
		}
		lines.push('');
		lines.push('---');
		lines.push('');
		lines.push(`*Generated by Elefant Spec Mode — ${workflow.workflowId}*`);

		return render(lines);
	}

	renderSpec(workflowId: string): string {
		const workflow = this.getWorkflow(workflowId);
		const docsRepo = new SpecDocumentsRepo(this.database);
		const mhRepo = new MustHavesRepo(this.database);

		const specDoc = docsRepo.getSpec(workflowId);
		const mustHaves = mhRepo.list(workflowId);
		const outOfScope = docsRepo.getOutOfScope(workflowId);

		const lines: string[] = [];

		// Header
		lines.push(`# SPEC: ${workflow.workflowId}`);
		lines.push('');
		const status = workflow.specLocked ? 'Locked \u{1F512}' : 'Draft';
		lines.push(`**Status:** ${status}`);
		lines.push(`**Workflow:** ${workflow.workflowId}`);
		lines.push(`**Generated:** ${workflow.createdAt}`);
		lines.push(`**Last Updated:** ${workflow.updatedAt}`);
		lines.push('');
		lines.push('---');
		lines.push('');
		lines.push('## Specification');
		lines.push('');
		lines.push(specDoc?.contentMd || '_Spec not yet written._');
		lines.push('');
		lines.push('---');
		lines.push('');
		lines.push('## Must-Haves (Formal Requirements)');
		lines.push('');

		// Must-Haves
		for (const mh of mustHaves) {
			const acs = mhRepo.listAcceptanceCriteria(mh.id);
			const vcs = mhRepo.listValidationContracts(mh.id);

			lines.push(`### ${mh.mhId}: ${mh.title}`);
			lines.push('');
			lines.push(mh.description);
			lines.push('');
			lines.push('**Acceptance Criteria:**');
			for (const line of renderAcceptanceCriteriaSpec(acs)) {
				lines.push(line);
			}
			lines.push('');
			lines.push('**Validation Contracts:**');
			if (vcs.length === 0) {
				lines.push('_None defined._');
			} else {
				for (const line of renderValidationContracts(vcs)) {
					lines.push(line);
				}
			}
			lines.push('');
			lines.push('---');
			lines.push('');
		}

		// Out of Scope
		for (const line of renderOutOfScope(outOfScope)) {
			lines.push(line);
		}
		lines.push('');
		lines.push('---');
		lines.push('');

		const lockLabel = workflow.specLocked ? 'LOCKED' : 'DRAFT';
		lines.push(`*Spec Mode — ${workflow.workflowId} — ${lockLabel}*`);

		return render(lines);
	}

	renderBlueprint(workflowId: string): string {
		const workflow = this.getWorkflow(workflowId);
		const docsRepo = new SpecDocumentsRepo(this.database);

		const blueprintDoc = docsRepo.getBlueprint(workflowId);

		const lines: string[] = [];

		lines.push(`# BLUEPRINT: ${workflow.workflowId}`);
		lines.push('');
		lines.push(`**Workflow:** ${workflow.workflowId}`);
		lines.push(`**Generated:** ${workflow.createdAt}`);
		lines.push(`**Current Wave:** ${workflow.currentWave} / ${workflow.totalWaves}`);
		lines.push('');
		lines.push('---');
		lines.push('');
		lines.push(blueprintDoc?.contentMd || '_Blueprint not yet written._');
		lines.push('');
		lines.push('---');
		lines.push('');
		lines.push(`*Elefant Spec Mode — Blueprint — ${workflow.workflowId}*`);

		return render(lines);
	}

	renderChronicle(workflowId: string): string {
		const workflow = this.getWorkflow(workflowId);
		const docsRepo = new SpecDocumentsRepo(this.database);

		const chronicleDoc = docsRepo.getChronicle(workflowId);

		const lines: string[] = [];

		lines.push(`# CHRONICLE: ${workflow.workflowId}`);
		lines.push('');
		lines.push(`**Workflow:** ${workflow.workflowId}`);
		lines.push(`**Phase:** ${workflow.phase}`);
		lines.push(`**Generated:** ${workflow.createdAt}`);
		lines.push('');
		lines.push('---');
		lines.push('');
		lines.push('## Phase Log');
		lines.push('');
		lines.push(chronicleDoc?.contentMd ?? '');
		lines.push('');
		lines.push('---');
		lines.push('');
		lines.push(`*Elefant Spec Mode — Chronicle — ${workflow.workflowId}*`);

		return render(lines);
	}

	renderAdl(workflowId: string): string {
		const workflow = this.getWorkflow(workflowId);
		const docsRepo = new SpecDocumentsRepo(this.database);

		const adlDoc = docsRepo.getAdl(workflowId);

		const lines: string[] = [];

		lines.push(`# ADL: ${workflow.workflowId} — Architectural Decision Log`);
		lines.push('');
		lines.push(`**Workflow:** ${workflow.workflowId}`);
		lines.push(`**Generated:** ${workflow.createdAt}`);
		lines.push('');
		lines.push('---');
		lines.push('');
		lines.push(adlDoc?.contentMd || '_No decisions recorded yet._');
		lines.push('');
		lines.push('---');
		lines.push('');
		lines.push(`*Elefant Spec Mode — ADL — ${workflow.workflowId}*`);

		return render(lines);
	}

	renderAll(workflowId: string): Record<SpecDocType, string> {
		return {
			REQUIREMENTS: this.renderRequirements(workflowId),
			SPEC: this.renderSpec(workflowId),
			BLUEPRINT: this.renderBlueprint(workflowId),
			CHRONICLE: this.renderChronicle(workflowId),
			ADL: this.renderAdl(workflowId),
		};
	}
}
