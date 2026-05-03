/**
 * Research Base frontmatter schema and parser.
 *
 * Uses a hand-rolled YAML subset parser (~50 lines) instead of a full YAML
 * library to avoid adding a dependency for a narrow contract (Zod-strict
 * frontmatter on 11 known keys with simple scalar/list values).
 */

import { z } from 'zod';
import type { Result } from '../types/result.ts';
import type { ElefantError } from '../types/errors.ts';
import { ok, err } from '../types/result.ts';

// ─── Schema ─────────────────────────────────────────────────────────────────

export const SectionSchema = z.enum([
  '00-index',
  '01-domain',
  '02-tech',
  '03-decisions',
  '04-comparisons',
  '05-references',
  '06-synthesis',
  '99-scratch',
]);
export type Section = z.infer<typeof SectionSchema>;

export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const AuthorAgentSchema = z.enum([
  'researcher',
  'writer',
  'librarian',
  'orchestrator',
  'planner',
  'verifier',
  'debugger',
  'tester',
  'explorer',
  'executor-low',
  'executor-medium',
  'executor-high',
  'executor-frontend',
  'user',
]);
export type AuthorAgent = z.infer<typeof AuthorAgentSchema>;

export const FrontmatterSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).max(200),
    section: SectionSchema,
    tags: z.array(z.string()).default([]),
    sources: z.array(z.string()).default([]),
    confidence: ConfidenceSchema.default('medium'),
    created: z.string(),
    updated: z.string(),
    author_agent: AuthorAgentSchema,
    workflow: z.string().nullable().default(null),
    summary: z.string().min(1).max(500),
  })
  .strict();

export type Frontmatter = z.infer<typeof FrontmatterSchema>;

// ─── YAML subset parser ─────────────────────────────────────────────────────

interface YAMLContext {
  key: string;
  items: string[];
}

/**
 * Parse a minimal YAML subset sufficient for research frontmatter.
 *
 * Handles:
 *  - `key: value` (scalar)
 *  - `key: "quoted value"` / `key: 'quoted value'`
 *  - `key:` followed by `  - item` list entries
 *  - `# comment` lines (silently dropped)
 *  - `null`, `true`, `false` literals
 */
function parseYAMLBlock(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let ctx: YAMLContext | null = null;

  function flushContext(): void {
    if (ctx !== null) {
      result[ctx.key] = ctx.items;
      ctx = null;
    }
  }

  for (let line of raw.split('\n')) {
    line = line.trim();

    // Skip blank lines and comments
    if (line === '' || line.startsWith('#')) continue;

    // List continuation: "  - value" or "- value"
    if (ctx !== null && line.startsWith('- ')) {
      ctx.items.push(line.slice(2).trim());
      continue;
    }

    // Any non-list line after a list context means we're done with the list
    flushContext();

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue; // malformed line, skip

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();

    if (rawValue === '') {
      // Start a list context
      ctx = { key, items: [] };
    } else {
      result[key] = parseYAMLScalar(rawValue);
    }
  }

  // Flush trailing list context
  flushContext();

  return result;
}

/**
 * Parse a YAML scalar: handles quoted strings, null, booleans, and plain strings.
 */
function parseYAMLScalar(raw: string): unknown {
  // Quoted strings
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }

  // Literal null
  if (raw === 'null' || raw === '~') return null;

  // Literal booleans
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  // Plain string — preserve as-is (Zod validates structure)
  return raw;
}

// ─── Frontmatter extractor ─────────────────────────────────────────────────

const FRONTMATTER_DELIM = '---';

/**
 * Locate the frontmatter block delimited by leading/trailing `---`.
 * Returns `null` if no valid YAML block is found.
 */
