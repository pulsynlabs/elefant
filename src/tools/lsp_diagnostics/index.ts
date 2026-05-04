import { getLspService } from '../../lsp/index.js';
import type { LspDiagnostic, DiagnosticSeverity } from '../../lsp/types.js';
import type { ToolDefinition } from '../../types/tools.js';
import type { ElefantError } from '../../types/errors.js';
import type { Result } from '../../types/result.js';
import { ok } from '../../types/result.js';

type SeverityFilter = 'error' | 'warning' | 'information' | 'hint' | 'all';

export interface LspDiagnosticsParams {
  filePath?: string;
  severity?: SeverityFilter;
}

const SEVERITY_NUMBERS: Record<string, DiagnosticSeverity[]> = {
  error: [1],
  warning: [2],
  information: [3],
  hint: [4],
  all: [1, 2, 3, 4],
};

/** Default filter: errors and warnings only */
const DEFAULT_SEVERITIES: DiagnosticSeverity[] = [1, 2];

function filterBySeverity(
  diags: LspDiagnostic[],
  filter?: SeverityFilter,
): LspDiagnostic[] {
  const allowed = filter
    ? (SEVERITY_NUMBERS[filter] ?? DEFAULT_SEVERITIES)
    : DEFAULT_SEVERITIES;
  return diags.filter((d) => allowed.includes(d.severity ?? 1));
}

function severityLabel(severity: number | undefined): string {
  if (severity === 1) return 'error';
  if (severity === 2) return 'warning';
  if (severity === 3) return 'information';
  if (severity === 4) return 'hint';
  return 'error';
}

export const lspDiagnosticsTool: ToolDefinition<LspDiagnosticsParams, string> = {
  name: 'lsp_diagnostics',
  description:
    'List current LSP diagnostics (type errors, warnings) across the workspace or for a specific file. ' +
    'Optionally filter by severity level.',
  category: 'inspect',
  parameters: {
    filePath: {
      type: 'string',
      description: 'Optional absolute path to scope results to a single file',
      required: false,
    },
    severity: {
      type: 'string',
      description:
        'Filter by severity: error | warning | information | hint | all (default: errors and warnings)',
      required: false,
    },
  },
  execute: async (params): Promise<Result<string, ElefantError>> => {
    try {
      const lsp = getLspService();
      const allDiags = await lsp.diagnostics();

      const lines: string[] = [];
      const filesToCheck = params.filePath
        ? [params.filePath]
        : Object.keys(allDiags);

      for (const file of filesToCheck.sort()) {
        const diags = params.filePath
          ? lsp.getDiagnosticsFor(file)
          : (allDiags[file] ?? []);

        const filtered = filterBySeverity(
          diags,
          params.severity as SeverityFilter | undefined,
        );
        for (const d of filtered) {
          const line = d.range.start.line + 1;
          const col = d.range.start.character + 1;
          const sev = severityLabel(d.severity);
          const code = d.code !== undefined ? ` [${d.code}]` : '';
          lines.push(`${file}:${line}:${col} — ${sev}: ${d.message}${code}`);
        }
      }

      if (lines.length === 0) return ok('No diagnostics.');
      return ok(lines.join('\n'));
    } catch {
      return ok('No diagnostics.');
    }
  },
};
