/**
 * YAML frontmatter parser for reference markdown files.
 *
 * Hand-rolled (no external YAML library) to support flat key-value pairs
 * and YAML list syntax for `tags` and `audience` fields.
 */

import { ReferenceFrontmatterSchema } from './types.js';
import type { ReferenceFrontmatter } from './types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type FrontmatterParseResult =
  | { ok: true; frontmatter: ReferenceFrontmatter; body: string }
  | { ok: false; error: string };

/**
 * Parse YAML frontmatter from a reference markdown string.
 *
 * Extracts the block between the opening `---` and closing `---` delimiters,
 * parses key-value pairs (including YAML list syntax), validates against the
 * Zod schema, and returns the parsed frontmatter plus the body text.
 *
 * Returns `ok: false` when:
 *   - No frontmatter block is present
 *   - The YAML is malformed
 *   - The frontmatter fails Zod validation
 */
export function parseReferenceFrontmatter(
  content: string,
): FrontmatterParseResult {
  const delimiterLen =
    content.startsWith('---\r\n')
      ? 5
      : content.startsWith('---\n')
        ? 4
        : -1;

  if (delimiterLen === -1) {
    return { ok: false, error: 'No frontmatter block found (expected ---)' };
  }

  const afterOpen = content.slice(delimiterLen);
  const lines = afterOpen.split(/\r?\n/);

  // Find the closing ---
  let closeLineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '---') {
      closeLineIndex = i;
      break;
    }
  }

  if (closeLineIndex === -1) {
    return {
      ok: false,
      error: 'Unclosed frontmatter block: missing closing ---',
    };
  }

  const fmLines = lines.slice(0, closeLineIndex);
  const body = lines.slice(closeLineIndex + 1).join('\n').trim();

  // Parse frontmatter lines into a raw record
  const rawResult = parseYamlLines(fmLines);
  if (!rawResult.ok) {
    return rawResult;
  }

  // Validate with Zod
  const zodResult = ReferenceFrontmatterSchema.safeParse(rawResult.raw);
  if (!zodResult.success) {
    const messages = zodResult.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return { ok: false, error: `Frontmatter validation failed: ${messages}` };
  }

  return { ok: true, frontmatter: zodResult.data, body };
}

// ---------------------------------------------------------------------------
// YAML line parser
// ---------------------------------------------------------------------------

interface YAMLRawResult {
  ok: true;
  raw: Record<string, unknown>;
}

function parseYamlLines(
  lines: string[],
): YAMLRawResult | { ok: false; error: string } {
  const raw: Record<string, unknown> = {};
  let currentListKey: string | null = null;
  let currentListValues: string[] = [];

  function flushList(): void {
    if (currentListKey !== null) {
      raw[currentListKey] = currentListValues;
      currentListKey = null;
      currentListValues = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Check for list item continuation
    const listMatch = trimmed.match(/^-\s+(.+)$/);
    if (listMatch) {
      if (currentListKey === null) {
        return {
          ok: false,
          error: `Unexpected list item on line ${i + 1}: "${trimmed}" — no preceding key`,
        };
      }
      currentListValues.push(listMatch[1].trim());
      continue;
    }

    // Before starting a new key, flush any pending list
    flushList();

    // Parse key: value
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) {
      return {
        ok: false,
        error: `Invalid frontmatter line ${i + 1}: "${trimmed}" — expected "key: value"`,
      };
    }

    const key = trimmed.slice(0, colonIndex).trim();
    if (key.length === 0) {
      return {
        ok: false,
        error: `Empty key on line ${i + 1}: "${trimmed}"`,
      };
    }

    const valuePart = trimmed.slice(colonIndex + 1).trim();

    if (valuePart === '') {
      // Key with no value — may start a list; read ahead
      currentListKey = key;
      currentListValues = [];
    } else {
      // Plain key: value
      raw[key] = parseScalarValue(valuePart);
    }
  }

  // Flush any trailing list
  flushList();

  return { ok: true, raw };
}

/**
 * Parse a scalar YAML value: unquote, trim, collapse whitespace.
 * Also handles YAML booleans and null.
 */
function parseScalarValue(raw: string): string {
  let value = raw.trim();

  // Strip surrounding matching quotes
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  // Collapse internal whitespace to a single space
  return value.replace(/\s+/g, ' ');
}
