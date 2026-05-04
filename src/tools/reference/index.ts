/**
 * Reference tool — load bundled reference markdown files by name, or list all
 * available references.
 *
 * References are Elefant-specific workflow protocols, agent guidance, and
 * format specifications.  Agents load them on demand via this tool without
 * bloating the system prompt.
 *
 * Resolution mirrors the skill tool: project → user → builtin (3-tier).
 */

import type { ToolDefinition } from '../../types/tools.js';
import type { ElefantError } from '../../types/errors.js';
import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';
import { resolveReference, listReferences } from './resolver.js';
import type { ReferenceInfo } from './resolver.js';
import type { ReferenceParams } from './types.js';
import { formatReferenceBlock, formatCatalogEntry } from './format.js';
import { extractSection } from './sections.js';

// import type avoids a runtime circular dependency (registry.ts imports this file).
import type { ToolRegistry } from '../registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a flat list of references for the `list: true` action.
 * Each line: `name [source]: description [tag1, tag2, ...]`
 */
function formatReferencesList(refs: ReferenceInfo[]): string {
  if (refs.length === 0) {
    return 'No references available.';
  }

  return refs
    .map((r) =>
      formatCatalogEntry(
        r.name,
        r.source,
        r.description,
        r.frontmatter?.tags ?? [],
      ),
    )
    .join('\n');
}

/**
 * Build the tool description with a live reference catalog embedded.
 * Uses compact markdown so the model sees available references inline.
 */
function buildDescription(refs: ReferenceInfo[]): string {
	const preamble = [
		'Load bundled reference documents by name, or list all available references.',
		'',
		'References are markdown files encoding Elefant-specific workflows, agent protocols,',
		'and format guidelines. Load one or more references to get guidance without bloating',
		'the system prompt.',
		'',
		'Examples:',
		'  reference({ name: "handoff-format" })          — load a single reference',
		'  reference({ names: ["deviation-rules", "memory-usage"] })  — load multiple at once',
		'  reference({ list: true })                       — list all available references',
		'  reference({ list: true, tag: "orchestrator" }) — filter by tag',
	];

	if (refs.length === 0) {
		return [...preamble, '', 'No references are currently available.'].join('\n');
	}

	const catalogLines = refs.map(
		(r) => `- **${r.name}** [${r.source}]: ${r.description}`,
	);
	const catalog = `## Available References\n\n${catalogLines.join('\n')}`;

	return [...preamble, '', catalog].join('\n');
}

// ---------------------------------------------------------------------------
// Parameter schema
// ---------------------------------------------------------------------------

/** Shared parameter schema — identical for both the static and async tool. */
const referenceParamsSchema: Record<string, {
	type: 'string' | 'boolean' | 'array';
	description: string;
	required?: boolean;
	default?: unknown;
}> = {
	name: {
		type: 'string',
		description: 'Reference name to load (e.g. "handoff-format")',
		required: false,
	},
	names: {
		type: 'array',
		description:
			'Multiple reference names to load in a single call (returns concatenated with separators)',
		required: false,
	},
	list: {
		type: 'boolean',
		description: 'List all available references',
		required: false,
		default: false,
	},
	tag: {
		type: 'string',
		description: 'Filter list by tag (single tag)',
		required: false,
	},
	tags: {
		type: 'array',
		description: 'Filter list by multiple tags (OR logic)',
		required: false,
	},
	section: {
		type: 'string',
		description: 'Extract a specific ## section from a reference',
		required: false,
	},
};

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

