import { loadConfig } from '../config/index.ts';
import { removePid, writePid } from './pid.ts';

const configResult = await loadConfig();
if (!configResult.ok) {
	console.error('[daemon] Failed to load config:', configResult.error.message);
	process.exit(1);
}

const pidWriteResult = await writePid(process.pid);
if (!pidWriteResult.ok) {
	console.error('[daemon] Failed to write PID file:', pidWriteResult.error.message);
	process.exit(1);
}

let shuttingDown = false;

function handleSignal(signal: 'SIGTERM' | 'SIGINT'): void {
	if (shuttingDown) {
		return;
	}

	shuttingDown = true;
	void (async () => {
		console.error(`[daemon] received ${signal}, stopping`);
		await removePid();
		process.exit(0);
	})();
}

process.on('SIGTERM', () => {
	handleSignal('SIGTERM');
});

process.on('SIGINT', () => {
	handleSignal('SIGINT');
});

process.on('exit', () => {
	void removePid();
});

await new Promise(() => {
	// Keep the daemon alive until the server is wired in later waves.
});
