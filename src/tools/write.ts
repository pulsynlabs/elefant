/**
 * Write tool — write full file content (creates or overwrites).
 * Creates parent directories automatically.
 */

import type { ToolDefinition } from '../types/tools.js';
import type { ElefantError } from '../types/errors.js';
import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { getLspService, buildDiagnosticSuffix } from '../lsp/index.js';
import { applyInstructionGuard } from '../instruction/guard.js';
import type { InstructionService } from '../instruction/types.js';
import { LINE_TARGET } from '../instruction/types.js';

export interface WriteParams {
  filePath: string;
  content: string;
}

/**
 * Write tool definition.
 */
export const writeTool: ToolDefinition<WriteParams, string> = {
  name: 'write',
  description: 'Write full file content. Creates parent directories if needed. Overwrites existing files.',
  parameters: {
    filePath: {
      type: 'string',
      description: 'Absolute path to the file to write',
      required: true,
    },
    content: {
      type: 'string',
      description: 'Content to write to the file',
      required: true,
    },
  },
  execute: async (params): Promise<Result<string, ElefantError>> => {
    const { filePath, content } = params;

    try {
      // Create parent directories if needed
      const parentDir = dirname(filePath);
      await mkdir(parentDir, { recursive: true });

      // Write the file
      await Bun.write(filePath, content);

      const bytesWritten = Buffer.byteLength(content, 'utf-8');
      let output = `Wrote ${bytesWritten} bytes to ${filePath}`;
      try {
        const lsp = getLspService();
        await lsp.touchFile(filePath, true);
        const diags = await lsp.diagnostics();
        output += buildDiagnosticSuffix(filePath, diags);
      } catch {
        // LSP must never break the write tool
      }
      return ok(output);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('EACCES') || error.message.includes('EPERM')) {
          return err({
            code: 'PERMISSION_DENIED',
            message: `Permission denied: ${filePath}`,
          });
        }
      }

      return err({
        code: 'TOOL_EXECUTION_FAILED',
        message: `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  },
};

export interface WriteToolDeps {
  /** Instruction service for hierarchical AGENTS.md resolution. */
  service: InstructionService;
  /** Already-loaded instruction paths for this session (mutated by guard). */
  alreadyLoaded: Set<string>;
  /** Absolute project root path. */
  projectRoot: string;
}

/**
 * Create a write tool that injects the instruction guard.
 *
 * After a successful write, applicable AGENTS.md / CLAUDE.md files
 * in the target file's directory ancestry are loaded and appended
 * as a `<system-reminder>` block in the tool output.
 *
 * The underlying `writeTool` is not modified — the factory returns
 * a wrapped copy with the guard injected into the `execute` path.
 */
export function createWriteTool(deps: WriteToolDeps): ToolDefinition<WriteParams, string> {
  return {
    ...writeTool,
    execute: async (params): Promise<Result<string, ElefantError>> => {
      const base = await writeTool.execute(params);
      if (!base.ok) return base;

      const guarded = await applyInstructionGuard({
        service: deps.service,
        filepath: params.filePath,
        alreadyLoaded: deps.alreadyLoaded,
        output: base.data,
      });

      let output = guarded.content;

      // If writing an instruction file, invalidate cache + check line count
      const resolvedPath = resolve(params.filePath);
      const name = basename(resolvedPath);
      if (name === 'AGENTS.md' || name === 'CLAUDE.md') {
        deps.service.invalidate(resolvedPath);
        const lineCount = params.content.split('\n').length;
        if (lineCount > LINE_TARGET) {
          output += `\n\n[WARNING: ${name} has ${lineCount} lines, exceeds target of ${LINE_TARGET}. Consider shortening.]`;
        }
      }

      return ok(output);
    },
  };
}
