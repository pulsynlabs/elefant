import { rgPath } from '@vscode/ripgrep';

import type { ElefantError } from '../types/errors.js';
import type { Result } from '../types/result.js';
import { err, ok } from '../types/result.js';

export function getRipgrepPath(): string {
  return rgPath;
}

export interface BinaryResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function readStreamToString(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) {
    return '';
  }

  return new Response(stream).text();
}

export async function executeBinary(
  binaryPath: string,
  args: string[]
): Promise<Result<BinaryResult, ElefantError>> {
  try {
    const process = Bun.spawn({
      cmd: [binaryPath, ...args],
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      readStreamToString(process.stdout),
      readStreamToString(process.stderr),
      process.exited,
    ]);

    if (exitCode === 0 || exitCode === 1) {
      return ok({
        stdout,
        stderr,
        exitCode,
      });
    }

    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: `Binary execution failed with exit code ${exitCode}`,
      details: {
        binaryPath,
        args,
        stdout,
        stderr,
        exitCode,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('ENOENT') || message.includes('No such file or directory')) {
      return err({
        code: 'BINARY_NOT_FOUND',
        message: `Binary not found: ${binaryPath}`,
        details: {
          binaryPath,
          args,
        },
      });
    }

    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: `Failed to execute binary: ${message}`,
      details: {
        binaryPath,
        args,
      },
    });
  }
}
