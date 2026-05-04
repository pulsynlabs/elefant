/**
 * Parses the LSP diagnostic suffix appended to write/edit tool output by the
 * daemon's `buildDiagnosticSuffix` (see `src/lsp/format.ts`).
 *
 * The expected wire format is:
 *
 *     <base tool output>
 *
 *     LSP errors detected in this file, please fix:
 *     /path/to/file.ts:
 *       5:10 - error: Type 'string' is not assignable to type 'number'. [2322]
 *       12:5 - error: Property 'foo' does not exist on type 'Bar'. [2339]
 *
 *     LSP errors detected in other files:
 *     /other/path.ts:
 *       3:1 - warning: Unused import. [6133]
 *
 * Only the **current-file** block is parsed here; "other files" diagnostics
 * are intentionally ignored — they are visible in the raw text and are not
 * meant to annotate the diff for the file being edited.
 *
 * Severity mapping: `information` collapses to `info` to match the
 * `DiagnosticInput` type (which uses the editor-friendly four-level union).
 */
import type { DiagnosticInput } from '$lib/types/diagnostics.js';

const CURRENT_FILE_MARKER = '\nLSP errors detected in this file, please fix:\n';
const OTHER_FILES_MARKER = '\nLSP errors detected in other files:\n';

/**
 * Pattern for a single diagnostic line:
 *
 *     `  <line>:<col> - <severity>: <message> [<code>]`
 *
 * Severity is one of `error | warning | information | hint`.
 * The trailing `[<code>]` is optional.
 */
const DIAGNOSTIC_LINE = /^\s+(\d+):(\d+) - (error|warning|information|hint): (.+?)(?:\s+\[([^\]]+)\])?$/;

function normalizeSeverity(
	raw: string,
): DiagnosticInput['severity'] {
	if (raw === 'information') return 'info';
	return raw as 'error' | 'warning' | 'hint';
}

/**
 * Extract structured diagnostics from a tool-result string.
 *
 * Returns an empty array when the LSP block is absent or malformed —
 * never `null` or `undefined`. The diff renderer uses an empty list as
 * "no markers".
 */
export function parseLspDiagnostics(content: string): DiagnosticInput[] {
	const results: DiagnosticInput[] = [];
	if (!content) return results;

	const start = content.indexOf(CURRENT_FILE_MARKER);
	if (start === -1) return results;

	// The current-file block runs from after the marker until either the
	// "other files" marker or end-of-string, whichever comes first.
	const sectionStart = start + CURRENT_FILE_MARKER.length;
	const otherIdx = content.indexOf(OTHER_FILES_MARKER, sectionStart);
	const sectionEnd = otherIdx === -1 ? content.length : otherIdx;
	const section = content.slice(sectionStart, sectionEnd);

	for (const line of section.split('\n')) {
		const match = DIAGNOSTIC_LINE.exec(line);
		if (!match) continue;
		const [, lineNum, col, severity, message, code] = match;
		results.push({
			line: Number.parseInt(lineNum, 10),
			column: Number.parseInt(col, 10),
			severity: normalizeSeverity(severity),
			message: message.trim(),
			...(code !== undefined ? { code } : {}),
		});
	}

	return results;
}
