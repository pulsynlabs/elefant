import { daemonStatus, startDaemon, stopDaemon } from '../src/daemon/lifecycle.ts';
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

async function runRestart(_args: string[]): Promise<number> {
	// Task 1.4: stop then start
	console.log('elefant restart: not yet implemented');
	return 0;
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
	// Task 1.5: print rebuild/reinstall instructions
	console.log('elefant update: not yet implemented');
	return 0;
}

async function runUninstall(_args: string[]): Promise<number> {
	// Task 1.6: stop daemon + remove binary from known install path
	console.log('elefant uninstall: not yet implemented');
	return 0;
}

async function runServe(_args: string[]): Promise<number> {
	// Wave 2, Task 2.3: browser-mode static server
	console.log('elefant serve: not yet implemented');
	return 0;
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
