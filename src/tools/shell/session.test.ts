import { afterEach, describe, expect, it } from 'bun:test';

import { ShellSession } from './session.js';

const ACTIVE_SESSIONS: ShellSession[] = [];

async function createSession(): Promise<ShellSession> {
	const session = new ShellSession(`session-test-${crypto.randomUUID()}`);
	ACTIVE_SESSIONS.push(session);
	return session;
}

afterEach(async () => {
	await Promise.all(
		ACTIVE_SESSIONS.splice(0).map(async (session) => {
			await session.close();
		}),
	);
});

describe('ShellSession', () => {
	it('runs commands and captures stdout', async () => {
		const session = await createSession();

		const result = await session.execute('echo hello');

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}

		expect(result.data.stdout).toBe('hello');
		expect(result.data.stderr).toBe('');
		expect(result.data.exitCode).toBe(0);
	});

	it('preserves cwd between commands', async () => {
		const session = await createSession();

		const cdResult = await session.execute('cd /tmp');
		expect(cdResult.ok).toBe(true);

		const pwdResult = await session.execute('pwd');
		expect(pwdResult.ok).toBe(true);
		if (!pwdResult.ok) {
			return;
		}

		expect(pwdResult.data.stdout).toBe('/tmp');
	});

	it('preserves exported environment variables between commands', async () => {
		const session = await createSession();

		const exportResult = await session.execute('export FOO=test-value');
		expect(exportResult.ok).toBe(true);

		const echoResult = await session.execute('echo $FOO');
		expect(echoResult.ok).toBe(true);
		if (!echoResult.ok) {
			return;
		}

		expect(echoResult.data.stdout).toBe('test-value');
	});

	it('returns SHELL_TIMEOUT for long-running commands', async () => {
		const session = await createSession();

		const result = await session.execute('sleep 10', 500);

		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}

		expect(result.error.code).toBe('SHELL_TIMEOUT');
	});

	it('close() terminates the shell process', async () => {
		const session = await createSession();
		expect(session.isAlive()).toBe(true);

		await session.close();

		expect(session.isAlive()).toBe(false);
	});
});
