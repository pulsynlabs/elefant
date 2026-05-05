/**
 * field_notes_read tool — read a Field Notes file by id, path, or fieldnotes:// URI
 * with optional #anchor section extraction.
 *
 * MR-18
 */

import { join } from 'node:path';
import type { ToolDefinition } from '../../types/tools.js';
import type { ElefantError } from '../../types/errors.js';
import { ok, err, type Result } from '../../types/result.js';
import { fieldNotesDir } from '../../project/paths.js';
import { assertInsideFieldNotes } from '../../fieldnotes/membership.js';
import {
  parseFrontmatter,
  type Frontmatter,
} from '../../fieldnotes/frontmatter.js';
import { parseFieldNotesLink } from '../../fieldnotes/link.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FieldNotesReadParams {
  id?: string;
  path?: string;
  link?: string;
  anchor?: string;
}

export interface FieldNotesReadResult {
  /** File path relative to .elefant/field-notes/ */
  path: string;
  /** Parsed frontmatter, or null for lenient reads of scratch/unstructured files */
  frontmatter: Frontmatter | null;
  /** Full markdown body after frontmatter stripping */
  body: string;
  /** Extracted section when matching heading found, or undefined */
  anchorBody?: string;
  /** fieldnotes:// URI for this file */
  fieldnotes_link: string;
  /** Whitespace-delimited word count of body text */
  wordCount: number;
}

