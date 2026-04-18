import { describe, expect, it } from 'bun:test';

import { emit } from './emit.ts';
import { HookRegistry } from './registry.ts';

describe('hook priority ordering', () => {
	it('runs handlers by ascending priority', async () => {
		const registry = new HookRegistry();
		const order: number[] = [];

		registry.register(
			'tool:before',
			async () => {
				order.push(50);
			},
			{ priority: 50 },
		);
		registry.register(
			'tool:before',
			async () => {
				order.push(10);
			},
			{ priority: 10 },
		);
		registry.register(
			'tool:before',
			async () => {
				order.push(100);
			},
			{ priority: 100 },
		);

		await emit(registry, 'tool:before', {
			toolName: 'read',
			args: { filePath: '/tmp/demo.txt' },
			conversationId: 'conv-priority-1',
		});

		expect(order).toEqual([10, 50, 100]);
	});
});
