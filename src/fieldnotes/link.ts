/**
 * Field notes link parser and serializer — supports `fieldnotes://` URIs and
 * `.elefant/field-notes/` relative paths.
 */

import type { Result } from '../types/result.js';
import type { ElefantError } from '../types/errors.js';
import { ok, err } from '../types/result.js';

// ─── FieldNotesLink type ─────────────────────────────────────────────────────

export interface FieldNotesLink {
  kind: 'fieldnotes-uri' | 'relative-path';
  /** Workflow id slug (kebab-case or `'_'`), null for relative-path links */
  workflow: string | null;
  /** Path relative to `.elefant/field-notes/`, e.g. `02-tech/foo.md` */
  path: string;
  /** Heading anchor without `#`, or null */
  anchor: string | null;
}

// ─── Validation helpers ────────────────────────────────────────────────────

const ANCHOR_RE = /^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/;
const WORKFLOW_SLUG_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function validatePath(path: string): ElefantError | null {
  if (path === '') {
    return { code: 'VALIDATION_ERROR', message: 'Path must not be empty' };
  }
  if (path.startsWith('/')) {
    return {
      code: 'VALIDATION_ERROR',
      message: `Path must not start with "/": ${path}`,
    };
  }
  if (path.includes('..')) {
    return {
      code: 'VALIDATION_ERROR',
      message: `Path must not contain "..": ${path}`,
    };
  }
  if (!path.endsWith('.md')) {
    return {
      code: 'VALIDATION_ERROR',
      message: `Path must end with ".md": ${path}`,
    };
  }
  return null;
}

function validateAnchor(anchor: string | null): ElefantError | null {
  if (anchor === null || anchor === '') return null;
  if (!ANCHOR_RE.test(anchor)) {
    return {
      code: 'VALIDATION_ERROR',
      message: `Invalid anchor slug: "${anchor}"`,
    };
  }
  return null;
}

// ─── Parser ────────────────────────────────────────────────────────────────

export function parseFieldNotesLink(
  input: string,
): Result<FieldNotesLink, ElefantError> {
  const trimmed = input.trim();

  // ── fieldnotes:// URI form ──
  if (trimmed.startsWith('fieldnotes://')) {
    const rest = trimmed.slice('fieldnotes://'.length);

    const hashIdx = rest.indexOf('#');
    const pathAndWorkflow = hashIdx !== -1 ? rest.slice(0, hashIdx) : rest;
    const anchor = hashIdx !== -1 ? rest.slice(hashIdx + 1) : null;

    const slashIdx = pathAndWorkflow.indexOf('/');
    if (slashIdx === -1) {
      return err({
        code: 'VALIDATION_ERROR',
        message: `Invalid fieldnotes:// URI: missing path after workflow`,
      });
    }

    const workflow = pathAndWorkflow.slice(0, slashIdx);
    const path = pathAndWorkflow.slice(slashIdx + 1);

    if (workflow === '') {
      return err({
        code: 'VALIDATION_ERROR',
        message: 'Workflow slug must not be empty',
      });
    }
    if (workflow !== '_' && !WORKFLOW_SLUG_RE.test(workflow)) {
      return err({
        code: 'VALIDATION_ERROR',
        message: `Invalid workflow slug: "${workflow}"`,
      });
    }

    const pathErr = validatePath(path);
    if (pathErr) return err(pathErr);

    const anchorErr = validateAnchor(anchor);
    if (anchorErr) return err(anchorErr);

    return ok({ kind: 'fieldnotes-uri', workflow, path, anchor });
  }

  // ── Relative path form ──
  if (trimmed.startsWith('.elefant/field-notes/')) {
    const rest = trimmed.slice('.elefant/field-notes/'.length);

    const hashIdx = rest.indexOf('#');
    const path = hashIdx !== -1 ? rest.slice(0, hashIdx) : rest;
    const anchor = hashIdx !== -1 ? rest.slice(hashIdx + 1) : null;

    const pathErr = validatePath(path);
    if (pathErr) return err(pathErr);

    const anchorErr = validateAnchor(anchor);
    if (anchorErr) return err(anchorErr);

    return ok({ kind: 'relative-path', workflow: null, path, anchor });
  }

  return err({
    code: 'VALIDATION_ERROR',
    message: `Unrecognized link format: "${trimmed}"`,
  });
}

// ─── Serializer ─────────────────────────────────────────────────────────────

export function serializeFieldNotesLink(link: FieldNotesLink): string {
  const base =
    link.kind === 'fieldnotes-uri'
      ? `fieldnotes://${link.workflow}/${link.path}`
      : `.elefant/field-notes/${link.path}`;

  return link.anchor ? `${base}#${link.anchor}` : base;
}

// ─── Autolinker regex ──────────────────────────────────────────────────────

/**
 * Regex for detecting field notes links in chat output text.
 *
 * Matches both `fieldnotes://` URIs and `.elefant/field-notes/` relative paths,
 * for use with {@link parseFieldNotesLink} during markdown-to-chip rendering.
 */
export const FIELD_NOTES_LINK_REGEX =
  /(?:fieldnotes:\/\/(?:[a-zA-Z0-9][a-zA-Z0-9_-]*|_)\/[^\s#)\]}"']+\.md(?:#[^\s)\]}"'.]+)?|\.elefant\/field-notes\/[^\s#)\]}"']+\.md(?:#[^\s)\]}"'.]+)?)/g;
