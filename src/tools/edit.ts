/**
 * Edit tool — exact string replacement within a file.
 * Fails if oldString is not found or matches multiple locations (unless replaceAll: true).
 */

import type { ToolDefinition } from '../types/tools.js';
import type { ElefantError } from '../types/errors.js';
import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';

export interface EditParams {
  filePath: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

/**
 * Count occurrences of a substring in a string.
 */
function countOccurrences(content: string, search: string): number {
  if (search.length === 0) return 0;

  let count = 0;
  let position = 0;

  while ((position = content.indexOf(search, position)) !== -1) {
    count++;
    position += search.length;
  }

  return count;
}

/**
 * Edit tool definition.
 */
export const editTool: ToolDefinition<EditParams, string> = {
  name: 'edit',
  description: 'Exact string replacement within a file. Fails if oldString not found or ambiguous (multiple matches).',
  parameters: {
    filePath: {
      type: 'string',
      description: 'Absolute path to the file to edit',
      required: true,
    },
    oldString: {
      type: 'string',
      description: 'Exact string to find and replace',
      required: true,
    },
    newString: {
      type: 'string',
      description: 'Replacement string',
      required: true,
    },
    replaceAll: {
      type: 'boolean',
      description: 'Replace all occurrences instead of just the first',
      required: false,
      default: false,
    },
  },
  execute: async (params): Promise<Result<string, ElefantError>> => {
    const { filePath, oldString, newString, replaceAll = false } = params;

    try {
      // Read the file
      const file = Bun.file(filePath);
      const content = await file.text();

      // Count occurrences
      const count = countOccurrences(content, oldString);

      if (count === 0) {
        return err({
          code: 'VALIDATION_ERROR',
          message: 'oldString not found in file',
        });
      }

      if (count > 1 && !replaceAll) {
        return err({
          code: 'VALIDATION_ERROR',
          message: `Found ${count} matches. Use replaceAll: true to replace all, or provide more context in oldString.`,
        });
      }

      // Perform replacement
      const newContent = replaceAll
        ? content.replaceAll(oldString, newString)
        : content.replace(oldString, newString);

      // Write back
      await Bun.write(filePath, newContent);

      const replacedCount = replaceAll ? count : 1;
      return ok(`Replaced ${replacedCount} occurrence(s) in ${filePath}`);
    } catch (error) {
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
        message: `Failed to edit file: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  },
};
