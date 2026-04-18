import { extname } from 'node:path';

import type { ToolDefinition } from '../../types/tools.js';
import type { ElefantError } from '../../types/errors.js';
import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';

import type { Position } from './client.js';
import { formatHover, formatLocations, formatSymbols } from './format.js';
import { getClient } from './manager.js';

export type LspOperation =
  | 'goToDefinition'
  | 'findReferences'
  | 'hover'
  | 'documentSymbol'
  | 'workspaceSymbol';

export interface LspParams {
  operation: LspOperation;
  filePath?: string;
  position?: { line: number; character: number };
  query?: string;
}

function detectLanguage(filePath: string): string | null {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.ts' || extension === '.tsx' || extension === '.js' || extension === '.jsx') {
    return 'typescript';
  }
  return null;
}

function isPosition(value: LspParams['position']): value is Position {
  if (!value) {
    return false;
  }
  return Number.isInteger(value.line) && value.line >= 0 && Number.isInteger(value.character) && value.character >= 0;
}

export const lspTool: ToolDefinition<LspParams, string> = {
  name: 'lsp',
  description: 'Experimental code intelligence via Language Server Protocol.',
  parameters: {
    operation: {
      type: 'string',
      description: 'LSP operation: goToDefinition | findReferences | hover | documentSymbol | workspaceSymbol',
      required: true,
    },
    filePath: {
      type: 'string',
      description: 'Absolute file path used for position/document operations',
      required: false,
    },
    position: {
      type: 'object',
      description: 'Zero-based cursor position for goToDefinition/findReferences/hover',
      required: false,
    },
    query: {
      type: 'string',
      description: 'Workspace symbol query',
      required: false,
    },
  },
  execute: async (params): Promise<Result<string, ElefantError>> => {
    if (process.env.ELEFANT_EXPERIMENTAL_LSP !== 'true') {
      return err({
        code: 'TOOL_EXECUTION_FAILED',
        message: 'LSP tool is experimental. Set ELEFANT_EXPERIMENTAL_LSP=true to enable.',
      });
    }

    const { operation, filePath, position, query } = params;

    try {
      const language = filePath ? detectLanguage(filePath) : 'typescript';
      if (!language) {
        return err({
          code: 'BINARY_NOT_FOUND',
          message: `No LSP server mapping for file extension: ${extname(filePath ?? '')}`,
        });
      }

      const client = await getClient(language);
      if (!client) {
        return err({
          code: 'BINARY_NOT_FOUND',
          message: 'LSP server not found. Install typescript-language-server.',
        });
      }

      if (operation === 'goToDefinition') {
        if (!filePath || !isPosition(position)) {
          return err({
            code: 'VALIDATION_ERROR',
            message: 'goToDefinition requires filePath and position.',
          });
        }
        const locations = await client.goToDefinition(filePath, position);
        return ok(formatLocations(locations));
      }

      if (operation === 'findReferences') {
        if (!filePath || !isPosition(position)) {
          return err({
            code: 'VALIDATION_ERROR',
            message: 'findReferences requires filePath and position.',
          });
        }
        const locations = await client.findReferences(filePath, position);
        return ok(formatLocations(locations));
      }

      if (operation === 'hover') {
        if (!filePath || !isPosition(position)) {
          return err({
            code: 'VALIDATION_ERROR',
            message: 'hover requires filePath and position.',
          });
        }
        const content = await client.hover(filePath, position);
        return ok(formatHover(content));
      }

      if (operation === 'documentSymbol') {
        if (!filePath) {
          return err({
            code: 'VALIDATION_ERROR',
            message: 'documentSymbol requires filePath.',
          });
        }
        const symbols = await client.documentSymbols(filePath);
        return ok(formatSymbols(symbols));
      }

      if (operation === 'workspaceSymbol') {
        if (!query || query.trim().length === 0) {
          return err({
            code: 'VALIDATION_ERROR',
            message: 'workspaceSymbol requires query.',
          });
        }
        const symbols = await client.workspaceSymbols(query);
        return ok(formatSymbols(symbols));
      }

      return err({
        code: 'VALIDATION_ERROR',
        message: `Unsupported operation: ${operation}`,
      });
    } catch (error) {
      return err({
        code: 'TOOL_EXECUTION_FAILED',
        message: `LSP execution failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  },
};
