import { describe, expect, it, mock } from 'bun:test';

import { emit } from './emit.ts';
import { HookRegistry } from './registry.ts';

describe('hook cancellation', () => {
	it('stops chain when handler returns cancel true', async () => {
		const registry = new HookRegistry();
		const secondHandler = mock(() => {
			return undefined;
		});

		registry.register('tool:before', async () => {
			return { cancel: true };
		});
		registry.register('tool:before', async () => {
			secondHandler();
		});

		await emit(registry, 'tool:before', {
			toolName: 'bash',
			args: { command: 'ls' },
			conversationId: 'conv-cancel-1',
		});

		expect(secondHandler).not.toHaveBeenCalled();
	});
});
