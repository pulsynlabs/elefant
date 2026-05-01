import { describe, expect, it } from 'bun:test';
import { handlers, isAllowedInstallPath, isCommand, restartDaemon } from './cli.ts';
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
		// have real side effects and should not be invoked in unit tests.
		const stubCommands: Command[] = [
			'--version',
			'-v',
			'--help',
			'-h',
			'update',
			'uninstall',
			'serve',
		];
		for (const cmd of stubCommands) {
			const result = handlers[cmd]([]);
			expect(result).toBeInstanceOf(Promise);
			expect(result).toHaveProperty('then');
		}
	});

	it('safe commands resolve to a number exit code', async () => {
		// Only test handlers that don't touch the daemon (stubs + version/help)
		const safeCommands: Command[] = [
			'--version',
			'-v',
			'--help',
			'-h',
			'update',
			'uninstall',
			'serve',
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
