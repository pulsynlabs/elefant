import { afterEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../../database.ts';
import { RowNotFoundError } from './base.ts';
import { SpecDocumentsRepo } from './documents.ts';
import { MustHavesRepo } from './must-haves.ts';
import { SpecWorkflowsRepo } from './workflows.ts';
import { SpecRenderer } from './render.ts';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
const databases: Database[] = [];

function setup(): {
	database: Database;
	projectId: string;
	workflowId: string;
	workflowKebab: string;
	renderer: SpecRenderer;
	documents: SpecDocumentsRepo;
	mustHaves: MustHavesRepo;
} {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-render-'));
	tempDirs.push(dir);
	const database = new Database(join(dir, 'db.sqlite'));
	databases.push(database);

	const projectId = crypto.randomUUID();
	database.db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [
		projectId,
		'test-project',
		join(dir, 'project'),
	]);

	const workflowKebab = `wf-${crypto.randomUUID().slice(0, 8)}`;
	const workflow = new SpecWorkflowsRepo(database).create({
		projectId,
		workflowId: workflowKebab,
	});

	const renderer = new SpecRenderer(database);
	const documents = new SpecDocumentsRepo(database);
	const mustHaves = new MustHavesRepo(database);

	return {
		database,
		projectId,
		workflowId: workflow.id,
		workflowKebab,
		renderer,
		documents,
		mustHaves,
	};
}

