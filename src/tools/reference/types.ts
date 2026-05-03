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

// ── Frontmatter schema ─────────────────────────────────────────────────────

import { z } from 'zod';

export const ReferenceFrontmatterSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be kebab-case'),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  tags: z.array(z.string()).default([]),
  audience: z.array(z.string()).default([]),
  version: z.string().optional(),
}).strict();

export type ReferenceFrontmatter = z.infer<typeof ReferenceFrontmatterSchema>;

// ── Re-export ReferenceInfo from the resolver ─────────────────────────────
export type { ReferenceInfo } from './resolver.js';