function extractFrontmatterBlock(
  raw: string,
): { yaml: string; body: string } | null {
  // Frontmatter must start at the very beginning (after optional BOM)
  const stripped = raw.replace(/^\uFEFF/, '');

  if (!stripped.startsWith(FRONTMATTER_DELIM)) return null;

  // Find closing delimiter
  const afterOpen = stripped.slice(FRONTMATTER_DELIM.length);

  // Allow newline after opening ---
  const yamlStart = afterOpen.startsWith('\n') ? afterOpen.slice(1) : afterOpen;
  const closeIdx = yamlStart.indexOf(`\n${FRONTMATTER_DELIM}`);

  if (closeIdx === -1) return null; // no closing delimiter

  const yaml = yamlStart.slice(0, closeIdx);

  // Body starts after '\n---' — skip any leading whitespace/newlines
  let bodyStart = closeIdx + 4; // past '\n---'
  while (bodyStart < yamlStart.length && yamlStart[bodyStart] === '\n') {
    bodyStart++;
  }
  const body = yamlStart.slice(bodyStart);

  return { yaml, body };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Parse a markdown document with YAML frontmatter.
 *
 * Returns `{ frontmatter, body }` on success, or an `ElefantError` on
 * missing/invalid frontmatter.
 */
export function parseFrontmatter(
  raw: string,
): Result<{ frontmatter: Frontmatter; body: string }, ElefantError> {
  const block = extractFrontmatterBlock(raw);
  if (!block) {
    return err({
      code: 'VALIDATION_ERROR',
      message: 'No valid YAML frontmatter block found (expects leading --- ... ---)',
    });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseYAMLBlock(block.yaml);
  } catch (e) {
    return err({
      code: 'VALIDATION_ERROR',
      message: `YAML parse error: ${String(e)}`,
      details: e,
    });
  }

  const validated = FrontmatterSchema.safeParse(parsed);
  if (!validated.success) {
    return err({
      code: 'VALIDATION_ERROR',
      message: validated.error.message,
      details: validated.error,
    });
  }

  return ok({ frontmatter: validated.data, body: block.body });
}

/**
 * Serialize frontmatter + body back into a markdown string with YAML block.
 *
 * Produces canonical output with the `---` delimiters and normalized YAML.
 * The round-trip property holds: `serialize(parse(x).frontmatter, parse(x).body)`
 * is idempotent.
 */
export function serializeFrontmatter(fm: Frontmatter, body: string): string {
  const lines: string[] = [];

  lines.push('---');
  lines.push(`id: ${fm.id}`);
  lines.push(`title: ${fm.title}`);
  lines.push(`section: ${fm.section}`);

  // tags
  if (fm.tags.length > 0) {
    lines.push('tags:');
    for (const tag of fm.tags) {
      lines.push(`  - ${tag}`);
    }
  }

  // sources
  if (fm.sources.length > 0) {
    lines.push('sources:');
    for (const src of fm.sources) {
      lines.push(`  - ${src}`);
    }
  }

  lines.push(`confidence: ${fm.confidence}`);
  lines.push(`created: ${fm.created}`);
  lines.push(`updated: ${fm.updated}`);
  lines.push(`author_agent: ${fm.author_agent}`);

  if (fm.workflow !== null) {
    lines.push(`workflow: ${fm.workflow}`);
  } else {
    lines.push('workflow: null');
  }

  lines.push(`summary: ${fm.summary}`);
  lines.push('---');

  return lines.join('\n') + '\n' + body;
}

/**
 * Fill missing fields in a partial frontmatter.
 *
 * Required fields (`title`, `section`, `summary`, `author_agent`) must be
 * provided. Auto-fills:
 *  - `id` → `crypto.randomUUID()`
 *  - `created` → `new Date().toISOString()`
 *  - `updated` → same as `created`
 *  - `tags` → `[]` (default)
 *  - `sources` → `[]` (default)
 *  - `confidence` → `'medium'` (default)
 *  - `workflow` → `null` (default)
 */
export function autoFillFrontmatter(
  partial: Partial<Frontmatter> & {
    title: string;
    section: Frontmatter['section'];
    summary: string;
    author_agent: Frontmatter['author_agent'];
  },
): Frontmatter {
  const now = new Date().toISOString();

  return FrontmatterSchema.parse({
    id: partial.id ?? crypto.randomUUID(),
    title: partial.title,
    section: partial.section,
    tags: partial.tags ?? [],
    sources: partial.sources ?? [],
    confidence: partial.confidence ?? 'medium',
    created: partial.created ?? now,
    updated: partial.updated ?? now,
    author_agent: partial.author_agent,
    workflow: partial.workflow ?? null,
    summary: partial.summary,
  });
}
