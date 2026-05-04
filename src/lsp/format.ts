import type { LspDiagnostic } from './types.js';

const SEVERITY_LABELS: Record<number, string> = {
  1: 'error',
  2: 'warning',
  3: 'information',
  4: 'hint',
};

const MAX_MESSAGE_LENGTH = 200;

/** Map a DiagnosticSeverity numeric value to its string label. */
function severityLabel(severity: number | undefined): string {
  if (severity !== undefined && SEVERITY_LABELS[severity]) {
    return SEVERITY_LABELS[severity];
  }
  return 'error';
}

/**
 * Format a single LSP diagnostic as a human-readable line.
 *
 * Output: `  <line>:<col> - <severity>: <message> [<code>]`
 * Line and column are 1-based (LSP uses 0-based, so we add 1).
 */
export function pretty(d: LspDiagnostic): string {
  const line = d.range.start.line + 1;
  const col = d.range.start.character + 1;
  const sev = severityLabel(d.severity);

  let message = d.message;
  if (message.length > MAX_MESSAGE_LENGTH) {
    message = message.slice(0, MAX_MESSAGE_LENGTH) + '...';
  }

  const base = `  ${line}:${col} - ${sev}: ${message}`;
  if (d.code !== undefined) {
    return `${base} [${d.code}]`;
  }
  return base;
}

/**
 * Build a formatted report block for diagnostics in a single file.
 *
 * Returns `undefined` when the diagnostics array is empty.
 * Sorts by severity ascending (errors first), then by line number.
 */
export function report(filePath: string, diagnostics: LspDiagnostic[]): string | undefined {
  if (diagnostics.length === 0) return undefined;

  const sorted = [...diagnostics].sort((a, b) => {
    const sa = a.severity ?? 1;
    const sb = b.severity ?? 1;
    if (sa !== sb) return sa - sb;
    return a.range.start.line - b.range.start.line;
  });

  const lines = sorted.map(pretty);
  return `${filePath}:\n${lines.join('\n')}`;
}

/**
 * Report diagnostics for files OTHER than `currentFile`.
 *
 * maxFiles caps the number of files included (default 20).
 * maxPerFile caps diagnostics per file (default 20).
 * Files containing errors (severity=1) sort before files with only warnings.
 * Returns `undefined` when no other files have diagnostics.
 */
export function reportOthers(
  byFile: Record<string, LspDiagnostic[]>,
  currentFile: string,
  maxFiles = 20,
  maxPerFile = 20,
): string | undefined {
  const otherFiles = Object.keys(byFile)
    .filter((fp) => fp !== currentFile && byFile[fp].length > 0);

  if (otherFiles.length === 0) return undefined;

  // Partition files: those with at least one error vs warnings-only.
  const errored: string[] = [];
  const warned: string[] = [];

  for (const fp of otherFiles) {
    const diags = byFile[fp];
    if (diags.some((d) => (d.severity ?? 1) === 1)) {
      errored.push(fp);
    } else {
      warned.push(fp);
    }
  }

  const ordered = [...errored, ...warned].slice(0, maxFiles);

  const blocks: string[] = [];
  for (const fp of ordered) {
    const diags = byFile[fp].slice(0, maxPerFile);
    const r = report(fp, diags);
    if (r !== undefined) blocks.push(r);
  }

  if (blocks.length === 0) return undefined;
  return blocks.join('\n');
}

/**
 * Build the diagnostic suffix string appended to write/edit tool output.
 *
 * - Returns `""` (empty string) when there are no relevant diagnostics.
 * - Prepends `\n\nLSP errors detected in this file, please fix:\n` before
 *   current-file diagnostics if present.
 * - Prepends `\n\nLSP errors detected in other files:\n` before other-file
 *   diagnostics if present.
 * - Both sections can appear together when applicable.
 */
export function buildDiagnosticSuffix(
  currentFile: string,
  allDiagnostics: Record<string, LspDiagnostic[]>,
): string {
  const currentDiags = allDiagnostics[currentFile];
  const currentBlock = currentDiags && currentDiags.length > 0
    ? report(currentFile, currentDiags)
    : undefined;

  const othersBlock = reportOthers(allDiagnostics, currentFile);

  const parts: string[] = [];

  if (currentBlock !== undefined) {
    parts.push(`\n\nLSP errors detected in this file, please fix:\n${currentBlock}`);
  }

  if (othersBlock !== undefined) {
    parts.push(`\n\nLSP errors detected in other files:\n${othersBlock}`);
  }

  return parts.join('');
}
