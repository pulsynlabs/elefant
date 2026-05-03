/**
 * research_index — list/browse the Research Base by section, tag, or recency.
 *
 * Supports two output formats:
 *   - `tree` — grouped by section, ordered by RESEARCH_SECTIONS
 *   - `flat` — sorted by last-updated descending
 *
 * Filters (section, tag, recencyDays) are applied in that order, with `limit`
 * applied last to the final result set.
 */

import type { ToolDefinition } from '../../types/tools.js';
import type { ElefantError } from '../../types/errors.js';
import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';
import type { DocumentRow } from '../../research/store.js';
import { RESEARCH_SECTIONS } from '../../project/paths.js';
import { serializeResearchLink } from '../../research/link.js';

// ─── Parameters ─────────────────────────────────────────────────────────────

export interface ResearchIndexParams {
	output?: 'tree' | 'flat';
	section?: string;
	tag?: string;
	recencyDays?: number;
	limit?: number;
}

// ─── Output types ───────────────────────────────────────────────────────────

export interface TreeFile {
	id: string;
	title: string;
	summary: string;
	tags: string[];
	confidence: 'high' | 'medium' | 'low';
	updated: string;
	research_link: string;
}

export interface TreeSection {
	section: string;
	label: string;
	count: number;
	files: TreeFile[];
}

export interface TreeOutput {
	output: 'tree';
	sections: TreeSection[];
	total: number;
}

export interface FlatFile {
	id: string;
	section: string;
	title: string;
	summary: string;
	tags: string[];
	confidence: string;
	updated: string;
	research_link: string;
}

export interface FlatOutput {
	output: 'flat';
	files: FlatFile[];
	total: number;
}

export type ResearchIndexOutput = TreeOutput | FlatOutput;

// ─── Store dependency interface (narrow — only what this tool needs) ────────

