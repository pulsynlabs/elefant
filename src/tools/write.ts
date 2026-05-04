/**
 * Write tool — write full file content (creates or overwrites).
 * Creates parent directories automatically.
 */

import type { ToolDefinition } from '../types/tools.js';
import type { ElefantError } from '../types/errors.js';
import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getLspService, buildDiagnosticSuffix } from '../lsp/index.js';

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
