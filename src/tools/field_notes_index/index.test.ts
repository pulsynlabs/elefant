/**
 * Tests for research_index tool.
 */

import { describe, it, expect } from 'bun:test';
import {
	createResearchIndexTool,
	type ResearchIndexParams,
	type ResearchIndexStore,
	type TreeOutput,
	type FlatOutput,
} from './index.js';
import type { DocumentRow } from '../../research/store.js';
import type { ElefantError } from '../../types/errors.js';
import { ok } from '../../types/result.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function treeData(json: string): TreeOutput {
	return JSON.parse(json) as TreeOutput;
}

function flatData(json: string): FlatOutput {
	return JSON.parse(json) as FlatOutput;
}

/** Narrow a Result to its data value, throwing if not ok. */
function unwrapOk<T>(
	result: { ok: true; data: T } | { ok: false; error: ElefantError },
): T {
	if (!result.ok) {
		throw new Error(`Expected ok result but got: ${result.error.message}`);
	}
	return result.data;
}

/** Assert a result is an error and return the error. */
function assertError<T>(
	result: { ok: true; data: T } | { ok: false; error: ElefantError },
): ElefantError {
	if (result.ok) throw new Error('Expected error but got success');
	return (result as { ok: false; error: ElefantError }).error;
}

/** Create a minimal DocumentRow for tests. */
function makeDoc(overrides: Partial<DocumentRow> = {}): DocumentRow {
	return {
		id: 'doc-1',
		filePath: '02-tech/vector-db.md',
		section: '02-tech',
		title: 'Vector Databases',
		summary: 'A survey of vector databases.',
		confidence: 'high',
		tags: ['embeddings', 'database'],
		sources: ['https://example.com'],
		authorAgent: 'researcher',
		workflow: 'research-base',
		created: '2026-01-01T00:00:00.000Z',
		updated: '2026-05-01T00:00:00.000Z',
		frontmatter: {} as DocumentRow['frontmatter'],
		bodyHash: 'abc123',
		...overrides,
	};
}

/** Create a mock store that returns the given docs from listDocuments. */
function mockStore(
	docs: DocumentRow[],
): ResearchIndexStore {
	return {
		listDocuments: (_opts?: { section?: string }) => ok(docs),
	};
}

