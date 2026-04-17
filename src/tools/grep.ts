import type { ElefantError } from '../types/errors.js';
import type { Result } from '../types/result.js';
import type { ToolDefinition } from '../types/tools.js';
import { err, ok } from '../types/result.js';

import { executeBinary, getRipgrepPath } from './binary.js';

export interface GrepParams {
  pattern: string;
  path?: string;
  include?: string;
  exclude?: string;
  maxResults?: number;
}

interface RipgrepJsonTextField {
  text?: string;
  bytes?: string;
}

interface RipgrepMatchEvent {
  type: 'match';
  data: {
    path?: RipgrepJsonTextField;
    line_number?: number;
    lines?: RipgrepJsonTextField;
  };
}

function decodeTextField(field: RipgrepJsonTextField | undefined): string {
  if (!field) {
    return '';
  }

  if (typeof field.text === 'string') {
    return field.text;
  }

  if (typeof field.bytes === 'string') {
    try {
      return Buffer.from(field.bytes, 'base64').toString('utf-8');
    } catch {
      return '';
    }
  }

  return '';
}

function isMatchEvent(value: unknown): value is RipgrepMatchEvent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as { type?: unknown; data?: unknown };
  return candidate.type === 'match' && typeof candidate.data === 'object' && candidate.data !== null;
}

function getStderrFromErrorDetails(details: unknown): string {
  if (typeof details !== 'object' || details === null) {
    return '';
  }

  const value = details as { stderr?: unknown };
  return typeof value.stderr === 'string' ? value.stderr : '';
}

function isInvalidRegexError(stderr: string): boolean {
  return /regex parse error|invalid regex|error parsing regex/i.test(stderr);
}

export const grepTool: ToolDefinition<GrepParams, string> = {
  name: 'grep',
  description: 'Search file contents using regex. Returns file:line:content matches.',
  parameters: {
    pattern: {
      type: 'string',
      description: 'Regex pattern to search for',
      required: true,
    },
    path: {
      type: 'string',
      description: 'Search root directory (default: current working directory)',
      required: false,
    },
    include: {
      type: 'string',
      description: 'File include glob (e.g., "*.ts")',
      required: false,
    },
    exclude: {
      type: 'string',
      description: 'File exclude glob (e.g., "node_modules/**")',
      required: false,
    },
    maxResults: {
      type: 'number',
      description: 'Maximum number of matched lines to return (default: 1000)',
      required: false,
      default: 1000,
    },
  },
  execute: async (params): Promise<Result<string, ElefantError>> => {
    const {
      pattern,
      path: searchPath = process.cwd(),
      include,
      exclude,
      maxResults = 1000,
    } = params;

    if (pattern.trim() === '') {
      return err({
        code: 'VALIDATION_ERROR',
        message: 'Pattern must not be empty',
      });
    }

    if (!Number.isInteger(maxResults) || maxResults <= 0) {
      return err({
        code: 'VALIDATION_ERROR',
        message: 'maxResults must be a positive integer',
      });
    }

    const args: string[] = ['--json'];

    if (include) {
      args.push('--glob', include);
    }

    if (exclude) {
      args.push('--glob', `!${exclude}`);
    }

    args.push(pattern, searchPath);

    const binaryPath = getRipgrepPath();
    const binaryResult = await executeBinary(binaryPath, args);

    if (!binaryResult.ok) {
      if (binaryResult.error.code === 'BINARY_NOT_FOUND') {
        return err(binaryResult.error);
      }

      const stderr = getStderrFromErrorDetails(binaryResult.error.details);
      if (isInvalidRegexError(stderr)) {
        return err({
          code: 'VALIDATION_ERROR',
          message: `Invalid regex: ${stderr.trim()}`,
          details: binaryResult.error.details,
        });
      }

      return err({
        code: 'TOOL_EXECUTION_FAILED',
        message: binaryResult.error.message,
        details: binaryResult.error.details,
      });
    }

    const output = binaryResult.data.stdout;
    if (output.trim() === '') {
      return ok('');
    }

    const lines = output.split('\n');
    const matches: string[] = [];

    for (const line of lines) {
      if (line.trim() === '') {
        continue;
      }

      try {
        const parsed = JSON.parse(line) as unknown;
        if (!isMatchEvent(parsed)) {
          continue;
        }

        const filePath = decodeTextField(parsed.data.path);
        const matchedLineRaw = decodeTextField(parsed.data.lines);
        const lineNumber = parsed.data.line_number ?? 0;

        const matchedLine = matchedLineRaw.replace(/[\r\n]+$/g, '');
        matches.push(`${filePath}:${lineNumber}: ${matchedLine}`);

        if (matches.length >= maxResults) {
          break;
        }
      } catch {
        continue;
      }
    }

    return ok(matches.join('\n'));
  },
};
