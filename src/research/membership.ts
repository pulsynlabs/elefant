/**
 * Traversal guard for .elefant/markdown-db/ membership.
 *
 * Every path that enters or leaves the Research Base must pass through
 * this function — canonicalizing, resolving symlinks, and rejecting escapes.
 */

import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import { researchBaseDir } from '../project/paths.js';
import { ok, err } from '../types/result.js';
import type { Result } from '../types/result.js';
import type { ElefantError } from '../types/errors.js';

/**
 * Returns ok(canonicalPath) when `candidate` (absolute or relative-to-project)
 * resolves to a path inside `<projectPath>/.elefant/markdown-db/`.
 */
export function assertInsideResearchBase(
  projectPath: string,
  candidate: string,
  opts?: { requireMarkdown?: boolean },
): Result<string, ElefantError> {
  if (!candidate || !candidate.trim()) {
    return err({
      code: 'VALIDATION_ERROR',
      message: 'Candidate path must not be empty',
    });
  }

  const baseResolved = resolve(researchBaseDir(projectPath));

  // resolve(projectPath, candidate) handles both absolute and relative inputs
  const candidateResolved = resolve(projectPath, candidate);

  // Resolve symlinks on the full path; if the file doesn't exist yet,
  // resolve the parent directory and re-append the basename so writes
  // to not-yet-existing files still get validated.
  let candidateCanonical: string;
  try {
    candidateCanonical = realpathSync(candidateResolved);
  } catch {
    const sepIdx = candidateResolved.lastIndexOf(sep);
    if (sepIdx <= 0) {
      candidateCanonical = candidateResolved;
    } else {
      const parent = candidateResolved.slice(0, sepIdx);
      const basename = candidateResolved.slice(sepIdx + 1);
      try {
        candidateCanonical = join(realpathSync(parent), basename);
      } catch {
        candidateCanonical = candidateResolved;
      }
    }
  }

  let baseCanonical: string;
  try {
    baseCanonical = realpathSync(baseResolved);
  } catch {
    baseCanonical = baseResolved;
  }

  candidateCanonical = resolve(candidateCanonical);
  baseCanonical = resolve(baseCanonical);

  if (candidateCanonical === baseCanonical) {
    return err({
      code: 'VALIDATION_ERROR',
      message: `Path must be inside the research base, not equal to it: ${candidate}`,
    });
  }

  // Prefix check with separator defeats .elefant/markdown-db-evil/ escapes
  if (!candidateCanonical.startsWith(baseCanonical + sep)) {
    return err({
      code: 'PERMISSION_DENIED',
      message: `Path escapes the research base: ${candidate}`,
    });
  }

  // Backup relative-path check catches edge cases on odd platforms
  const rel = relative(baseCanonical, candidateCanonical);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return err({
      code: 'PERMISSION_DENIED',
      message: `Path escapes the research base: ${candidate}`,
    });
  }

  // Files inside 99-scratch/ may use any extension (agent scratchpad);
  // files elsewhere must end in .md when requireMarkdown is true.
  if (opts?.requireMarkdown) {
    const inScratch =
      rel === '99-scratch' || rel.startsWith(`99-scratch${sep}`);
    if (!inScratch && !rel.endsWith('.md')) {
      return err({
        code: 'VALIDATION_ERROR',
        message: `Research files outside 99-scratch/ must end in .md: ${candidate}`,
      });
    }
  }

  return ok(candidateCanonical);
}
