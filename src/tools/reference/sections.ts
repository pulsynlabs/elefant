/**
 * Markdown section extractor — parses `##` headings.
 */

export type SectionResult =
  | { found: true; content: string }
  | { found: false; available: string[] };

/**
 * Extract the content of a `## Section Name` heading from markdown.
 *
 * Rules:
 * - Matches `## ` headings only (not `# ` or `### `)
 * - Case-insensitive match on the heading text
 * - Stops at the next `## ` heading (sibling), NOT at `### ` (sub-heading)
 * - Trims leading/trailing whitespace from the extracted content
 * - Returns first match when multiple headings with same text exist
 * - When not found, returns list of all available `## ` section names
 */
export function extractSection(
  content: string,
  sectionName: string,
): SectionResult {
  const lines = content.split('\n');
  const target = `## ${sectionName}`.toLowerCase();

  // Find all ## headings and their line indices
  const headings: Array<{ name: string; index: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('## ')) {
      headings.push({ name: trimmed.slice(3).trim(), index: i });
    }
  }

  // Find matching heading (case-insensitive)
  const matchIndex = headings.findIndex(
    (h) => `## ${h.name}`.toLowerCase() === target,
  );

  if (matchIndex === -1) {
    return { found: false, available: headings.map((h) => h.name) };
  }

  const startLine = headings[matchIndex].index + 1;
  // End at next ## heading (not ### — only sibling ## headings)
  const nextSiblingIndex = headings[matchIndex + 1]?.index ?? lines.length;

  const sectionLines = lines.slice(startLine, nextSiblingIndex);
  const sectionContent = sectionLines.join('\n').trim();

  return { found: true, content: sectionContent };
}
