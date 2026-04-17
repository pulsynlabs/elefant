import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { daemonStatus, startDaemon } from './lifecycle.ts';
import { removePid, writePid } from './pid.ts';

const PID_FILE_OVERRIDE_ENV = 'ELEFANT_DAEMON_PID_FILE';

let tempDirPath = '';
let pidFilePath = '';

beforeEach(async () => {
	tempDirPath = await mkdtemp(join(tmpdir(), 'elefant-lifecycle-test-'));
	pidFilePath = join(tempDirPath, 'daemon.pid');
	process.env[PID_FILE_OVERRIDE_ENV] = pidFilePath;
	await removePid();
});

afterEach(async () => {
	delete process.env[PID_FILE_OVERRIDE_ENV];
	await removePid();

	if (tempDirPath.length > 0) {
		await rm(tempDirPath, { recursive: true, force: true });
	}
});

describe('lifecycle', () => {
	it('daemonStatus reports stopped when no PID file exists', async () => {
		const status = await daemonStatus();
		expect(status.running).toBe(false);
		expect(status.pid).toBeUndefined();
	});

	it('startDaemon returns clear error when daemon is already running', async () => {
		const writeResult = await writePid(process.pid);
		expect(writeResult.ok).toBe(true);

		const startResult = await startDaemon();
		expect(startResult.ok).toBe(false);
		if (startResult.ok) {
			throw new Error('Expected double-start attempt to fail');
		}

		expect(startResult.error.message).toContain('already running');
		expect(startResult.error.code).toBe('VALIDATION_ERROR');
	});
});
