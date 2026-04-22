import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { acquireDaemonLock, isRunning, readPid, removePid, writePid } from './pid.ts';

const PID_FILE_OVERRIDE_ENV = 'ELEFANT_DAEMON_PID_FILE';

let tempDirPath = '';
let pidFilePath = '';

beforeEach(async () => {
	tempDirPath = await mkdtemp(join(tmpdir(), 'elefant-pid-test-'));
	pidFilePath = join(tempDirPath, 'daemon.pid');
	process.env[PID_FILE_OVERRIDE_ENV] = pidFilePath;
});

afterEach(async () => {
	delete process.env[PID_FILE_OVERRIDE_ENV];

	if (tempDirPath.length > 0) {
		await rm(tempDirPath, { recursive: true, force: true });
	}
});

describe('pid', () => {
	it('writePid and readPid roundtrip the process ID', async () => {
		const writeResult = await writePid(process.pid);
		expect(writeResult.ok).toBe(true);

		const readResult = await readPid();
		expect(readResult.ok).toBe(true);
		if (!readResult.ok) {
			throw new Error('Expected readPid to succeed');
		}

		expect(readResult.data).toBe(process.pid);
	});

	it('removePid deletes the PID file', async () => {
		await writePid(process.pid);

		const removeResult = await removePid();
		expect(removeResult.ok).toBe(true);

		const readResult = await readPid();
		expect(readResult.ok).toBe(false);
		if (readResult.ok) {
			throw new Error('Expected readPid to fail for removed PID file');
		}

		expect(readResult.error.code).toBe('FILE_NOT_FOUND');
	});

	it('stale PID detection: PID file exists but process is not running', async () => {
		const stalePid = 99_999_999;
		const writeResult = await writePid(stalePid);
		expect(writeResult.ok).toBe(true);

		const readResult = await readPid();
		expect(readResult.ok).toBe(true);
		if (!readResult.ok) {
			throw new Error('Expected stale PID file to be readable');
		}

		expect(isRunning(readResult.data)).toBe(false);

		const cleanupResult = await removePid();
		expect(cleanupResult.ok).toBe(true);
	});

	it('acquireDaemonLock prevents second acquisition while held', () => {
		const first = acquireDaemonLock();
		expect(first.ok).toBe(true);
		if (!first.ok) {
			throw new Error('Expected first daemon lock acquisition to succeed');
		}

		const second = acquireDaemonLock();
		expect(second.ok).toBe(false);
		if (second.ok) {
			throw new Error('Expected second daemon lock acquisition to fail');
		}

		expect(second.error.code).toBe('VALIDATION_ERROR');
		expect(second.error.details).toEqual(
			expect.objectContaining({
				pid: process.pid,
			}),
		);

		first.data.release();
	});

	it('acquireDaemonLock reclaims stale lock from dead PID', () => {
		writeFileSync(pidFilePath, '99999999\n', 'utf8');

		const lockResult = acquireDaemonLock();
		expect(lockResult.ok).toBe(true);
		if (!lockResult.ok) {
			throw new Error('Expected stale daemon lock to be reclaimed');
		}

		lockResult.data.release();
	});

	it('acquireDaemonLock release removes lock file', async () => {
		const lockResult = acquireDaemonLock();
		expect(lockResult.ok).toBe(true);
		if (!lockResult.ok) {
			throw new Error('Expected daemon lock acquisition to succeed');
		}

		lockResult.data.release();

		const readResult = await readPid();
		expect(readResult.ok).toBe(false);
		if (readResult.ok) {
			throw new Error('Expected lockfile to be removed by release');
		}

		expect(readResult.error.code).toBe('FILE_NOT_FOUND');
	});
});
