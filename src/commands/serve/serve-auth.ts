import os from 'node:os';
import path from 'node:path';
import { chmod, mkdir, unlink } from 'node:fs/promises';
import type { ElefantError } from '../../types/errors.ts';
import { err, ok, type Result } from '../../types/result.ts';

export interface ServeAuth {
  username: string;
  passwordHash: string;
  createdAt: string;
}

export function getServeAuthPath(): string {
  return path.join(os.homedir(), '.elefant', 'serve-auth.json');
}

export async function loadServeAuth(): Promise<Result<ServeAuth, ElefantError>> {
  const authPath = getServeAuthPath();
  const file = Bun.file(authPath);

  if (!(await file.exists())) {
    return err({
      code: 'FILE_NOT_FOUND',
      message: 'No auth credentials configured. Run: elefant auth set <user> <pass>',
    });
  }

  try {
    const data = (await file.json()) as ServeAuth;
    if (!data.username || !data.passwordHash) {
      return err({
        code: 'VALIDATION_ERROR',
        message: 'Malformed serve-auth.json — missing username or passwordHash',
      });
    }

    return ok(data);
  } catch (error) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: `Failed to read serve-auth.json: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export async function writeServeAuth(
  username: string,
  password: string,
): Promise<Result<void, ElefantError>> {
  const authPath = getServeAuthPath();

  try {
    await mkdir(path.dirname(authPath), { recursive: true, mode: 0o700 });
    const passwordHash = await Bun.password.hash(password);
    const data: ServeAuth = {
      username,
      passwordHash,
      createdAt: new Date().toISOString(),
    };

    await Bun.write(authPath, JSON.stringify(data, null, 2));
    await chmod(authPath, 0o600);
    return ok(undefined);
  } catch (error) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: `Failed to write serve-auth.json: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export async function clearServeAuth(): Promise<Result<void, ElefantError>> {
  const authPath = getServeAuthPath();

  try {
    await unlink(authPath);
    return ok(undefined);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ok(undefined);
    }

    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: `Failed to clear serve-auth.json: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