/** Create a mock store that looks at the opts.section filter. */
function mockStoreWithSection(
	allDocs: DocumentRow[],
): ResearchIndexStore {
	return {
		listDocuments: (opts?: { section?: string }) => {
			if (opts?.section) {
				return ok(
					allDocs.filter((d) => d.section === opts.section),
				);
			}
			return ok(allDocs);
		},
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('research_index tool', () => {
	// ── tree output ───────────────────────────────────────────────────────

	describe('tree output', () => {
		it('groups 3 docs across 2 sections with correct counts', async () => {
			const docs = [
				makeDoc({
					id: 'doc-1',
					section: '02-tech',
					title: 'Vector DBs',
					filePath: '02-tech/vector-dbs.md',
					updated: '2026-05-01T00:00:00.000Z',
				}),
				makeDoc({
					id: 'doc-2',
					section: '02-tech',
					title: 'Embeddings 101',
					filePath: '02-tech/embeddings-101.md',
					updated: '2026-04-15T00:00:00.000Z',
				}),
				makeDoc({
					id: 'doc-3',
					section: '03-decisions',
					title: 'ADR: sqlite-vec',
					filePath: '03-decisions/sqlite-vec.md',
					updated: '2026-03-01T00:00:00.000Z',
				}),
			];

			const tool = createResearchIndexTool(mockStore(docs));
			const result = await tool.execute({
				output: 'tree',
			} as ResearchIndexParams);

			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error('unreachable');

			const data = treeData(result.data);
			expect(data.output).toBe('tree');
			expect(data.sections).toHaveLength(2);
			expect(data.total).toBe(3);

			// Section ordering follows RESEARCH_SECTIONS
			const section2 = data.sections[0]!;
			expect(section2.section).toBe('02-tech');
			expect(section2.label).toBe('Technologies');
			expect(section2.count).toBe(2);
			expect(section2.files).toHaveLength(2);
			expect(section2.files[0]!.title).toBe('Vector DBs');
			expect(section2.files[1]!.title).toBe('Embeddings 101');

			const section3 = data.sections[1]!;
			expect(section3.section).toBe('03-decisions');
			expect(section3.label).toBe('Decisions');
			expect(section3.count).toBe(1);
			expect(section3.files[0]!.title).toBe('ADR: sqlite-vec');
		});

		it('excludes empty sections', async () => {
			const docs = [
				makeDoc({ id: 'd1', section: '02-tech', filePath: '02-tech/a.md' }),
			];

			const tool = createResearchIndexTool(mockStore(docs));
			const result = await tool.execute({
				output: 'tree',
			} as ResearchIndexParams);

			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error('unreachable');
			const data = treeData(result.data);
			expect(data.sections).toHaveLength(1);
		});

		it('includes research_link on each file', async () => {
			const doc = makeDoc({
				id: 'd1',
				filePath: '02-tech/vector-dbs.md',
				workflow: 'research-base',
			});

			const tool = createResearchIndexTool(mockStore([doc]));
			const result = await tool.execute({
				output: 'tree',
			} as ResearchIndexParams);

			expect(result.ok).toBe(true);
			const data = treeData(unwrapOk(result));
			expect(data.sections[0]!.files[0]!.research_link).toBe(
				'research://research-base/02-tech/vector-dbs.md',
			);
		});

		it('uses "_" workflow placeholder when doc.workflow is null', async () => {
			const doc = makeDoc({
				id: 'd1',
				filePath: '02-tech/foo.md',
				workflow: null,
			});

			const tool = createResearchIndexTool(mockStore([doc]));
			const result = await tool.execute({
				output: 'tree',
			} as ResearchIndexParams);

			expect(result.ok).toBe(true);
			const data = treeData(unwrapOk(result));
			expect(data.sections[0]!.files[0]!.research_link).toBe(
				'research://_/02-tech/foo.md',
			);
		});
	});

	// ── flat output ───────────────────────────────────────────────────────

	describe('flat output', () => {
		it('returns files sorted by updated descending', async () => {
			const docs = [
				makeDoc({
					id: 'oldest',
					title: 'Oldest',
					filePath: '02-tech/oldest.md',
					updated: '2026-01-01T00:00:00.000Z',
				}),
				makeDoc({
					id: 'middle',
					title: 'Middle',
					filePath: '02-tech/middle.md',
					updated: '2026-03-15T00:00:00.000Z',
				}),
				makeDoc({
					id: 'newest',
					title: 'Newest',
					filePath: '02-tech/newest.md',
					updated: '2026-05-01T00:00:00.000Z',
				}),
			];

			const tool = createResearchIndexTool(mockStore(docs));
			const result = await tool.execute({
				output: 'flat',
			} as ResearchIndexParams);

			expect(result.ok).toBe(true);
			const data = flatData(unwrapOk(result));
			expect(data.output).toBe('flat');
			expect(data.files).toHaveLength(3);
			expect(data.total).toBe(3);
			expect(data.files[0]!.title).toBe('Newest');
			expect(data.files[1]!.title).toBe('Middle');
			expect(data.files[2]!.title).toBe('Oldest');
		});

		it('includes section and research_link on each file', async () => {
			const doc = makeDoc({
				id: 'd1',
				section: '02-tech',
				filePath: '02-tech/foo.md',
				workflow: 'wf',
			});

			const tool = createResearchIndexTool(mockStore([doc]));
			const result = await tool.execute({
				output: 'flat',
			} as ResearchIndexParams);

			expect(result.ok).toBe(true);
			const data = flatData(unwrapOk(result));
			expect(data.files[0]!.section).toBe('02-tech');
			expect(data.files[0]!.research_link).toBe(
				'research://wf/02-tech/foo.md',
			);
		});
	});

	// ── section filter ────────────────────────────────────────────────────

	describe('section filter', () => {
		it('returns only docs from the requested section', async () => {
			const docs = [
				makeDoc({
					id: 'd1',
					section: '02-tech',
					title: 'Tech doc',
					filePath: '02-tech/tech.md',
				}),
				makeDoc({
					id: 'd2',
					section: '03-decisions',
					title: 'Decision doc',
					filePath: '03-decisions/decision.md',
				}),
			];

			const tool = createResearchIndexTool(
				mockStoreWithSection(docs),
			);
			const result = await tool.execute({
				output: 'flat',
				section: '02-tech',
			} as ResearchIndexParams);

			expect(result.ok).toBe(true);
			const data = flatData(unwrapOk(result));
			expect(data.files).toHaveLength(1);
			expect(data.files[0]!.title).toBe('Tech doc');
		});

		it('returns empty result for invalid section name', async () => {
			const tool = createResearchIndexTool(mockStore([]));
			const result = await tool.execute({
				output: 'tree',
				section: 'nonexistent',
			} as ResearchIndexParams);

			expect(result.ok).toBe(true);
			const data = treeData(unwrapOk(result));
			expect(data.sections).toEqual([]);
			expect(data.total).toBe(0);
		});

		it('returns empty flat result for invalid section name', async () => {
			const tool = createResearchIndexTool(mockStore([]));
			const result = await tool.execute({
				output: 'flat',
				section: 'nonexistent',
			} as ResearchIndexParams);

			expect(result.ok).toBe(true);
			const data = flatData(unwrapOk(result));
			expect(data.files).toEqual([]);
			expect(data.total).toBe(0);
		});
	});

	// ── tag filter ────────────────────────────────────────────────────────

	describe('tag filter', () => {
		it('returns only docs with the exact tag', async () => {
			const docs = [
				makeDoc({
					id: 'd1',
					title: 'With embeddings',
					filePath: '02-tech/with.md',
					tags: ['embeddings', 'database'],
				}),
				makeDoc({
					id: 'd2',
					title: 'Also embeddings',
					filePath: '02-tech/also.md',
					tags: ['embeddings', 'models'],
				}),
				makeDoc({
					id: 'd3',
					title: 'No embeddings',
					filePath: '02-tech/without.md',
					tags: ['chunking', 'performance'],
				}),
			];

			const tool = createResearchIndexTool(mockStore(docs));
			const result = await tool.execute({
				output: 'flat',
				tag: 'embeddings',
			} as ResearchIndexParams);

			expect(result.ok).toBe(true);
			const data = flatData(unwrapOk(result));
			expect(data.files).toHaveLength(2);
			expect(data.files[0]!.title).toBe('With embeddings');
			expect(data.files[1]!.title).toBe('Also embeddings');
		});

		it('returns empty when no docs match tag', async () => {
			const docs = [
				makeDoc({ id: 'd1', tags: ['other'], filePath: '02-tech/a.md' }),
			];

			const tool = createResearchIndexTool(mockStore(docs));
			const result = await tool.execute({
				output: 'flat',
				tag: 'embeddings',
			} as ResearchIndexParams);

			expect(result.ok).toBe(true);
			const data = flatData(unwrapOk(result));
			expect(data.files).toHaveLength(0);
		});
	});

	// ── recencyDays filter ────────────────────────────────────────────────

	describe('recencyDays filter', () => {
		it('excludes docs older than N days', async () => {
			// Use absolute ISO dates to avoid test flakiness
			const now = new Date();
			const dayMs = 86_400_000;

			const recent = new Date(now.getTime() - 1 * dayMs).toISOString();
			const old = new Date(now.getTime() - 20 * dayMs).toISOString();

			const docs = [
				makeDoc({
					id: 'd1',
					title: 'Recent',
					filePath: '02-tech/recent.md',
					updated: recent,
				}),
				makeDoc({
					id: 'd2',
					title: 'Old',
					filePath: '02-tech/old.md',
					updated: old,
				}),
			];

			const tool = createResearchIndexTool(mockStore(docs));
			const result = await tool.execute({
				output: 'flat',
				recencyDays: 7,
			} as ResearchIndexParams);

			expect(result.ok).toBe(true);
			const data = flatData(unwrapOk(result));
			expect(data.files).toHaveLength(1);
			expect(data.files[0]!.title).toBe('Recent');
		});

		it('keeps doc exactly at the boundary', async () => {
			const now = new Date();
			const dayMs = 86_400_000;
			const exact = new Date(now.getTime() - 5 * dayMs).toISOString();

			const docs = [
				makeDoc({
					id: 'd1',
					title: 'Boundary',
					filePath: '02-tech/boundary.md',
					updated: exact,
				}),
			];

			const tool = createResearchIndexTool(mockStore(docs));
			const result = await tool.execute({
				output: 'flat',
				recencyDays: 5,
			} as ResearchIndexParams);

			expect(result.ok).toBe(true);
			const data = flatData(unwrapOk(result));
			expect(data.files).toHaveLength(1);
		});
	});

	// ── limit ─────────────────────────────────────────────────────────────

	describe('limit', () => {
		it('returns at most limit docs', async () => {
			const docs = Array.from({ length: 10 }, (_, i) =>
				makeDoc({
					id: `doc-${i}`,
					title: `Doc ${i}`,
					filePath: `02-tech/doc-${i}.md`,
					updated: new Date(
						Date.now() - i * 86_400_000,
					).toISOString(),
				}),
			);

			const tool = createResearchIndexTool(mockStore(docs));
			const result = await tool.execute({
				output: 'flat',
				limit: 3,
			} as ResearchIndexParams);

			expect(result.ok).toBe(true);
			const data = flatData(unwrapOk(result));
			expect(data.files).toHaveLength(3);
			expect(data.total).toBe(3);
		});

		it('tree output respects limit across sections', async () => {
			const docs = [
				makeDoc({
					id: 'd1',
					section: '02-tech',
					title: 'Tech 1',
					filePath: '02-tech/t1.md',
					updated: '2026-05-03T00:00:00.000Z',
				}),
				makeDoc({
					id: 'd2',
					section: '02-tech',
					title: 'Tech 2',
					filePath: '02-tech/t2.md',
					updated: '2026-05-02T00:00:00.000Z',
				}),
				makeDoc({
					id: 'd3',
					section: '03-decisions',
					title: 'Dec 1',
					filePath: '03-decisions/d1.md',
					updated: '2026-05-01T00:00:00.000Z',
				}),
				makeDoc({
					id: 'd4',
					section: '03-decisions',
					title: 'Dec 2',
					filePath: '03-decisions/d2.md',
					updated: '2026-04-30T00:00:00.000Z',
				}),
			];

			const tool = createResearchIndexTool(mockStore(docs));
			const result = await tool.execute({
				output: 'tree',
				limit: 3,
			} as ResearchIndexParams);

			expect(result.ok).toBe(true);
			const data = treeData(unwrapOk(result));
			expect(data.total).toBe(3);

			// Section 02-tech should have 2 files (both within limit)
			const tech = data.sections.find(
				(s) => s.section === '02-tech',
			)!;
			expect(tech).toBeDefined();
			expect(tech.count).toBe(2);

			// Section 03-decisions should have 1 file (only 1 fits within limit of 3 total)
			const dec = data.sections.find(
				(s) => s.section === '03-decisions',
			)!;
			expect(dec).toBeDefined();
			expect(dec.count).toBe(1);
		});
	});

	// ── empty corpus ──────────────────────────────────────────────────────

	describe('empty corpus', () => {
		it('tree output: no sections', async () => {
			const tool = createResearchIndexTool(mockStore([]));
			const result = await tool.execute({
				output: 'tree',
			} as ResearchIndexParams);

			expect(result.ok).toBe(true);
			const data = treeData(unwrapOk(result));
			expect(data.sections).toEqual([]);
			expect(data.total).toBe(0);
		});

		it('flat output: empty files array', async () => {
			const tool = createResearchIndexTool(mockStore([]));
			const result = await tool.execute({
				output: 'flat',
			} as ResearchIndexParams);

			expect(result.ok).toBe(true);
			const data = flatData(unwrapOk(result));
			expect(data.files).toEqual([]);
			expect(data.total).toBe(0);
		});
	});

	// ── invalid params ────────────────────────────────────────────────────

	describe('invalid parameters', () => {
		it('rejects invalid output value', async () => {
			const tool = createResearchIndexTool(mockStore([]));
			const result = await tool.execute({
				output: 'invalid' as 'tree',
			} as ResearchIndexParams);

			expect(result.ok).toBe(false);
			const error = assertError(result);
			expect(error.code).toBe('VALIDATION_ERROR');
			expect(error.message).toContain('Invalid output format');
		});
	});

	// ── combined filters ──────────────────────────────────────────────────

	describe('combined filters', () => {
		it('applies tag + recency together', async () => {
			const now = new Date();
			const dayMs = 86_400_000;

			const docs = [
				makeDoc({
					id: 'd1',
					title: 'Recent + embeddings',
					filePath: '02-tech/r-e.md',
					tags: ['embeddings'],
					updated: new Date(now.getTime() - 1 * dayMs).toISOString(),
				}),
				makeDoc({
					id: 'd2',
					title: 'Recent + no tag',
					filePath: '02-tech/r-nt.md',
					tags: ['other'],
					updated: new Date(now.getTime() - 1 * dayMs).toISOString(),
				}),
				makeDoc({
					id: 'd3',
					title: 'Old + embeddings',
					filePath: '02-tech/o-e.md',
					tags: ['embeddings'],
					updated: new Date(
						now.getTime() - 20 * dayMs,
					).toISOString(),
				}),
			];

			const tool = createResearchIndexTool(mockStore(docs));
			const result = await tool.execute({
				output: 'flat',
				tag: 'embeddings',
				recencyDays: 7,
			} as ResearchIndexParams);

			expect(result.ok).toBe(true);
			const data = flatData(unwrapOk(result));
			expect(data.files).toHaveLength(1);
			expect(data.files[0]!.title).toBe('Recent + embeddings');
		});

		it('applies section + tag together', async () => {
			const docs = [
				makeDoc({
					id: 'd1',
					section: '02-tech',
					title: 'Tech + tag',
					filePath: '02-tech/tt.md',
					tags: ['embeddings'],
				}),
				makeDoc({
					id: 'd2',
					section: '03-decisions',
					title: 'Dec + tag',
					filePath: '03-decisions/dt.md',
					tags: ['embeddings'],
				}),
			];

			const tool = createResearchIndexTool(
				mockStoreWithSection(docs),
			);
			const result = await tool.execute({
				output: 'flat',
				section: '02-tech',
				tag: 'embeddings',
			} as ResearchIndexParams);

			expect(result.ok).toBe(true);
			const data = flatData(unwrapOk(result));
			expect(data.files).toHaveLength(1);
			expect(data.files[0]!.title).toBe('Tech + tag');
		});

		// ── section + tag + recency combined ─────────────────────────────

		it('applies section + tag + recency together (line 176-177)', async () => {
			const now = new Date();
			const dayMs = 86_400_000;

			const docs = [
				makeDoc({
					id: 'd1',
					section: '02-tech',
					title: 'Tech + tag + recent',
					filePath: '02-tech/tt-recent.md',
					tags: ['embeddings'],
					updated: new Date(now.getTime() - 1 * dayMs).toISOString(),
				}),
				makeDoc({
					id: 'd2',
					section: '02-tech',
					title: 'Tech + tag + old',
					filePath: '02-tech/tt-old.md',
					tags: ['embeddings'],
					updated: new Date(now.getTime() - 20 * dayMs).toISOString(),
				}),
				makeDoc({
					id: 'd3',
					section: '02-tech',
					title: 'Tech + other tag + recent',
					filePath: '02-tech/other-recent.md',
					tags: ['other'],
					updated: new Date(now.getTime() - 1 * dayMs).toISOString(),
				}),
			];

			const tool = createResearchIndexTool(
				mockStoreWithSection(docs),
			);
			const result = await tool.execute({
				output: 'flat',
				section: '02-tech',
				tag: 'embeddings',
				recencyDays: 7,
			} as ResearchIndexParams);

			expect(result.ok).toBe(true);
			const data = flatData(unwrapOk(result));
			expect(data.files).toHaveLength(1);
			expect(data.files[0]!.title).toBe('Tech + tag + recent');
		});
	});

	// ── store error propagation ───────────────────────────────────────────

	describe('store error propagation', () => {
		it('returns error when store.listDocuments fails', async () => {
			const store: ResearchIndexStore = {
				listDocuments: () => ({
					ok: false,
					error: {
						code: 'TOOL_EXECUTION_FAILED',
						message: 'Database is locked',
					},
				}),
			};

			const tool = createResearchIndexTool(store);
			const result = await tool.execute({} as ResearchIndexParams);

			expect(result.ok).toBe(false);
			const error = assertError(result);
			expect(error.code).toBe('TOOL_EXECUTION_FAILED');
			expect(error.message).toBe('Database is locked');
		});
	});
});
