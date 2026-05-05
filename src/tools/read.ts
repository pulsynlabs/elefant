/**
 * Read tool — read file contents with optional offset and limit.
 * Returns content with line numbers prefixed for LLM consumption.
 */

import type { ToolDefinition } from '../types/tools.js';
import type { ElefantError } from '../types/errors.js';
import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';
import type { InstructionService } from '../instruction/types.js';
import { applyInstructionGuard } from '../instruction/guard.js';
import { readdirSync, statSync } from 'node:fs';

export interface ReadParams {
  filePath: string;
  offset?: number; // 1-indexed line number to start from
  limit?: number; // max lines to return (default 2000)
}

/**
 * Check if content appears to be binary (>30% non-printable chars in first 1000 bytes).
 */
function isBinaryContent(content: string): boolean {
  const sample = content.slice(0, 1000);
  if (sample.length === 0) return false;

  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    // Non-printable: control chars except tab, newline, carriage return
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      nonPrintable++;
    }
  }

  return nonPrintable / sample.length > 0.3;
}

/**
 * Read tool definition.
 */
export const readTool: ToolDefinition<ReadParams, string> = {
  name: 'read',
  description: 'Read file contents. For directories, lists entries.',
  parameters: {
    filePath: {
      type: 'string',
      description: 'Absolute path to the file or directory to read',
      required: true,
    },
    offset: {
      type: 'number',
      description: '1-indexed line number to start from (default: 1)',
      required: false,
    },
    limit: {
      type: 'number',
      description: 'Maximum number of lines to return (default: 2000)',
      required: false,
      default: 2000,
    },
  },
  execute: async (params): Promise<Result<string, ElefantError>> => {
    const { filePath, offset = 1, limit = 2000 } = params;

    try {
      // Check if path is a directory
      const stats = statSync(filePath);

      if (stats.isDirectory()) {
        // List directory entries
        const entries = readdirSync(filePath, { withFileTypes: true });
        const lines = entries.map((entry) => {
          const suffix = entry.isDirectory() ? '/' : '';
          return `${entry.name}${suffix}`;
        });
        return ok(lines.join('\n'));
      }

      // Read file content
      const file = Bun.file(filePath);
      const content = await file.text();

      // Binary detection
      if (isBinaryContent(content)) {
        return err({
          code: 'VALIDATION_ERROR',
          message: 'Binary file not supported',
        });
      }

      // Split into lines and apply offset/limit
      const allLines = content.split('\n');
      const startIndex = Math.max(0, offset - 1); // Convert to 0-indexed
      const endIndex = Math.min(startIndex + limit, allLines.length);
      const selectedLines = allLines.slice(startIndex, endIndex);

      // Format with line numbers
      const formattedLines = selectedLines.map((line, index) => {
        const lineNumber = startIndex + index + 1;
        return `${lineNumber}: ${line}`;
      });

      return ok(formattedLines.join('\n'));
    } catch (error) {
      // Handle specific error codes
      if (error instanceof Error) {
        if (error.message.includes('ENOENT')) {
          return err({
            code: 'FILE_NOT_FOUND',
            message: `File not found: ${filePath}`,
          });
        }
        if (error.message.includes('EACCES') || error.message.includes('EPERM')) {
          return err({
            code: 'PERMISSION_DENIED',
            message: `Permission denied: ${filePath}`,
          });
        }
      }

      return err({
        code: 'TOOL_EXECUTION_FAILED',
        message: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  },
};

// ─── Factory-wrapped read tool with instruction guard ─────────────────────

export interface ReadToolDeps {
  /** InstructionService instance (from createInstructionService). */
  service: InstructionService;
  /** Already-loaded instruction paths for this session. MUTATED by the guard. */
  alreadyLoaded: Set<string>;
  /** Absolute path to the project root. */
  projectRoot: string;
}

/**
 * Create a read tool with optional instruction guard injection.
 *
 * When deps are provided, the factory wraps the base {@link readTool}'s
 * `execute` to call {@link applyInstructionGuard} after reading.  When new
 * AGENTS.md (or CLAUDE.md) files are found in the ancestry of the file being
 * read, a `<system-reminder>` block is appended to the output.
 *
 * When called without deps (or with the plain {@link readTool}), the guard
 * is skipped entirely — the base read behavior is unchanged.
 */
export function createReadTool(
  deps: ReadToolDeps,
): ToolDefinition<ReadParams, string> {
  return {
    ...readTool,
    execute: async (params): Promise<Result<string, ElefantError>> => {
      const base = await readTool.execute(params);
      if (!base.ok) return base;

      const guarded = await applyInstructionGuard({
        service: deps.service,
        filepath: params.filePath,
        alreadyLoaded: deps.alreadyLoaded,
        output: base.data,
      });

      return ok(guarded.content);
    },
  };
}
