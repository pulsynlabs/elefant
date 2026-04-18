import { describe, expect, it } from 'bun:test';

import { emit } from './emit.ts';
import { HookRegistry } from './registry.ts';

describe('hook context chaining', () => {
	it('merges partial result and passes updated context to next handler', async () => {
		const registry = new HookRegistry();
		const seenToolNames: string[] = [];

		registry.register('tool:before', async () => {
			return { toolName: 'modified' };
		});

		registry.register('tool:before', async (context) => {
			seenToolNames.push(context.toolName);
		});

		const result = await emit(registry, 'tool:before', {
			toolName: 'original',
			args: { command: 'pwd' },
			conversationId: 'conv-chain-1',
		});

		expect(seenToolNames).toEqual(['modified']);
		expect(result.toolName).toBe('modified');
		expect(result.conversationId).toBe('conv-chain-1');
	});
});
