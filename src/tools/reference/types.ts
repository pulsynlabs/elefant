// ── Parameter interface for the reference tool ─────────────────────────────

export interface ReferenceParams {
  /** Single reference name to load */
  name?: string;
  /** Multiple reference names for multi-load */
  names?: string[];
  /** List all available references */
  list?: boolean;
  /** Filter list by single tag (OR with tags[]) */
  tag?: string;
  /** Filter list by multiple tags (OR logic) */
  tags?: string[];
  /** Extract a specific ## section from a reference */
  section?: string;
  /** Override homedir() — for test isolation */
  home?: string;
  /** Override process.cwd() — for test isolation */
  cwd?: string;
}

// ── Frontmatter type placeholder (filled in by Wave 2, Task 2.1) ───────────

/**
 * YAML frontmatter fields expected on every reference file.
 * Wave 2 will replace this placeholder with a Zod-validated schema.
 */
export interface ReferenceFrontmatter {
  id: string;
  title: string;
  description: string;
  tags: string[];
  audience: string[];
  version?: string;
}

// ── Re-export ReferenceInfo from the resolver ─────────────────────────────
export type { ReferenceInfo } from './resolver.js';
