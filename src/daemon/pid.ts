import { mkdir, rm } from 'node:fs/promises';
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ElefantError } from '../types/errors.ts';
import type { Result } from '../types/result.ts';
import { err, ok } from '../types/result.ts';

const PID_DIR_NAME = '.elefant';
const PID_FILE_NAME = 'daemon.pid';
const PID_FILE_OVERRIDE_ENV = 'ELEFANT_DAEMON_PID_FILE';

export interface DaemonLock {
	release: () => void;
}

function createError(code: ElefantError['code'], message: string, details?: unknown): ElefantError {
	return {
		code,
		message,
		details,
	};
}

function getHomeDirectory(): string {
	const home = Bun.env.HOME ?? process.env.HOME;
	if (!home) {
		throw new Error('HOME environment variable is not set');
	}

	return home;
}

export function getPidFilePath(): string {
	const overridePath = Bun.env[PID_FILE_OVERRIDE_ENV] ?? process.env[PID_FILE_OVERRIDE_ENV];
	if (overridePath && overridePath.length > 0) {
		return overridePath;
	}

	return join(getHomeDirectory(), PID_DIR_NAME, PID_FILE_NAME);
}

function mapFsError(operation: string, error: unknown): ElefantError {
	if (error instanceof Error && 'code' in error) {
		const fsCode = String(error.code);
		if (fsCode === 'EACCES' || fsCode === 'EPERM') {
			return createError('PERMISSION_DENIED', `Cannot ${operation} PID file`, { operation, fsCode });
		}
	}

	const message = error instanceof Error ? error.message : String(error);
	return createError('TOOL_EXECUTION_FAILED', `Failed to ${operation} PID file: ${message}`, { error: message });
}

function getFsCode(error: unknown): string | null {
	if (error && typeof error === 'object' && 'code' in error) {
		return String((error as { code?: unknown }).code);
	}

	return null;
}

function readPidFromFileSync(path: string): Result<number, ElefantError> {
	try {
		const value = readFileSync(path, 'utf8').trim();
		const pid = Number.parseInt(value, 10);
		if (!Number.isInteger(pid) || pid <= 0) {
			return err(createError('VALIDATION_ERROR', `PID file contains invalid value: "${value}"`, { path, value }));
		}

		return ok(pid);
	} catch (error) {
		const fsCode = getFsCode(error);
		if (fsCode === 'ENOENT') {
			return err(createError('FILE_NOT_FOUND', 'PID file not found', { path }));
		}

		return err(mapFsError('read', error));
	}
}

export function acquireDaemonLock(): Result<DaemonLock, ElefantError> {
	let path: string;
	try {
		path = getPidFilePath();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return err(createError('CONFIG_INVALID', message));
	}

	try {
		mkdirSync(dirname(path), { recursive: true });
	} catch (error) {
		return err(mapFsError('create directory for', error));
	}

	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const fd = openSync(path, 'wx');
			try {
				writeSync(fd, `${process.pid}\n`);
			} finally {
				closeSync(fd);
			}

			return ok({
				release: () => {
					try {
						unlinkSync(path);
					} catch (error) {
						if (getFsCode(error) !== 'ENOENT') {
							// Best-effort cleanup on process exit/signal.
						}
					}
				},
			});
		} catch (error) {
			if (getFsCode(error) !== 'EEXIST') {
				return err(mapFsError('acquire', error));
			}

			const existingPidResult = readPidFromFileSync(path);
			if (existingPidResult.ok) {
				if (isRunning(existingPidResult.data)) {
					return err(
						createError(
							'VALIDATION_ERROR',
							`Elefant daemon is already running (PID ${existingPidResult.data})`,
							{ pid: existingPidResult.data, path },
						),
					);
				}

				try {
					unlinkSync(path);
				} catch (unlinkError) {
					if (getFsCode(unlinkError) !== 'ENOENT') {
						return err(mapFsError('remove stale', unlinkError));
					}
				}

				continue;
			}

			if (existingPidResult.error.code === 'FILE_NOT_FOUND') {
				continue;
			}

			return err(existingPidResult.error);
		}
	}

	return err(createError('TOOL_EXECUTION_FAILED', 'Failed to acquire daemon lock after stale lock cleanup', { path }));
}

export async function writePid(pid: number): Promise<Result<void, ElefantError>> {
	if (!Number.isInteger(pid) || pid <= 0) {
		return err(createError('VALIDATION_ERROR', `Invalid PID value: ${pid}`));
	}

	let path: string;
	try {
		path = getPidFilePath();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return err(createError('CONFIG_INVALID', message));
	}

	try {
		await mkdir(dirname(path), { recursive: true });
		await Bun.write(path, `${pid}\n`);
		return ok(undefined);
	} catch (error) {
		return err(mapFsError('write', error));
	}
}

export async function readPid(): Promise<Result<number, ElefantError>> {
	let path: string;
	try {
		path = getPidFilePath();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return err(createError('CONFIG_INVALID', message));
	}

	try {
		const file = Bun.file(path);
		if (!(await file.exists())) {
			return err(createError('FILE_NOT_FOUND', 'PID file not found', { path }));
		}

		const value = (await file.text()).trim();
		const pid = Number.parseInt(value, 10);
		if (!Number.isInteger(pid) || pid <= 0) {
			return err(createError('VALIDATION_ERROR', `PID file contains invalid value: "${value}"`, { path, value }));
		}

		return ok(pid);
	} catch (error) {
		return err(mapFsError('read', error));
	}
}

export async function removePid(): Promise<Result<void, ElefantError>> {
	let path: string;
	try {
		path = getPidFilePath();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return err(createError('CONFIG_INVALID', message));
	}

	try {
		await rm(path, { force: true });
		return ok(undefined);
	} catch (error) {
		return err(mapFsError('remove', error));
	}
}

export function isRunning(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) {
		return false;
	}

	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
