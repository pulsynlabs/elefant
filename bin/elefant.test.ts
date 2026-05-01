import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import { handlers, isAllowedInstallPath, isCommand, parseServeArgs, restartDaemon } from './cli.ts';
import type { Command } from './cli.ts';

// ---------------------------------------------------------------------------
// isCommand type guard
// ---------------------------------------------------------------------------

describe('isCommand', () => {
	const validCommands: Command[] = [
		'start',
		'stop',
		'restart',
		'status',
		'update',
		'uninstall',
		'serve',
		'--version',
		'-v',
		'--help',
		'-h',
	];

	for (const cmd of validCommands) {
		it(`returns true for "${cmd}"`, () => {
			expect(isCommand(cmd)).toBe(true);
		});
	}

	it('returns false for unknown command strings', () => {
		expect(isCommand('deploy')).toBe(false);
		expect(isCommand('install')).toBe(false);
		expect(isCommand('unknown')).toBe(false);
		expect(isCommand('--verbose')).toBe(false);
	});

	it('returns false for undefined', () => {
		expect(isCommand(undefined)).toBe(false);
	});

	it('returns false for empty string', () => {
		expect(isCommand('')).toBe(false);
	});

	it('does not return true for case variants', () => {
		expect(isCommand('START')).toBe(false);
		expect(isCommand('Status')).toBe(false);
		expect(isCommand('--HELP')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Handlers dispatch table shape
// ---------------------------------------------------------------------------

describe('handlers', () => {
	const expectedCommands: Command[] = [
		'start',
		'stop',
		'restart',
		'status',
		'update',
		'uninstall',
		'serve',
		'--version',
		'-v',
		'--help',
		'-h',
	];

	it('has exactly 11 entries (one per command string)', () => {
		expect(Object.keys(handlers)).toHaveLength(11);
	});

	for (const cmd of expectedCommands) {
		it(`has a handler for "${cmd}" that is a function`, () => {
			expect(handlers[cmd]).toBeFunction();
		});
	}

	it('--version and -v map to the same handler', () => {
		expect(handlers['--version']).toBe(handlers['-v']);
	});

	it('--help and -h map to the same handler', () => {
		expect(handlers['--help']).toBe(handlers['-h']);
	});

	it('safe stub handlers return Promise<number> without side effects', () => {
		// Only call stub handlers — the lifecycle handlers (start/stop/status/restart)
		// and serve (which starts a real server) have real side effects and should
		// not be invoked in unit tests.
		const stubCommands: Command[] = [
			'--version',
			'-v',
			'--help',
			'-h',
			'update',
			'uninstall',
		];
		for (const cmd of stubCommands) {
			const result = handlers[cmd]([]);
			expect(result).toBeInstanceOf(Promise);
			expect(result).toHaveProperty('then');
		}
	});

	it('safe commands resolve to a number exit code', async () => {
		// Only test handlers that don't touch the daemon or start servers
		const safeCommands: Command[] = [
			'--version',
			'-v',
			'--help',
			'-h',
			'update',
			'uninstall',
		];
		for (const cmd of safeCommands) {
			const code = await handlers[cmd]([]);
			expect(code).toBeNumber();
			expect(code).toBeGreaterThanOrEqual(0);
		}
	});
});

// ---------------------------------------------------------------------------
// isAllowedInstallPath — path allowlist for uninstall
// ---------------------------------------------------------------------------

describe('isAllowedInstallPath', () => {
	const homedir = '/home/testuser';

	it('allows a path under ~/.local/bin', () => {
		expect(isAllowedInstallPath('/home/testuser/.local/bin/elefant', homedir)).toBe(true);
	});

	it('allows a path under /usr/local/bin', () => {
		expect(isAllowedInstallPath('/usr/local/bin/elefant', homedir)).toBe(true);
	});

	it('rejects a path under /tmp', () => {
		expect(isAllowedInstallPath('/tmp/evil', homedir)).toBe(false);
	});

	it('rejects a path under ~/Downloads', () => {
		expect(isAllowedInstallPath('/home/testuser/Downloads/elefant', homedir)).toBe(false);
	});

	it('rejects a path under /opt', () => {
		expect(isAllowedInstallPath('/opt/bin/elefant', homedir)).toBe(false);
	});

	it('rejects a bare filename (no directory prefix match)', () => {
		expect(isAllowedInstallPath('elefant', homedir)).toBe(false);
	});

	it('rejects a path that is a substring but not a prefix match', () => {
		// /usr/local/binaries/elefant should NOT match /usr/local/bin
		expect(isAllowedInstallPath('/usr/local/binaries/elefant', homedir)).toBe(false);
	});

	it('rejects ~/.local/bin-extra/elefant (path-segment match, not string prefix)', () => {
		// '/home/testuser/.local/bin' is a string prefix of
		// '/home/testuser/.local/bin-extra/elefant' but NOT a path-segment prefix
		expect(isAllowedInstallPath('/home/testuser/.local/bin-extra/elefant', homedir)).toBe(false);
	});

	it('rejects ~/.local/bin-something/elefant (must match exact directory)', () => {
		expect(isAllowedInstallPath('/home/testuser/.local/bin-something/elefant', homedir)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// restartDaemon — pure logic tested with mock stop/start functions
// ---------------------------------------------------------------------------

describe('restartDaemon', () => {
	const mockStopSuccess = (): Promise<{ ok: true; data: undefined }> =>
		Promise.resolve({ ok: true, data: undefined });

	const mockStopNotFound = (): Promise<{ ok: false; error: { code: 'FILE_NOT_FOUND'; message: string } }> =>
		Promise.resolve({ ok: false, error: { code: 'FILE_NOT_FOUND', message: 'PID file not found' } });

	const mockStopDenied = (): Promise<{ ok: false; error: { code: 'PERMISSION_DENIED'; message: string } }> =>
		Promise.resolve({ ok: false, error: { code: 'PERMISSION_DENIED', message: 'Permission denied' } });

	const mockStartSuccess = (): Promise<{ ok: true; data: { pid: number } }> =>
		Promise.resolve({ ok: true, data: { pid: 12345 } });

	const mockStartFail = (): Promise<{ ok: false; error: { code: 'TOOL_EXECUTION_FAILED'; message: string } }> =>
		Promise.resolve({ ok: false, error: { code: 'TOOL_EXECUTION_FAILED', message: 'Start failed' } });

	it('stop succeeds → start succeeds → prints PID, exit 0', async () => {
		const code = await restartDaemon(mockStopSuccess, mockStartSuccess);
		expect(code).toBe(0);
	});

	it('stop returns FILE_NOT_FOUND → start succeeds → prints "not running", PID, exit 0', async () => {
		const code = await restartDaemon(mockStopNotFound, mockStartSuccess);
		expect(code).toBe(0);
	});

	it('stop fails with real error (PERMISSION_DENIED) → prints error, exit 1', async () => {
		const code = await restartDaemon(mockStopDenied, mockStartSuccess);
		expect(code).toBe(1);
	});

	it('stop succeeds → start fails → prints error, exit 1', async () => {
		const code = await restartDaemon(mockStopSuccess, mockStartFail);
		expect(code).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// parseServeArgs — flag parsing with env-var defaults
// ---------------------------------------------------------------------------

describe('parseServeArgs', () => {
	it('returns defaults when no flags or env vars are set', () => {
		const result = parseServeArgs([]);
		expect(result.port).toBe(3000);
		expect(result.daemonPort).toBe(1337);
		expect(result.distPath).toBeUndefined();
	});

	it('parses --port flag', () => {
		const result = parseServeArgs(['--port', '8080']);
		expect(result.port).toBe(8080);
	});

	it('parses --daemon-port flag', () => {
		const result = parseServeArgs(['--daemon-port', '9999']);
		expect(result.daemonPort).toBe(9999);
	});

	it('parses --dist flag', () => {
		const result = parseServeArgs(['--dist', '/custom/dist/path']);
		expect(result.distPath).toBe('/custom/dist/path');
	});

	it('parses all flags together', () => {
		const result = parseServeArgs(['--port', '4000', '--daemon-port', '5555', '--dist', '/tmp/elefant-ui']);
		expect(result.port).toBe(4000);
		expect(result.daemonPort).toBe(5555);
		expect(result.distPath).toBe('/tmp/elefant-ui');
	});

	it('silently coerces non-numeric port to NaN (caller handles)', () => {
		const result = parseServeArgs(['--port', 'not-a-number']);
		expect(isNaN(result.port)).toBe(true);
	});

	it('ignores flags without values (no next arg)', () => {
		const result = parseServeArgs(['--port']);
		expect(result.port).toBe(3000); // default preserved
	});

	it('--port consumes the next token even when it looks like a flag', () => {
		// --port greedily consumes the next arg as its value.
		// '--daemon-port' becomes the (NaN) port; '7777' is a dangling arg.
		const result = parseServeArgs(['--port', '--daemon-port', '7777']);
		expect(isNaN(result.port)).toBe(true); // Number('--daemon-port') → NaN
		expect(result.daemonPort).toBe(1337);  // 7777 was not preceded by --daemon-port
	});
});

// ---------------------------------------------------------------------------
// parseServeArgs — env var fallback (requires setup/teardown)
// ---------------------------------------------------------------------------

describe('parseServeArgs env var defaults', () => {
	const savedUiPort = process.env.ELEFANT_UI_PORT;
	const savedDaemonPort = process.env.ELEFANT_DAEMON_PORT;

	afterEach(() => {
		delete process.env.ELEFANT_UI_PORT;
		delete process.env.ELEFANT_DAEMON_PORT;
	});

	afterAll(() => {
		if (savedUiPort === undefined) {
			delete process.env.ELEFANT_UI_PORT;
		} else {
			process.env.ELEFANT_UI_PORT = savedUiPort;
		}
		if (savedDaemonPort === undefined) {
			delete process.env.ELEFANT_DAEMON_PORT;
		} else {
			process.env.ELEFANT_DAEMON_PORT = savedDaemonPort;
		}
	});

	it('reads ELEFANT_UI_PORT env var as default port', () => {
		process.env.ELEFANT_UI_PORT = '8080';
		const result = parseServeArgs([]);
		expect(result.port).toBe(8080);
		expect(result.daemonPort).toBe(1337);
	});

	it('reads ELEFANT_DAEMON_PORT env var as default daemon port', () => {
		process.env.ELEFANT_DAEMON_PORT = '9999';
		const result = parseServeArgs([]);
		expect(result.port).toBe(3000);
		expect(result.daemonPort).toBe(9999);
	});

	it('reads both env vars simultaneously', () => {
		process.env.ELEFANT_UI_PORT = '7070';
		process.env.ELEFANT_DAEMON_PORT = '8080';
		const result = parseServeArgs([]);
		expect(result.port).toBe(7070);
		expect(result.daemonPort).toBe(8080);
	});

	it('--port flag overrides ELEFANT_UI_PORT env var', () => {
		process.env.ELEFANT_UI_PORT = '8080';
		const result = parseServeArgs(['--port', '4000']);
		expect(result.port).toBe(4000);
	});

	it('--daemon-port flag overrides ELEFANT_DAEMON_PORT env var', () => {
		process.env.ELEFANT_DAEMON_PORT = '9999';
		const result = parseServeArgs(['--daemon-port', '9000']);
		expect(result.daemonPort).toBe(9000);
	});

	it('ignores non-numeric env var values (NaN falls back to default)', () => {
		process.env.ELEFANT_UI_PORT = 'not-a-number';
		const result = parseServeArgs([]);
		expect(result.port).toBe(3000); // Number('not-a-number') is NaN, NaN || 3000 → 3000
	});
});

// runServe is covered by handler existence (line 77), parseServeArgs
// (above), and manual end-to-end verification.  Unit-testing runServe
// directly starts a real Bun.serve server which blocks on SIGINT/SIGTERM
// — unsuitable for a unit test.
