import { fileURLToPath } from 'node:url';

import type { ElefantError } from '../types/errors.ts';
import type { Result } from '../types/result.ts';
import { err, ok } from '../types/result.ts';
import { isRunning, readPid, removePid, writePid } from './pid.ts';

const STOP_TIMEOUT_MS = 10_000;
const STOP_POLL_INTERVAL_MS = 200;

function createLifecycleError(code: ElefantError['code'], message: string, details?: unknown): ElefantError {
	return {
		code,
		message,
		details,
	};
}

async function sleep(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}

function getEntryPath(): string {
	return fileURLToPath(new URL('./server-entry.ts', import.meta.url));
}

function sendSignal(pid: number, signal: NodeJS.Signals): Result<void, ElefantError> {
	try {
		process.kill(pid, signal);
		return ok(undefined);
	} catch (error) {
		if (error instanceof Error && 'code' in error) {
			const signalCode = String(error.code);
			if (signalCode === 'ESRCH') {
				return ok(undefined);
			}

			if (signalCode === 'EPERM') {
				return err(
					createLifecycleError('PERMISSION_DENIED', `Permission denied while sending ${signal} to PID ${pid}`, {
						pid,
						signal,
					}),
				);
			}
		}

		const message = error instanceof Error ? error.message : String(error);
		return err(createLifecycleError('TOOL_EXECUTION_FAILED', `Failed to send ${signal} to PID ${pid}: ${message}`));
	}
}

export async function startDaemon(): Promise<Result<{ pid: number }, ElefantError>> {
	try {
		const currentPidResult = await readPid();
		if (currentPidResult.ok) {
			if (isRunning(currentPidResult.data)) {
				return err(
					createLifecycleError(
						'VALIDATION_ERROR',
						`Elefant daemon is already running (PID ${currentPidResult.data})`,
						{ pid: currentPidResult.data },
					),
				);
			}

			const staleCleanupResult = await removePid();
			if (!staleCleanupResult.ok) {
				return staleCleanupResult;
			}
		} else if (currentPidResult.error.code !== 'FILE_NOT_FOUND') {
			return currentPidResult;
		}

		const subprocess = Bun.spawn([process.execPath, getEntryPath()], {
			detached: true,
			stdio: ['ignore', 'ignore', 'ignore'],
		});
		if (typeof subprocess.unref === 'function') {
			subprocess.unref();
		}

		if (!subprocess.pid || subprocess.pid <= 0) {
			return err(createLifecycleError('TOOL_EXECUTION_FAILED', 'Daemon process did not provide a valid PID'));
		}

		// server-entry.ts owns the PID file via acquireDaemonLock().
		// Do NOT write it here — writing it from the parent causes a conflict:
		// the child's acquireDaemonLock() finds the file already exists, sees
		// the PID as "running", and exits immediately.

		return ok({ pid: subprocess.pid });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return err(createLifecycleError('TOOL_EXECUTION_FAILED', `Failed to start daemon: ${message}`));
	}
}

export async function stopDaemon(): Promise<Result<void, ElefantError>> {
	try {
		const pidResult = await readPid();
		if (!pidResult.ok) {
			if (pidResult.error.code === 'FILE_NOT_FOUND') {
				return ok(undefined);
			}

			return pidResult;
		}

		const pid = pidResult.data;
		if (!isRunning(pid)) {
			const cleanupResult = await removePid();
			if (!cleanupResult.ok) {
				return cleanupResult;
			}

			return ok(undefined);
		}

		const termResult = sendSignal(pid, 'SIGTERM');
		if (!termResult.ok) {
			return termResult;
		}

		const deadline = Date.now() + STOP_TIMEOUT_MS;
		while (Date.now() < deadline) {
			if (!isRunning(pid)) {
				break;
			}

			await sleep(STOP_POLL_INTERVAL_MS);
		}

		if (isRunning(pid)) {
			const killResult = sendSignal(pid, 'SIGKILL');
			if (!killResult.ok) {
				return killResult;
			}
		}

		const cleanupResult = await removePid();
		if (!cleanupResult.ok) {
			return cleanupResult;
		}

		return ok(undefined);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return err(createLifecycleError('TOOL_EXECUTION_FAILED', `Failed to stop daemon: ${message}`));
	}
}

export async function daemonStatus(): Promise<{ running: boolean; pid?: number }> {
	try {
		const pidResult = await readPid();
		if (!pidResult.ok) {
			return { running: false };
		}

		const pid = pidResult.data;
		if (!isRunning(pid)) {
			await removePid();
			return { running: false };
		}

		return {
			running: true,
			pid,
		};
	} catch {
		return { running: false };
	}
}
