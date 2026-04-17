#!/usr/bin/env bun

import { daemonStatus, startDaemon, stopDaemon } from '../src/daemon/lifecycle.ts';

type Command = 'start' | 'stop' | 'status';

function isCommand(value: string | undefined): value is Command {
	return value === 'start' || value === 'stop' || value === 'status';
}

function printUsage(): void {
	console.log('Usage: elefant <start|stop|status>');
}

async function run(): Promise<number> {
	const command = process.argv[2];

	if (!isCommand(command)) {
		printUsage();
		return 1;
	}

	if (command === 'start') {
		const result = await startDaemon();
		if (!result.ok) {
			console.error(result.error.message);
			return 1;
		}

		console.log(`Elefant daemon started (PID ${result.data.pid})`);
		return 0;
	}

	if (command === 'stop') {
		const result = await stopDaemon();
		if (!result.ok) {
			console.error(result.error.message);
			return 1;
		}

		console.log('Elefant daemon stopped');
		return 0;
	}

	const status = await daemonStatus();
	if (!status.running) {
		console.log('Elefant daemon is not running');
		return 0;
	}

	console.log(`Elefant daemon is running (PID ${status.pid})`);
	return 0;
}

const exitCode = await run();
process.exit(exitCode);
