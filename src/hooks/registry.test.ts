import { describe, expect, it } from 'bun:test';

import { emit } from './emit.ts';
import { HookRegistry } from './registry.ts';

describe('HookRegistry', () => {
	it('register returns disposer and disposed handler is not called', async () => {
		const registry = new HookRegistry();
		let calls = 0;

		const dispose = registry.register('tool:before', async () => {
			calls += 1;
		});

		dispose();

		await emit(registry, 'tool:before', {
			toolName: 'bash',
			args: { command: 'pwd' },
			conversationId: 'conv-1',
		});

		expect(calls).toBe(0);
	});

	it('multiple handlers run in registration order', async () => {
		const registry = new HookRegistry();
		const calls: number[] = [];

		registry.register('tool:before', async () => {
			calls.push(1);
		});
		registry.register('tool:before', async () => {
			calls.push(2);
		});
		registry.register('tool:before', async () => {
			calls.push(3);
		});

		await emit(registry, 'tool:before', {
			toolName: 'read',
			args: { filePath: '/tmp/file.txt' },
			conversationId: 'conv-2',
		});

		expect(calls).toEqual([1, 2, 3]);
	});

	it('handlers are event-scoped and not called for other events', async () => {
		const registry = new HookRegistry();
		let beforeCalls = 0;
		let afterCalls = 0;

		registry.register('tool:before', async () => {
			beforeCalls += 1;
		});

		registry.register('message:after', async () => {
			afterCalls += 1;
		});

		await emit(registry, 'message:after', {
			messages: [
				{
					role: 'user',
					content: 'hello',
				},
			],
			provider: 'openai',
			model: 'gpt-4.1',
			durationMs: 12,
		});

		expect(beforeCalls).toBe(0);
		expect(afterCalls).toBe(1);
	});

	it('higher priority handlers run before lower priority handlers', async () => {
		const registry = new HookRegistry();
		const calls: number[] = [];

		const handler = async () => {
			calls.push(100);
		};

		registry.register('tool:before', handler, { priority: 100 });
		registry.register(
			'tool:before',
			async () => {
				calls.push(10);
			},
			{ priority: 10 },
		);

		await emit(registry, 'tool:before', {
			toolName: 'bash',
			args: { command: 'pwd' },
			conversationId: 'conv-priority',
		});

		expect(calls).toEqual([10, 100]);
	});
});
