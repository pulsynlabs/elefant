import os from 'node:os';
import path from 'node:path';
import { unlink } from 'node:fs/promises';

import type { ElefantError } from '../src/types/errors.ts';
import type { Result } from '../src/types/result.ts';

import { daemonStatus, startDaemon, stopDaemon } from '../src/daemon/lifecycle.ts';
import { createBrowserServer, type BindMode } from '../src/commands/serve/index.ts';
import { clearServeAuth, loadServeAuth, writeServeAuth } from '../src/commands/serve/serve-auth.ts';
import pkg from '../package.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// Command union — every subcommand the CLI recognises
// ---------------------------------------------------------------------------

export type Command =
	| 'start'
	| 'stop'
	| 'restart'
	| 'status'
	| 'update'
	| 'uninstall'
	| 'serve'
	| 'auth'
	| '--version'
	| '-v'
	| '--help'
	| '-h';

export function isCommand(value: string | undefined): value is Command {
	return (
		value === 'start' ||
		value === 'stop' ||
		value === 'restart' ||
		value === 'status' ||
		value === 'update' ||
		value === 'uninstall' ||
		value === 'serve' ||
		value === 'auth' ||
		value === '--version' ||
		value === '-v' ||
		value === '--help' ||
		value === '-h'
	);
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function printUsage(): void {
	console.log(`Usage: elefant <command> [options]

Commands:
  start       Start the Elefant daemon
  stop        Stop the Elefant daemon
  restart     Stop then start the daemon
  status      Show daemon status
  serve       Serve the desktop UI in a browser (browser mode)
              Options: --port <n>  --daemon-port <n>  --dist <path>
                       --network   --tailscale[=detect]
  auth        Manage browser-mode authentication credentials
  update      Print self-update instructions
  uninstall   Stop daemon and remove the installed binary
  --version   Print the installed version
  --help      Show this help message`);
}

// ---------------------------------------------------------------------------
// Lifecycle handlers (preserve exact existing output)
// ---------------------------------------------------------------------------

export async function runStart(_args: string[]): Promise<number> {
	const result = await startDaemon();
	if (!result.ok) {
		console.error(result.error.message);
		return 1;
	}
	console.log(`Elefant daemon started (PID ${result.data.pid})`);
	return 0;
}

export async function runStop(_args: string[]): Promise<number> {
	const result = await stopDaemon();
	if (!result.ok) {
		console.error(result.error.message);
		return 1;
	}
	console.log('Elefant daemon stopped');
	return 0;
}

export async function runStatus(_args: string[]): Promise<number> {
	const status = await daemonStatus();
	if (!status.running) {
		console.log('Elefant daemon is not running');
		return 0;
	}
	console.log(`Elefant daemon is running (PID ${status.pid})`);
	return 0;
}

// ---------------------------------------------------------------------------
// New subcommand stubs — implemented in Tasks 1.2–1.6 and Wave 2
// ---------------------------------------------------------------------------

/**
 * Pure restart logic — stop then start.  Takes the two lifecycle functions
 * as parameters so it can be tested without touching the real daemon.
 */
export async function restartDaemon(
	stop: () => Promise<Result<void, ElefantError>>,
	start: () => Promise<Result<{ pid: number }, ElefantError>>,
): Promise<number> {
	const stopResult = await stop();
	if (!stopResult.ok) {
		const isNotRunning =
			stopResult.error.code === 'FILE_NOT_FOUND' ||
			stopResult.error.message.toLowerCase().includes('not running');
		if (isNotRunning) {
			console.log('Daemon was not running; starting fresh.');
		} else {
			console.error(`Failed to stop daemon: ${stopResult.error.message}`);
			return 1;
		}
	}

	const startResult = await start();
	if (!startResult.ok) {
		console.error(startResult.error.message);
		return 1;
	}

	console.log(`Elefant daemon restarted (PID ${startResult.data.pid})`);
	return 0;
}

async function runRestart(_args: string[]): Promise<number> {
	return restartDaemon(stopDaemon, startDaemon);
}

async function runVersion(_args: string[]): Promise<number> {
	console.log(`elefant ${pkg.version}`);
	return 0;
}

async function runHelp(_args: string[]): Promise<number> {
	printUsage();
	return 0;
}

async function runUpdate(_args: string[]): Promise<number> {
	console.log('elefant update\n');
	console.log(`Current version: elefant ${pkg.version}`);
	console.log(`Binary path: ${process.execPath}\n`);
	console.log('To update to the latest version:\n');
	console.log('  1. Pull the latest source:');
	console.log('       git pull origin main\n');
	console.log('  2. Rebuild the CLI binary:');
	console.log('       bun run build:cli\n');
	console.log('  3. Reinstall:');
	console.log('       bash scripts/install.sh\n');
	console.log('Auto-update (download from releases) is coming in a future version.');
	return 0;
}

/**
 * Check whether a binary path is under a known install directory.
 * Only ~/.local/bin and /usr/local/bin are considered safe for removal.
 */
export function isAllowedInstallPath(binaryPath: string, homedir: string): boolean {
	const allowedPrefixes = [
		path.resolve(homedir, '.local', 'bin'),
		'/usr/local/bin',
	];
	return allowedPrefixes.some(
		(prefix) => binaryPath === prefix || binaryPath.startsWith(prefix + path.sep),
	);
}

async function runUninstall(_args: string[]): Promise<number> {
	const binaryPath = process.execPath;
	const home = os.homedir();

	if (!isAllowedInstallPath(binaryPath, home)) {
		console.error(
			`elefant uninstall: refusing to remove binary at '${binaryPath}'.\n` +
				'Only binaries installed under ~/.local/bin or /usr/local/bin can be removed.\n' +
				`To uninstall manually: rm '${binaryPath}'`,
		);
		return 1;
	}

	// Stop daemon first (tolerate "not running")
	const stopResult = await stopDaemon();
	if (!stopResult.ok && stopResult.error.code !== 'FILE_NOT_FOUND') {
		console.error(`elefant uninstall: failed to stop daemon: ${stopResult.error.message}`);
		// Continue anyway — don't block uninstall on a daemon stop failure
	}

	try {
		await unlink(binaryPath);
		console.log(`Removed elefant binary at ${binaryPath}`);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`elefant uninstall: failed to remove binary: ${message}`);
		return 1;
	}
}

