/**
 * Formatting helpers for reference tool output.
 */

/** Separator used between references in multi-load output */
export const REFERENCE_SEPARATOR = '\n\n---\n\n';

/** Render a single reference block with header banner */
export function formatReferenceBlock(
  name: string,
  source: string,
  content: string,
): string {
  return `# Reference: ${name}\n_Source: ${source}_\n\n${content}`;
}

/** Render the full catalog list entry for a reference */
export function formatCatalogEntry(
  name: string,
  source: string,
  description: string,
  tags: string[],
): string {
  const tagStr = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
  return `${name} [${source}]: ${description}${tagStr}`;
}