export interface FieldNotesReadDeps {
  /** Absolute path to the project root */
  projectPath: string;
  /** Store resolver for id-based lookups; omitted when resolving by path/link */
  store?: {
    getDocumentById(
      id: string,
    ): Result<{ filePath: string } | null, ElefantError>;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * GitHub-style heading slug: lowercase, non-alphanumeric-removed, kebab-case.
 * Matches the slugify used by the chunker for consistent anchor matching.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Count whitespace-delimited words in a string.
 */
function wordCount(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Extract the section of `body` starting at the heading whose slug matches
 * `anchor`, through the next heading of the same or higher level.
 *
 * Returns `undefined` when no matching heading is found.
 */
function extractAnchor(body: string, anchor: string): string | undefined {
  const lines = body.split('\n');
  let foundAnchor = false;
  let anchorLevel = 0;
  const collected: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const slug = slugify(text);

      if (slug === anchor) {
        foundAnchor = true;
        anchorLevel = level;
        collected.push(line);
        continue;
      }

      if (foundAnchor && level <= anchorLevel) {
        // Hit a same-or-higher-level heading — stop collecting
        break;
      }
    }

    if (foundAnchor) {
      collected.push(line);
    }
  }

  if (!foundAnchor) return undefined;

  // Trim leading/trailing blank lines
  while (collected.length > 0 && collected[0].trim() === '') collected.shift();
  while (collected.length > 0 && collected[collected.length - 1].trim() === '')
    collected.pop();

  return collected.length > 0 ? collected.join('\n') : undefined;
}

/**
 * Lenient file read: attempt strict frontmatter parse; on failure, strip any
 * YAML block and return the body with `frontmatter: null`. Scratch files and
 * work-in-progress notes should never be unreadable.
 */
function lenientParse(
  raw: string,
): { frontmatter: Frontmatter | null; body: string } {
  const result = parseFrontmatter(raw);
  if (result.ok) return result.data;

  // Try to detect and strip a malformed YAML block
  if (raw.startsWith('---')) {
    const afterOpen = raw.slice(3);
    const closeIdx = afterOpen.indexOf('\n---');
    if (closeIdx !== -1) {
      let body = afterOpen.slice(closeIdx + 4);
      while (body.startsWith('\n')) body = body.slice(1);
      return { frontmatter: null, body };
    }
  }

  // No recognizable YAML block — whole file is body
  return { frontmatter: null, body: raw };
}

// ─── Tool factory ───────────────────────────────────────────────────────────

export function createFieldNotesReadTool(
  deps: FieldNotesReadDeps,
): ToolDefinition<FieldNotesReadParams, FieldNotesReadResult> {
  const { projectPath, store } = deps;

  return {
    name: 'field_notes_read',
    description:
      'Read a Field Notes file by id, path, or fieldnotes:// URI, with optional #anchor section extraction.',
    deferred: true,
    parameters: {
      id: {
        type: 'string',
        required: false,
        description: 'frontmatter uuid',
      },
      path: {
        type: 'string',
        required: false,
        description: 'relative path from .elefant/field-notes/',
      },
      link: {
        type: 'string',
        required: false,
        description: 'fieldnotes:// URI',
      },
      anchor: {
        type: 'string',
        required: false,
        description: 'heading slug to extract section from',
      },
    },
    execute: async (
      params: FieldNotesReadParams,
    ): Promise<Result<FieldNotesReadResult, ElefantError>> => {
      const { id, path, link, anchor: paramAnchor } = params;

      // ── 1. Validate: exactly one of id / path / link ──
      const provided = [id, path, link].filter((v) => v !== undefined);
      if (provided.length === 0) {
        return err({
          code: 'VALIDATION_ERROR',
          message:
            'Exactly one of `id`, `path`, or `link` must be provided',
        });
      }
      if (provided.length > 1) {
        return err({
          code: 'VALIDATION_ERROR',
          message:
            'Only one of `id`, `path`, or `link` may be provided at a time',
        });
      }

      // ── 2. Resolve the relative file path ──
      let resolvedRelPath: string;
      let resolvedAnchor: string | null = paramAnchor ?? null;

      if (link !== undefined) {
        // Parse the fieldnotes:// URI
        const linkResult = parseFieldNotesLink(link);
        if (!linkResult.ok) return err(linkResult.error);

        resolvedRelPath = linkResult.data.path;
        if (linkResult.data.anchor) {
          // Link anchor takes precedence over param anchor
          resolvedAnchor = linkResult.data.anchor;
        }
      } else if (id !== undefined) {
        // Look up by UUID in the store
        if (!store) {
          return err({
            code: 'VALIDATION_ERROR',
            message:
              'Id-based lookup requires a store; no store provided',
          });
        }
        const docResult = store.getDocumentById(id);
        if (!docResult.ok) return err(docResult.error);

        const doc = docResult.data;
        if (!doc) {
          return err({
            code: 'FILE_NOT_FOUND',
            message: `No document found with id: ${id}`,
          });
        }

        resolvedRelPath = doc.filePath;
      } else {
        // path provided directly
        resolvedRelPath = path!;
      }

      // ── 3. Resolve absolute path and validate membership ──
      const baseDir = fieldNotesDir(projectPath);
      const absolutePath = join(baseDir, resolvedRelPath);

      const membershipResult = assertInsideFieldNotes(
        projectPath,
        absolutePath,
      );
      if (!membershipResult.ok) return err(membershipResult.error);

      const canonicalPath = membershipResult.data;

      // ── 4. Read the file ──
      let raw: string;
      try {
        raw = await Bun.file(canonicalPath).text();
      } catch (e) {
        return err({
          code: 'FILE_NOT_FOUND',
          message: `File not found: ${resolvedRelPath}`,
          details: e,
        });
      }

      // ── 5. Parse frontmatter (lenient) ──
      const { frontmatter, body } = lenientParse(raw);

      // ── 6. Optional anchor extraction ──
      let anchorBody: string | undefined;
      if (resolvedAnchor) {
        anchorBody = extractAnchor(body, resolvedAnchor);
        // Non-existent anchor is not an error — just omit anchorBody
      }

      // ── 7. Build result ──
      return ok({
        path: resolvedRelPath,
        frontmatter,
        body,
        anchorBody,
        fieldnotes_link: `fieldnotes://_/${resolvedRelPath}`,
        wordCount: wordCount(body),
      });
    },
  };
}