export interface ResearchIndexStore {
	listDocuments(opts?: { section?: string }): Result<DocumentRow[], ElefantError>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SECTION_LABELS: Record<string, string> = {
	'00-index': 'Indexes',
	'01-domain': 'Domain Knowledge',
	'02-tech': 'Technologies',
	'03-decisions': 'Decisions',
	'04-comparisons': 'Comparisons',
	'05-references': 'References',
	'06-synthesis': 'Synthesis',
	'99-scratch': 'Scratch',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildResearchLink(doc: DocumentRow): string {
	const workflow = doc.workflow ?? '_';
	return serializeResearchLink({
		kind: 'research-uri',
		workflow,
		path: doc.filePath,
		anchor: null,
	});
}

function mapToTreeFile(doc: DocumentRow): TreeFile {
	return {
		id: doc.id,
		title: doc.title,
		summary: doc.summary,
		tags: doc.tags,
		confidence: doc.confidence,
		updated: doc.updated,
		research_link: buildResearchLink(doc),
	};
}

function mapToFlatFile(doc: DocumentRow): FlatFile {
	return {
		id: doc.id,
		section: doc.section,
		title: doc.title,
		summary: doc.summary,
		tags: doc.tags,
		confidence: doc.confidence,
		updated: doc.updated,
		research_link: buildResearchLink(doc),
	};
}

function filterByTag(docs: DocumentRow[], tag: string): DocumentRow[] {
	return docs.filter((doc) => doc.tags.includes(tag));
}

function filterByRecency(
	docs: DocumentRow[],
	recencyDays: number,
): DocumentRow[] {
	const cutoff = Date.now() - recencyDays * 86_400_000;
	return docs.filter((doc) => new Date(doc.updated).getTime() >= cutoff);
}

// ─── Output builders ────────────────────────────────────────────────────────

function buildTree(docs: DocumentRow[], limit: number): TreeOutput {
	// Collect section docs preserving RESEARCH_SECTIONS order
	const sectionMap = new Map<string, DocumentRow[]>();
	for (const section of RESEARCH_SECTIONS) {
		sectionMap.set(section, []);
	}
	for (const doc of docs) {
		const bucket = sectionMap.get(doc.section);
		if (bucket) bucket.push(doc);
	}

	const sections: TreeSection[] = [];
	for (const section of RESEARCH_SECTIONS) {
		const sectionDocs = sectionMap.get(section)!;
		if (sectionDocs.length === 0) continue;

		// Within each section, sort by updated descending
		sectionDocs.sort((a, b) => b.updated.localeCompare(a.updated));

		const files = sectionDocs.map(mapToTreeFile);
		sections.push({
			section,
			label: SECTION_LABELS[section] ?? section,
			count: files.length,
			files,
		});
	}

	// Apply limit across all sections (count toward total)
	let remaining = limit;
	for (const sec of sections) {
		if (remaining <= 0) {
			sec.files = [];
			sec.count = 0;
		} else if (sec.files.length > remaining) {
			sec.files = sec.files.slice(0, remaining);
			sec.count = sec.files.length;
			remaining = 0;
		} else {
			remaining -= sec.files.length;
		}
	}

	// Drop empty sections after limiting
	const nonEmpty = sections.filter((s) => s.count > 0);
	const total = nonEmpty.reduce((sum, s) => sum + s.count, 0);

	return { output: 'tree', sections: nonEmpty, total };
}

function buildFlat(docs: DocumentRow[], limit: number): FlatOutput {
	const sorted = [...docs].sort((a, b) =>
		b.updated.localeCompare(a.updated),
	);
	const sliced = sorted.slice(0, limit);
	return {
		output: 'flat',
		files: sliced.map(mapToFlatFile),
		total: sliced.length,
	};
}

// ─── Tool factory ───────────────────────────────────────────────────────────

export function createResearchIndexTool(
	store: ResearchIndexStore,
): ToolDefinition<ResearchIndexParams, string> {
	return {
		name: 'research_index',
		description:
			'List and browse the Research Base by section, tag, or recency. ' +
			'Supports tree (grouped by section) and flat (sorted by last updated) output formats.',
		parameters: {
			output: {
				type: 'string',
				description:
					'Output format: "tree" (grouped by section) or "flat" (sorted list). Default: "tree".',
				required: false,
				default: 'tree',
			},
			section: {
				type: 'string',
				description:
					'Filter to a single section (e.g. "02-tech"). Invalid section names return empty results.',
				required: false,
			},
			tag: {
				type: 'string',
				description:
					'Exact tag match. Only return documents whose tags include this value.',
				required: false,
			},
			recencyDays: {
				type: 'number',
				description:
					'Only return documents updated within the last N days.',
				required: false,
			},
			limit: {
				type: 'number',
				description: 'Maximum number of documents to return. Default: 50.',
				required: false,
				default: 50,
			},
		},
		execute: async (
			params,
		): Promise<Result<string, ElefantError>> => {
			const {
				output = 'tree',
				section,
				tag,
				recencyDays,
				limit = 50,
			} = params;

			// Validate output enum (registry validates type, we validate values)
			if (output !== 'tree' && output !== 'flat') {
				return err({
					code: 'VALIDATION_ERROR',
					message: `Invalid output format: "${output}". Must be "tree" or "flat".`,
				});
			}

			// Validate section if provided — unknown sections return empty result
			if (
				section !== undefined &&
				section !== '' &&
				!RESEARCH_SECTIONS.includes(section)
			) {
				if (output === 'tree') {
					return ok(
						JSON.stringify({ output: 'tree', sections: [], total: 0 }),
					);
				}
				return ok(
					JSON.stringify({ output: 'flat', files: [], total: 0 }),
				);
			}

			// Fetch from store with section filter (no limit — we apply limit
			// after tag/recency post-filters so the limit operates on the
			// fully-filtered result set, not the raw DB query).
			const fetchSection =
				section && section !== '' ? section : undefined;
			const result = store.listDocuments({ section: fetchSection });
			if (!result.ok) {
				return err(result.error);
			}

			let docs = result.data;

			// Post-query tag filter (exact match)
			if (tag !== undefined && tag !== '') {
				docs = filterByTag(docs, tag);
			}

			// Post-query recency filter
			if (recencyDays !== undefined && recencyDays > 0) {
				docs = filterByRecency(docs, recencyDays);
			}

			// Build output and apply limit
			if (output === 'tree') {
				return ok(JSON.stringify(buildTree(docs, limit)));
			}

			return ok(JSON.stringify(buildFlat(docs, limit)));
		},
	};
}
