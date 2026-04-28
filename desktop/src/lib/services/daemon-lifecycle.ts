import { Command } from '@tauri-apps/plugin-shell';
import { getDaemonClient, DAEMON_URL } from '$lib/daemon/client.js';
import { settingsStore } from '$lib/stores/settings.svelte.js';

export type DaemonLifecycleStatus = 'running' | 'stopped' | 'unknown' | 'starting' | 'stopping';

// Cached absolute path to server-entry.ts, learned at runtime.
let cachedEntryPath: string | null = null;

// ─── Entry path resolution ───────────────────────────────────────────────────

/**
 * Ask the running daemon for its entry path via /health (works once the
 * new daemon code is deployed). Falls back to reading /proc/<pid>/cmdline
 * + /proc/<pid>/environ via a bun one-liner so it works even with an older
 * daemon binary that doesn't yet expose entryPath in /health.
 */
async function resolveEntryPath(): Promise<string | null> {
	// Strategy 1: /health response (new daemon builds)
	try {
		const client = getDaemonClient();
		const health = await client.checkHealth();
		if (health.entryPath) {
			return health.entryPath;
		}
	} catch {
		// Daemon not responding — fall through
	}

	// Strategy 2: read /proc/<pid>/cmdline and /proc/<pid>/environ via bun.
	// The PID file lives at ~/.elefant/daemon.pid (hardcoded in pid.ts).
	// bun is already in our shell scope so no new capability is needed.
	try {
		const script = [
			`const fs = require('fs');`,
			`const home = process.env.HOME;`,
			`const pid = fs.readFileSync(home + '/.elefant/daemon.pid', 'utf8').trim();`,
			// argv[1] from cmdline (null-separated): index 1 is the script path
			`const cmdline = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').split('\\0');`,
			`const scriptArg = cmdline[1] ?? '';`,
			// If it's already absolute we're done; otherwise combine with PWD
			`if (scriptArg.startsWith('/')) { process.stdout.write(scriptArg); process.exit(0); }`,
			`const env = fs.readFileSync('/proc/' + pid + '/environ', 'utf8').split('\\0');`,
			`const pwdEntry = env.find(e => e.startsWith('PWD='));`,
			`const pwd = pwdEntry ? pwdEntry.slice(4) : '';`,
			`process.stdout.write(pwd + '/' + scriptArg);`,
		].join(' ');

		const cmd = Command.create('bun', ['-e', script]);
		const output = await cmd.execute();
		const path = output.stdout.trim();
		if (path && path.includes('server-entry')) {
			return path;
		}
	} catch {
		// /proc not available or bun failed
	}

	return null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function getDaemonStatus(): Promise<DaemonLifecycleStatus> {
	try {
		const client = getDaemonClient();
		const health = await client.checkHealth();
		if (health.entryPath) cachedEntryPath = health.entryPath;
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
		cachedEntryPath = await resolveEntryPath();
	}
	if (!cachedEntryPath) {
		throw new Error('Cannot locate daemon entry point. Is the daemon process running?');
	}

	// Use spawn() not execute() — the daemon runs forever so execute() would
	// block until Tauri kills it. spawn() fires-and-forgets the process.
	const command = Command.create('bun', [cachedEntryPath]);
	await command.spawn();

	// Poll /health until the daemon is accepting connections (up to 10s).
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		await new Promise<void>((r) => setTimeout(r, 400));
		try {
			const client = getDaemonClient();
			const health = await client.checkHealth();
			if (health.ok) return; // up
		} catch {
			// not yet
		}
	}
	throw new Error('Daemon did not respond within 10 seconds of starting.');
}

export async function restartDaemon(): Promise<void> {
	// Resolve entry path while the daemon is still alive.
	cachedEntryPath = await resolveEntryPath();

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
