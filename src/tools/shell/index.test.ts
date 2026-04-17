import { afterEach, describe, expect, it } from 'bun:test';

import { bashTool, sessionManager } from './index.js';

afterEach(async () => {
	await sessionManager.closeAll();
});

describe('bashTool', () => {
	it('uses persistent session mode by default', async () => {
		const conversationId = `persistent-${crypto.randomUUID()}`;

		const firstResult = await bashTool.execute({ command: 'cd /tmp', conversationId });
		expect(firstResult.ok).toBe(true);

		const secondResult = await bashTool.execute({ command: 'pwd', conversationId });
		expect(secondResult.ok).toBe(true);
		if (!secondResult.ok) {
			return;
		}

		expect(secondResult.data).toBe('/tmp');
	});

	it('uses ephemeral mode with isolated state when requested', async () => {
		const conversationId = `ephemeral-${crypto.randomUUID()}`;

		const firstResult = await bashTool.execute({
			command: 'cd /tmp && pwd',
			ephemeral: true,
			conversationId,
		});
		expect(firstResult.ok).toBe(true);
		if (!firstResult.ok) {
			return;
		}
		expect(firstResult.data).toBe('/tmp');

		const secondResult = await bashTool.execute({
			command: 'pwd',
			ephemeral: true,
			conversationId,
		});
		expect(secondResult.ok).toBe(true);
		if (!secondResult.ok) {
			return;
		}

		expect(secondResult.data).not.toBe('/tmp');
	});

	it('formats output with stderr content and non-zero exit code', async () => {
		const result = await bashTool.execute({
			command: 'echo stdout && echo stderr 1>&2 && exit 7',
			ephemeral: true,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}

		expect(result.data).toContain('stdout');
		expect(result.data).toContain('stderr');
		expect(result.data).toContain('[Exit code: 7]');
	});
});