/** Shared execute function — identical for both the static and async tool. */
async function executeReference(
	params: ReferenceParams,
): Promise<Result<string, ElefantError>> {
  const { name, names, list, tag, tags, section, home, cwd } = params;
	const opts = { home, cwd };

	// Must provide at least one action
	if (!name && !list && (!names || names.length === 0)) {
		return err({
			code: 'VALIDATION_ERROR',
			message: 'Provide name, names, or list: true',
		});
	}

  // -- List mode -----------------------------------------------------------
  if (list) {
    let refs = await listReferences(opts);

    // Apply tag filtering (OR logic)
    const filterTags: string[] = [];
    if (tag) filterTags.push(tag);
    if (tags && tags.length > 0) filterTags.push(...tags);

    if (filterTags.length > 0) {
      refs = refs.filter(
        (r) =>
          r.frontmatter?.tags.some((t) => filterTags.includes(t)) ?? false,
      );
    }

    if (refs.length === 0 && filterTags.length > 0) {
      return ok(`No references match tag(s): ${filterTags.join(', ')}`);
    }

    return ok(formatReferencesList(refs));
  }

	// -- Multi-load (names[]) -------------------------------------------------
	if (names && names.length > 0) {
		if (section) {
			return err({
				code: 'VALIDATION_ERROR',
				message: 'Cannot use section with names (multi-load). Load individually.',
			});
		}

		const parts: string[] = [];
		const missing: string[] = [];

		for (const n of names) {
			const result = await resolveReference(n, opts);
			if (!result) {
				missing.push(n);
				continue;
			}
			parts.push(formatReferenceBlock(n, result.source, result.content));
		}

		if (parts.length === 0) {
			return err({
				code: 'FILE_NOT_FOUND',
				message: `References not found: ${names.join(', ')}`,
			});
		}

		let output = parts.join('\n\n---\n\n');
		if (missing.length > 0) {
			output += `\n\n_Not found: ${missing.join(', ')}_`;
		}
		return ok(output);
	}

	// -- Single load ----------------------------------------------------------
	const result = await resolveReference(name!, opts);
	if (!result) {
		return err({
			code: 'FILE_NOT_FOUND',
			message: `Reference not found: ${name}`,
		});
	}

	// Section extraction
	if (section) {
		const extracted = extractSection(result.content, section);
		if (!extracted.found) {
			const available =
				extracted.available.length > 0
					? `\n\nAvailable sections: ${extracted.available.join(', ')}`
					: '';
			return err({
				code: 'NOT_FOUND',
				message: `Section "${section}" not found in "${name}"${available}`,
			});
		}
		return ok(`# ${name} \u2014 ${section}\n\n${extracted.content}`);
	}

	return ok(formatReferenceBlock(name!, result.source, result.content));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Static fallback tool definition.
 *
 * Registered first during synchronous tool registry creation so the tool is
 * always available.  The description is a generic one-liner — callers that
 * want an inline reference catalog should call {@link initializeReferenceTool}
 * after registry creation, which replaces this entry with one that embeds the
 * live reference list.
 */
export const referenceTool: ToolDefinition<ReferenceParams, string> = {
	name: 'reference',
	description:
		'Load a bundled reference document by name, or list all available references.',
	deferred: true,
	parameters: referenceParamsSchema,
	execute: executeReference,
};

/**
 * Create the reference tool definition with a live reference catalog embedded
 * in the description.
 *
 * Reads references from disk (project, user, and builtin tiers) and formats
 * them as a compact markdown list under `## Available References`.
 */
export async function createReferenceTool(
	opts?: { home?: string; cwd?: string },
): Promise<ToolDefinition<ReferenceParams, string>> {
	const refs = await listReferences(opts ?? {});
	return {
		name: 'reference',
		description: buildDescription(refs),
		parameters: referenceParamsSchema,
		execute: executeReference,
	};
}

/**
 * Replace the statically-registered `reference` tool with one whose description
 * embeds the live reference catalog.
 *
 * Call this after {@link ToolRegistry} creation (e.g. from the daemon or
 * server bootstrap code) to upgrade the tool description.  The registry
 * supports overwriting entries by name so this is safe to call at any point.
 */
export async function initializeReferenceTool(
	registry: ToolRegistry,
	opts?: { home?: string; cwd?: string },
): Promise<void> {
	const tool = await createReferenceTool(opts);
	registry.register(tool);
}

export type { ReferenceParams } from './types.js';
