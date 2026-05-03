/**
 * Reference catalog — builds and caches a structured index of all available
 * references, organized by tag and audience, for system prompt injection.
 */

import type { ListReferencesOptions, ReferenceInfo } from '../tools/reference/resolver.js';
import { listReferences } from '../tools/reference/resolver.js';

export interface ReferenceCatalog {
	all: ReferenceInfo[];
	byTag: Map<string, string[]>;
	byAudience: Map<string, string[]>;
}

let catalogCache: ReferenceCatalog | null = null;
let cacheKey: string | null = null;

function buildCacheKey(opts: ListReferencesOptions): string {
	return `${opts.cwd ?? process.cwd()}|${opts.home ?? ''}`;
}

/** Build and cache the reference catalog from all tiers. */
export async function buildReferenceCatalog(
	opts: ListReferencesOptions = {},
): Promise<ReferenceCatalog> {
	const key = buildCacheKey(opts);
	if (catalogCache && cacheKey === key) return catalogCache;

	const all = await listReferences(opts);
	const byTag = new Map<string, string[]>();
	const byAudience = new Map<string, string[]>();

	for (const ref of all) {
		const fm = ref.frontmatter;
		if (!fm) continue;

		for (const tag of fm.tags) {
			const existing = byTag.get(tag) ?? [];
			existing.push(ref.name);
			byTag.set(tag, existing);
		}

		for (const audience of fm.audience) {
			const existing = byAudience.get(audience) ?? [];
			existing.push(ref.name);
			byAudience.set(audience, existing);
		}
	}

	catalogCache = { all, byTag, byAudience };
	cacheKey = key;
	return catalogCache;
}

/** Invalidate the cache (e.g. in tests or after references are added). */
export function invalidateReferenceCatalog(): void {
	catalogCache = null;
	cacheKey = null;
}

/**
 * Map agent kind string to audience key for reference auto-loading.
 * Returns null for unknown kinds.
 */
export function agentKindToAudience(agentKind: string): string | null {
	const map: Record<string, string> = {
		orchestrator: 'orchestrator',
		researcher: 'researcher',
		planner: 'planner',
		writer: 'writer',
		librarian: 'writer',
		tester: 'executor',
		verifier: 'executor',
		explorer: 'executor',
		debugger: 'executor',
		executor: 'executor',
		default: 'executor',
		'executor-low': 'executor',
		'executor-medium': 'executor',
		'executor-high': 'executor',
		'executor-frontend': 'executor',
		'goop-researcher': 'researcher',
		'goop-planner': 'planner',
		'goop-writer': 'writer',
		'goop-librarian': 'writer',
		'goop-tester': 'executor',
		'goop-verifier': 'executor',
		'goop-explorer': 'executor',
		'goop-debugger': 'executor',
		'goop-executor-low': 'executor',
		'goop-executor-medium': 'executor',
		'goop-executor-high': 'executor',
		'goop-executor-frontend': 'executor',
		'goop-orchestrator': 'orchestrator',
		general: 'executor',
	};

	return map[agentKind] ?? null;
}

/**
 * Format the tag index as a compact markdown section for injection into the
 * orchestrator system prompt. Capped at `maxChars` characters.
 */
export function formatTagIndex(
	catalog: ReferenceCatalog,
	opts: { maxChars?: number } = {},
): string {
	const maxChars = opts.maxChars ?? 1500;
	const header = '## Available References (Tag Index)\n';
	const footer =
		'\n_Use `reference({ name: "X" })` to load, `reference({ list: true })` to browse, `reference({ list: true, tag: "T" })` to filter._';

	if (catalog.byTag.size === 0) return '';

	const lines = [...catalog.byTag.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([tag, refs]) => `- **${tag}**: ${[...refs].sort().join(', ')}`);

	const full = header + lines.join('\n') + footer;
	if (full.length <= maxChars) return full;

	let truncated = header;
	for (const line of lines) {
		if ((truncated + line + '\n').length > maxChars - footer.length - 20) {
			truncated += `_... [${catalog.byTag.size} total tags]_`;
			break;
		}
		truncated += line + '\n';
	}

	return truncated + footer;
}

/**
 * Load all references for a given audience key.
 * Returns concatenated content with separators, capped at `maxChars`.
 * When over cap, drops refs from the end and appends a footer.
 */
export async function loadForAudience(
	catalog: ReferenceCatalog,
	audience: string,
	opts: { maxChars?: number; cwd?: string; home?: string } = {},
): Promise<string> {
	const maxChars = opts.maxChars ?? 6000;
	const names = new Set<string>();

	for (const name of catalog.byAudience.get(audience) ?? []) names.add(name);
	for (const name of catalog.byAudience.get('all') ?? []) names.add(name);

	const sortedNames = [...names].sort();
	if (sortedNames.length === 0) return '';

	const { resolveReference } = await import('../tools/reference/resolver.js');
	const { formatReferenceBlock, REFERENCE_SEPARATOR } = await import(
		'../tools/reference/format.js'
	);

	const header = `## Loaded References (audience: ${audience})\n\n`;
	const parts: Array<{ name: string; block: string }> = [];
	const omitted: string[] = [];

	for (const name of sortedNames) {
		const result = await resolveReference(name, { cwd: opts.cwd, home: opts.home });
		if (!result) continue;

		const block = formatReferenceBlock(name, result.source, result.content);
		const candidateParts = [...parts.map((part) => part.block), block];
		const candidate = header + candidateParts.join(REFERENCE_SEPARATOR);

		if (candidate.length > maxChars && parts.length > 0) {
			omitted.push(name);
			continue;
		}

		if (candidate.length > maxChars) {
			omitted.push(name);
			continue;
		}

		parts.push({ name, block });
	}

	if (parts.length === 0) return '';

	let output = header + parts.map((part) => part.block).join(REFERENCE_SEPARATOR);
	while (omitted.length > 0) {
		const footer = truncationFooter(omitted);
		if (output.length + footer.length <= maxChars) {
			output += footer;
			break;
		}

		const dropped = parts.pop();
		if (!dropped) return '';
		omitted.unshift(dropped.name);
		output = header + parts.map((part) => part.block).join(REFERENCE_SEPARATOR);
		if (parts.length === 0) return '';
	}

	return output;
}

function truncationFooter(omitted: string[]): string {
	return `\n\n_Reference content truncated. Omitted: ${omitted.join(
		', ',
	)}. Use \`reference({ name: "X" })\` to load on demand._`;
}
