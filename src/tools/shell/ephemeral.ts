import type { ElefantError } from '../../types/errors.js';
import type { Result } from '../../types/result.js';
import { err, ok } from '../../types/result.js';
import type { ShellResult } from './session.js';
import { resolveShellPath } from './session.js';

const DEFAULT_TIMEOUT_MS = 120_000;

export interface EphemeralOptions {
	cwd?: string;
	env?: Record<string, string>;
	timeoutMs?: number;
}

class EphemeralTimeoutError extends Error {
	public constructor(timeoutMs: number) {
		super(`Shell command timed out after ${timeoutMs}ms`);
		this.name = 'EphemeralTimeoutError';
	}
}

function createShellError(code: ElefantError['code'], message: string, details?: unknown): ElefantError {
	return {
		code,
		message,
		details,
	};
}

function normalizeOutput(value: string): string {
	return value.replace(/\r?\n$/, '');
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	return await Promise.race([
		promise,
		Bun.sleep(timeoutMs).then(() => {
			throw new EphemeralTimeoutError(timeoutMs);
		}),
	]);
}

function buildSpawnEnv(overrides: Record<string, string> | undefined): Record<string, string> {
	const baseEntries = Object.entries(process.env).filter((entry): entry is [string, string] => {
		return typeof entry[1] === 'string';
	});

	const env = Object.fromEntries(baseEntries);
	return overrides ? { ...env, ...overrides } : env;
}

export async function executeEphemeral(
	command: string,
	options: EphemeralOptions = {},
): Promise<Result<ShellResult, ElefantError>> {
	const shellPath = resolveShellPath();
	if (shellPath === null) {
		return err(createShellError('TOOL_EXECUTION_FAILED', 'No supported shell found at /bin/bash or /bin/sh'));
	}

	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const processHandle = Bun.spawn([shellPath, '-c', command], {
		cwd: options.cwd,
		env: buildSpawnEnv(options.env),
		stdout: 'pipe',
		stderr: 'pipe',
	});

	const stdoutPromise = processHandle.stdout ? new Response(processHandle.stdout).text() : Promise.resolve('');
	const stderrPromise = processHandle.stderr ? new Response(processHandle.stderr).text() : Promise.resolve('');

	try {
		const exitCode = await runWithTimeout(processHandle.exited, timeoutMs);
		const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

		return ok({
			stdout: normalizeOutput(stdout),
			stderr: normalizeOutput(stderr),
			exitCode,
		});
	} catch (error) {
		if (error instanceof EphemeralTimeoutError) {
			processHandle.kill('SIGKILL');
			return err(
				createShellError('SHELL_TIMEOUT', error.message, {
					timeoutMs,
					command,
				}),
			);
		}

		return err(
			createShellError('TOOL_EXECUTION_FAILED', 'Ephemeral shell command failed', {
				command,
				error: error instanceof Error ? error.message : String(error),
			}),
		);
	}
}
