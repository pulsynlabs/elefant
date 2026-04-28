import { Command } from '@tauri-apps/plugin-shell';
import { getDaemonClient, DAEMON_URL } from '$lib/daemon/client.js';
import { settingsStore } from '$lib/stores/settings.svelte.js';

export type DaemonLifecycleStatus = 'running' | 'stopped' | 'unknown' | 'starting' | 'stopping';

// Cache the daemon's own entry path, learned from /health while it's running.
// Once we've seen it once we can restart even after a stop.
let cachedEntryPath: string | null = null;

export async function getDaemonStatus(): Promise<DaemonLifecycleStatus> {
	try {
		const client = getDaemonClient();
		const health = await client.checkHealth();
		if (health.ok && health.entryPath) {
			cachedEntryPath = health.entryPath;
		}
		return health.ok ? 'running' : 'stopped';
	} catch {
		return 'stopped';
	}
}

export async function stopDaemon(): Promise<void> {
	const baseUrl = settingsStore.daemonUrl || DAEMON_URL;
	const response = await fetch(`${baseUrl}/api/daemon/shutdown`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
	});
	if (!response.ok) {
		const text = await response.text().catch(() => `HTTP ${response.status}`);
		throw new Error(`Shutdown failed: ${text}`);
	}
}

export async function startDaemon(): Promise<void> {
	if (!cachedEntryPath) {
		// One last attempt — maybe the daemon is actually running and we just
		// haven't called getDaemonStatus yet this session.
		await getDaemonStatus();
	}
	if (!cachedEntryPath) {
		throw new Error(
			'Cannot start: daemon entry path unknown. The daemon must be started at least once manually before the app can restart it.',
		);
	}

	const command = Command.create('bun', [cachedEntryPath]);
	const output = await command.execute();
	if (output.code !== null && output.code !== 0) {
		const msg = (output.stderr || output.stdout).trim();
		throw new Error(`Daemon failed to start (exit ${output.code}): ${msg}`);
	}
}

export async function restartDaemon(): Promise<void> {
	// Learn the entry path before stopping (while the daemon is still answering).
	await getDaemonStatus();

	try {
		await stopDaemon();
		await new Promise<void>((r) => setTimeout(r, 1500));
	} catch {
		// Already stopped
	}
	await startDaemon();
}

export const daemonLifecycle = {
	startDaemon,
	stopDaemon,
	restartDaemon,
	getDaemonStatus,
};