export function parseServeArgs(args: string[]): {
  port: number;
  daemonPort: number;
  distPath?: string;
  bindMode: BindMode;
  tailscaleDetectOnly: boolean;
} {
  let port = Number(process.env.ELEFANT_UI_PORT) || 3000;
  let daemonPort = Number(process.env.ELEFANT_DAEMON_PORT) || 1337;
  let distPath: string | undefined;
  let bindMode: BindMode = 'localhost';
  let tailscaleDetectOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = Number(args[++i]);
    } else if (args[i] === '--daemon-port' && args[i + 1]) {
      daemonPort = Number(args[++i]);
    } else if (args[i] === '--dist' && args[i + 1]) {
      distPath = args[++i];
    } else if (args[i] === '--network') {
      bindMode = 'network';
    } else if (args[i] === '--tailscale') {
      bindMode = 'tailscale';
      tailscaleDetectOnly = false;
    } else if (args[i]?.startsWith('--tailscale=')) {
      bindMode = 'tailscale';
      tailscaleDetectOnly = args[i].split('=', 2)[1] === 'detect';
    }
  }

  return { port, daemonPort, distPath, bindMode, tailscaleDetectOnly };
}

async function runServe(args: string[]): Promise<number> {
  const { port, daemonPort, distPath, bindMode, tailscaleDetectOnly } = parseServeArgs(args);

  const result = await createBrowserServer({
    port,
    daemonPort,
    distPath,
    bindMode,
    tailscaleDetectOnly,
  });
  if (!result.ok) {
    console.error(`elefant serve: ${result.error.message}`);
    return 1;
  }

  const { url } = result.data;
  const tsIp = result.data.tailscaleIp;

  // Bind-mode-aware startup message
  switch (bindMode) {
    case 'network':
      console.log(`Elefant UI:  ${url}  (network-accessible)`);
      console.log(`Daemon:      http://localhost:${daemonPort}`);
      break;
    case 'tailscale':
      console.log(`Elefant UI (Tailscale): ${tsIp ? `http://${tsIp}:${port}` : url}`);
      console.log(`Daemon:                 http://localhost:${daemonPort}`);
      break;
    case 'localhost':
    default:
      console.log(`Elefant UI:  ${url}`);
      console.log(`Daemon:      http://localhost:${daemonPort}`);
      break;
  }
  console.log('Press Ctrl+C to stop.');

  // Keep alive until SIGINT/SIGTERM
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      result.data.server.stop();
      resolve();
    });
    process.on('SIGTERM', () => {
      result.data.server.stop();
      resolve();
    });
  });

  return 0;
}

// ---------------------------------------------------------------------------
// Auth subcommand handlers
// ---------------------------------------------------------------------------

export async function runAuthSet(username: string | undefined, password: string | undefined): Promise<number> {
  if (!username || !password) {
    console.log('Usage: elefant auth set <user> <pass>');
    return 1;
  }

  const result = await writeServeAuth(username, password);
  if (!result.ok) {
    console.error(result.error.message);
    return 1;
  }

  console.log(`Auth credentials set for user: ${username}`);
  return 0;
}

export async function runAuthStatus(): Promise<number> {
  const result = await loadServeAuth();

  if (!result.ok) {
    if (result.error.code === 'FILE_NOT_FOUND') {
      console.log('No auth credentials configured. Run: elefant auth set <user> <pass>');
      return 0;
    }
    console.error(result.error.message);
    return 1;
  }

  console.log(`Auth credentials configured for user: ${result.data.username}`);
  return 0;
}

export async function runAuthClear(): Promise<number> {
  const result = await clearServeAuth();

  if (!result.ok) {
    console.error(result.error.message);
    return 1;
  }

  console.log('Auth credentials cleared.');
  return 0;
}

export async function runAuth(args: string[]): Promise<number> {
  const sub = args[0];

  if (sub === 'set') return runAuthSet(args[1], args[2]);
  if (sub === 'status') return runAuthStatus();
  if (sub === 'clear') return runAuthClear();

  console.log('Usage: elefant auth <set <user> <pass>|status|clear>');
  return 1;
}

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

export const handlers: Record<Command, (args: string[]) => Promise<number>> = {
	start: runStart,
	stop: runStop,
	restart: runRestart,
	status: runStatus,
	update: runUpdate,
	uninstall: runUninstall,
	serve: runServe,
	auth: runAuth,
	'--version': runVersion,
	'-v': runVersion,
	'--help': runHelp,
	'-h': runHelp,
};

// ---------------------------------------------------------------------------
// Entry (returns exit code; caller is responsible for process.exit)
// ---------------------------------------------------------------------------

export async function run(): Promise<number> {
	const command = process.argv[2];

	if (!isCommand(command)) {
		printUsage();
		return 1;
	}

	const args = process.argv.slice(3);
	return handlers[command](args);
}