afterEach(() => {
	for (const database of databases.splice(0)) {
		database.close();
	}
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SpecRenderer', () => {
	// 1. Byte-stability — renderSpec (VC2.B critical)
	it('renderSpec produces byte-identical output across two consecutive renders', () => {
		const { workflowId, documents, mustHaves } = setup();
		documents.writeSpec(workflowId, '# My Spec\n\nSome content.');
		const mh = mustHaves.create({
			workflowId,
			mhId: 'MH1',
			title: 'First Requirement',
			description: 'A description.',
			ordinal: 1,
		});
		mustHaves.addAcceptanceCriterion({
			mustHaveId: mh.id,
			acId: 'AC1.1',
			text: 'Must work',
			ordinal: 1,
		});
		mustHaves.addValidationContract({
			mustHaveId: mh.id,
			vcId: 'VC1.A',
			text: 'Must validate',
			ordinal: 1,
		});

		const renderer = new SpecRenderer(documents.database);

		const output1 = renderer.renderSpec(workflowId);
		const output2 = renderer.renderSpec(workflowId);

		expect(output1).toBe(output2);

		const hash1 = createHash('sha256').update(output1).digest('hex');
		const hash2 = createHash('sha256').update(output2).digest('hex');
		expect(hash1).toBe(hash2);
	});

	// 2. Byte-stability — renderRequirements
	it('renderRequirements produces byte-identical output across two consecutive renders', () => {
		const { workflowId, documents, mustHaves } = setup();
		documents.writeRequirements(workflowId, '# Vision');
		mustHaves.create({
			workflowId,
			mhId: 'MH1',
			title: 'A Must-Have',
			description: 'Desc',
			ordinal: 1,
		});

		const renderer = new SpecRenderer(documents.database);

		const output1 = renderer.renderRequirements(workflowId);
		const output2 = renderer.renderRequirements(workflowId);

		expect(output1).toBe(output2);

		const hash1 = createHash('sha256').update(output1).digest('hex');
		const hash2 = createHash('sha256').update(output2).digest('hex');
		expect(hash1).toBe(hash2);
	});

	// 3. renderRequirements — empty state
	it('renderRequirements renders placeholders when no must-haves or docs exist', () => {
		const { workflowId, workflowKebab, renderer } = setup();

		const output = renderer.renderRequirements(workflowId);

		expect(output).toContain(`# REQUIREMENTS: ${workflowKebab}`);
		expect(output).toContain('_No vision statement recorded yet._');
		expect(output).toContain('_None defined yet._');
		expect(output).toContain('**Interview Status:** In Progress');
		expect(output).toContain('**Ready for Planning:** No');
		expect(output.endsWith('\n')).toBe(true);
		// No trailing spaces check: no line should end with space
		for (const line of output.split('\n')) {
			expect(line.endsWith(' ')).toBe(false);
		}
	});

	// 4. renderRequirements — with must-haves and ACs
	it('renderRequirements renders must-haves with ACs in ordinal order', () => {
		const { workflowId, documents, mustHaves } = setup();
		documents.writeRequirements(workflowId, '# Vision');

		const mh1 = mustHaves.create({
			workflowId,
			mhId: 'MH2',
			title: 'Second',
			description: 'Second description.',
			dependencies: ['MH1'],
			ordinal: 2,
		});
		mustHaves.addAcceptanceCriterion({
			mustHaveId: mh1.id, acId: 'AC2.2', text: 'Test 2b', ordinal: 2,
		});
		mustHaves.addAcceptanceCriterion({
			mustHaveId: mh1.id, acId: 'AC2.1', text: 'Test 2a', ordinal: 1,
		});

		const mh2 = mustHaves.create({
			workflowId,
			mhId: 'MH1',
			title: 'First',
			description: 'First description.',
			dependencies: [],
			ordinal: 1,
		});
		mustHaves.addAcceptanceCriterion({
			mustHaveId: mh2.id, acId: 'AC1.2', text: 'Test 1b', ordinal: 2,
		});
		mustHaves.addAcceptanceCriterion({
			mustHaveId: mh2.id, acId: 'AC1.1', text: 'Test 1a', ordinal: 1,
		});

		const renderer = new SpecRenderer(documents.database);
		const output = renderer.renderRequirements(workflowId);

		// Verify MH1 comes before MH2 (sorted by ordinal)
		const mh1Index = output.indexOf('**MH1**:');
		const mh2Index = output.indexOf('**MH2**:');
		expect(mh1Index).toBeGreaterThan(0);
		expect(mh2Index).toBeGreaterThan(0);
		expect(mh1Index).toBeLessThan(mh2Index);

		// Verify AC ordering
		const ac1aIndex = output.indexOf('AC1.1');
		const ac1bIndex = output.indexOf('AC1.2');
		expect(ac1aIndex).toBeLessThan(ac1bIndex);

		// Verify dependencies formatting
		expect(output).toContain('**Dependencies:** MH1');
		expect(output).toContain('**Dependencies:** None');
	});

	// 5. renderSpec — locked vs unlocked
	it('renderSpec shows "Draft" when unlocked and "Locked 🔒" when locked', () => {
		const { workflowId, database, renderer } = setup();

		const unlocked = renderer.renderSpec(workflowId);
		expect(unlocked).toContain('**Status:** Draft');

		// Lock the workflow
		database.db.run('UPDATE spec_workflows SET spec_locked = 1 WHERE id = ?', [workflowId]);

		// Re-fetch because renderer creates new repo instances internally
		const locked = renderer.renderSpec(workflowId);
		expect(locked).toContain('**Status:** Locked \u{1F512}');
	});

	// 6. renderSpec — with VCs; severity UPPERCASE
	it('renderSpec renders VCs with UPPERCASE severity', () => {
		const { workflowId, mustHaves } = setup();

		const mh = mustHaves.create({
			workflowId,
			mhId: 'MH1',
			title: 'Security',
			description: 'Must be secure.',
			ordinal: 1,
		});
		mustHaves.addAcceptanceCriterion({
			mustHaveId: mh.id, acId: 'AC1.1', text: 'Check auth', ordinal: 1,
		});
		mustHaves.addValidationContract({
			mustHaveId: mh.id, vcId: 'VC1.A', text: 'No SQL injection', severity: 'must', ordinal: 1,
		});
		mustHaves.addValidationContract({
			mustHaveId: mh.id, vcId: 'VC1.B', text: 'Rate limited', severity: 'should', ordinal: 2,
		});

		const renderer = new SpecRenderer(mustHaves.database);
		const output = renderer.renderSpec(workflowId);

		expect(output).toContain('**VC1.A** [MUST]: No SQL injection');
		expect(output).toContain('**VC1.B** [SHOULD]: Rate limited');
	});

	// 7. renderSpec — OOS items appear
	it('renderSpec renders Out of Scope items', () => {
		const { workflowId, documents } = setup();
		documents.writeOutOfScope(workflowId, [
			{ item: 'Feature X', reason: 'Out of budget' },
			{ item: 'Feature Y', reason: 'Post Phase 1' },
		]);

		const renderer = new SpecRenderer(documents.database);
		const output = renderer.renderSpec(workflowId);

		expect(output).toContain('- **Feature X** — Out of budget');
		expect(output).toContain('- **Feature Y** — Post Phase 1');
		expect(output).toContain('## Out of Scope');
	});

	// 8. renderBlueprint — wraps content
	it('renderBlueprint wraps blueprint_doc contentMd with header and footer', () => {
		const { workflowId, workflowKebab, documents } = setup();
		documents.writeBlueprint(workflowId, '# Blueprint Content\n\nWave 1 details.');

		const renderer = new SpecRenderer(documents.database);
		const output = renderer.renderBlueprint(workflowId);

		expect(output).toContain(`# BLUEPRINT: ${workflowKebab}`);
		expect(output).toContain('# Blueprint Content');
		expect(output).toContain('Wave 1 details.');
		expect(output).toContain('**Current Wave:** 0 / 0');
		expect(output).toContain(`*Elefant Spec Mode — Blueprint — ${workflowKebab}*`);
	});

	// 9. renderChronicle — wraps content
	it('renderChronicle wraps chronicle_doc contentMd', () => {
		const { workflowId, workflowKebab, documents } = setup();
		documents.writeChronicle(workflowId, '## Session 1\n\nStarted work.');

		const renderer = new SpecRenderer(documents.database);
		const output = renderer.renderChronicle(workflowId);

		expect(output).toContain(`# CHRONICLE: ${workflowKebab}`);
		expect(output).toContain('## Session 1');
		expect(output).toContain('Started work.');
		expect(output).toContain(`*Elefant Spec Mode — Chronicle — ${workflowKebab}*`);
	});

	// 10. renderAdl — empty shows placeholder
	it('renderAdl shows placeholder when no ADL document exists', () => {
		const { workflowId, workflowKebab, renderer } = setup();

		const output = renderer.renderAdl(workflowId);

		expect(output).toContain(`# ADL: ${workflowKebab} — Architectural Decision Log`);
		expect(output).toContain('_No decisions recorded yet._');
		expect(output.endsWith('\n')).toBe(true);
	});

	// 11. renderAll — returns object with all 5 keys matching individual renders
	it('renderAll returns 5-key object matching individual render outputs', () => {
		const { workflowId, documents, mustHaves } = setup();
		documents.writeRequirements(workflowId, '# Vision');
		documents.writeSpec(workflowId, '# Spec');
		documents.writeBlueprint(workflowId, '# Blueprint');
		documents.writeChronicle(workflowId, '# Chronicle');
		documents.writeAdl(workflowId, '# ADL');

		mustHaves.create({
			workflowId,
			mhId: 'MH1',
			title: 'Test',
			description: 'Test must-have.',
			ordinal: 1,
		});

		const renderer = new SpecRenderer(documents.database);
		const all = renderer.renderAll(workflowId);

		expect(Object.keys(all).sort()).toEqual(['ADL', 'BLUEPRINT', 'CHRONICLE', 'REQUIREMENTS', 'SPEC']);

		expect(all.REQUIREMENTS).toBe(renderer.renderRequirements(workflowId));
		expect(all.SPEC).toBe(renderer.renderSpec(workflowId));
		expect(all.BLUEPRINT).toBe(renderer.renderBlueprint(workflowId));
		expect(all.CHRONICLE).toBe(renderer.renderChronicle(workflowId));
		expect(all.ADL).toBe(renderer.renderAdl(workflowId));
	});

	// 12. Missing workflow — throws RowNotFoundError
	it('throws RowNotFoundError when workflow does not exist', () => {
		const database = new Database(join(mkdtempSync(join(tmpdir(), 'elefant-render-missing-')), 'db.sqlite'));
		databases.push(database);

		const projectId = crypto.randomUUID();
		database.db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [projectId, 'test', '/tmp/test']);

		const renderer = new SpecRenderer(database);
		const fakeId = crypto.randomUUID();

		expect(() => renderer.renderRequirements(fakeId)).toThrow(RowNotFoundError);
		expect(() => renderer.renderSpec(fakeId)).toThrow(RowNotFoundError);
		expect(() => renderer.renderBlueprint(fakeId)).toThrow(RowNotFoundError);
		expect(() => renderer.renderChronicle(fakeId)).toThrow(RowNotFoundError);
		expect(() => renderer.renderAdl(fakeId)).toThrow(RowNotFoundError);
	});

	// 13. Stable sort — insert must-haves out-of-order, verify rendered order
	it('renders must-haves in ordinal order regardless of insertion order', () => {
		const { workflowId, mustHaves } = setup();

		// Insert out of ordinal order
		mustHaves.create({
			workflowId,
			mhId: 'MH3',
			title: 'Third',
			description: 'Third item.',
			ordinal: 3,
		});
		mustHaves.create({
			workflowId,
			mhId: 'MH1',
			title: 'First',
			description: 'First item.',
			ordinal: 1,
		});
		mustHaves.create({
			workflowId,
			mhId: 'MH2',
			title: 'Second',
			description: 'Second item.',
			ordinal: 2,
		});

		const renderer = new SpecRenderer(mustHaves.database);

		const requirementsOutput = renderer.renderRequirements(workflowId);
		const mh1Pos = requirementsOutput.indexOf('**MH1**');
		const mh2Pos = requirementsOutput.indexOf('**MH2**');
		const mh3Pos = requirementsOutput.indexOf('**MH3**');

		expect(mh1Pos).toBeGreaterThan(0);
		expect(mh2Pos).toBeGreaterThan(0);
		expect(mh3Pos).toBeGreaterThan(0);
		expect(mh1Pos).toBeLessThan(mh2Pos);
		expect(mh2Pos).toBeLessThan(mh3Pos);

		// Also verify SPEC output
		const specOutput = renderer.renderSpec(workflowId);
		const specMh1Pos = specOutput.indexOf('### MH1');
		const specMh2Pos = specOutput.indexOf('### MH2');
		const specMh3Pos = specOutput.indexOf('### MH3');
		expect(specMh1Pos).toBeLessThan(specMh2Pos);
		expect(specMh2Pos).toBeLessThan(specMh3Pos);
	});

	// 14. verify trailing newline on all document types
	it('all render methods produce output ending with a single trailing newline', () => {
		const { workflowId, documents } = setup();
		documents.writeRequirements(workflowId, '# Vision');
		documents.writeSpec(workflowId, '# Spec');
		documents.writeBlueprint(workflowId, '# BP');
		documents.writeChronicle(workflowId, '# CH');
		documents.writeAdl(workflowId, '# ADL');

		const renderer = new SpecRenderer(documents.database);

		const outputs = [
			renderer.renderRequirements(workflowId),
			renderer.renderSpec(workflowId),
			renderer.renderBlueprint(workflowId),
			renderer.renderChronicle(workflowId),
			renderer.renderAdl(workflowId),
		];

		for (const output of outputs) {
			expect(output.endsWith('\n')).toBe(true);
			// Should not have double trailing newline
			expect(output.endsWith('\n\n')).toBe(false);
		}
	});
});
