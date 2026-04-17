import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { executeEphemeral } from './ephemeral.js';

const TEMP_DIRS: string[] = [];

afterEach(async () => {
	await Promise.all(
		TEMP_DIRS.splice(0).map(async (dirPath) => {
			await rm(dirPath, { recursive: true, force: true });
		}),
	);
});

describe('executeEphemeral', () => {
	it('captures stdout for simple commands', async () => {
		const result = await executeEphemeral('echo hello');

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}

		expect(result.data.stdout).toBe('hello');
		expect(result.data.stderr).toBe('');
		expect(result.data.exitCode).toBe(0);
	});

	it('does not persist cwd across calls', async () => {
		const uniqueDir = await mkdtemp(join(tmpdir(), 'elefant-ephemeral-'));
		TEMP_DIRS.push(uniqueDir);

		const firstResult = await executeEphemeral(`cd "${uniqueDir}" && pwd`);
		expect(firstResult.ok).toBe(true);
		if (!firstResult.ok) {
			return;
		}

		expect(firstResult.data.stdout).toBe(uniqueDir);

		const secondResult = await executeEphemeral('pwd');
		expect(secondResult.ok).toBe(true);
		if (!secondResult.ok) {
			return;
		}

		expect(secondResult.data.stdout).not.toBe(uniqueDir);
	});

	it('returns SHELL_TIMEOUT when command exceeds timeout', async () => {
		const result = await executeEphemeral('sleep 10', { timeoutMs: 500 });

		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}

		expect(result.error.code).toBe('SHELL_TIMEOUT');
	});

	it('captures stdout and stderr separately', async () => {
		const result = await executeEphemeral('echo out && echo err 1>&2');

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}

		expect(result.data.stdout).toBe('out');
		expect(result.data.stderr).toBe('err');
	});
});
