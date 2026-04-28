import { Command } from '@tauri-apps/plugin-shell';
import { getDaemonClient } from '$lib/daemon/client.js';

export type DaemonLifecycleStatus = 'running' | 'stopped' | 'unknown' | 'starting' | 'stopping';

async function runCommand(program: string, args: string[]): Promise<string> {
	const command = Command.create(program, args);
	const output = await command.execute();
	if (output.code !== 0) {
		throw new Error(
			`Command failed (exit ${String(output.code)}): ${output.stderr || output.stdout}`,
		);
	}
	return output.stdout;
}

export async function startDaemon(): Promise<void> {
	const bunPath = 'bun';

	try {
		await runCommand(bunPath, ['run', 'bin/elefant.ts', 'start']);
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Failed to start daemon: ${errMsg}. Make sure Bun is installed and the project directory is configured.`,
		);
	}
}

export async function stopDaemon(): Promise<void> {
	const bunPath = 'bun';

	try {
		await runCommand(bunPath, ['run', 'bin/elefant.ts', 'stop']);
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to stop daemon: ${errMsg}`);
	}
}

export async function getDaemonStatus(): Promise<DaemonLifecycleStatus> {
	try {
		const client = getDaemonClient();
		const health = await client.checkHealth();
		return health.ok ? 'running' : 'stopped';
	} catch {
		return 'stopped';
	}
}

export async function restartDaemon(): Promise<void> {
	// Best-effort stop — ignore errors if already stopped
	try {
		await stopDaemon();
		await new Promise<void>((r) => setTimeout(r, 1000));
	} catch {
		// Already stopped — proceed to start
	}
	await startDaemon();
}

export const daemonLifecycle = {
	startDaemon,
	stopDaemon,
	restartDaemon,
	getDaemonStatus,
};
