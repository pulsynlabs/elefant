import { describe, expect, it, mock } from 'bun:test';

import { emit } from './emit.ts';
import { HookRegistry } from './registry.ts';

describe('emit', () => {
	describe('timeout behavior', () => {
		it('handler that never resolves is skipped after timeout; subsequent handler still runs', async () => {
			const registry = new HookRegistry();
			const effects: string[] = [];
			const warnSpy = mock(() => {});
			const originalConsoleWarn = console.warn;
			console.warn = warnSpy;

			registry.register('shutdown', async () => {
				effects.push('first-start');
				// Never resolves - simulates a hung handler
				await new Promise(() => {});
				effects.push('first-end'); // Should never reach here
			});

			registry.register('shutdown', async () => {
				effects.push('second');
			});

			await emit(
				registry,
				'shutdown',
				{ reason: 'manual' },
				{ timeoutMs: 50 },
			);

			console.warn = originalConsoleWarn;

			expect(effects).toEqual(['first-start', 'second']);
			expect(warnSpy).toHaveBeenCalledTimes(1);
			expect(warnSpy.mock.calls[0][0]).toContain('Hook handler timed out');
			expect(warnSpy.mock.calls[0][0]).toContain('event=shutdown');
			expect(warnSpy.mock.calls[0][0]).toContain('timeoutMs=50');
		});

		it('custom options.timeoutMs overrides default', async () => {
			const registry = new HookRegistry();
			const effects: string[] = [];
			const warnSpy = mock(() => {});
			const originalConsoleWarn = console.warn;
			console.warn = warnSpy;

			registry.register('shutdown', async () => {
				await Bun.sleep(100);
				effects.push('slow-handler');
			});

			// Set timeout to 10ms, handler takes 100ms → should timeout
			await emit(
				registry,
				'shutdown',
				{ reason: 'manual' },
				{ timeoutMs: 10 },
			);

			console.warn = originalConsoleWarn;

			expect(effects).toEqual([]); // Handler was skipped due to timeout
			expect(warnSpy).toHaveBeenCalledTimes(1);
			expect(warnSpy.mock.calls[0][0]).toContain('timeoutMs=10');
		});

		it('env var ELEFANT_HOOK_TIMEOUT_MS is read when no option provided', async () => {
			const registry = new HookRegistry();
			const effects: string[] = [];
			const warnSpy = mock(() => {});
			const originalConsoleWarn = console.warn;
			const originalEnv = process.env.ELEFANT_HOOK_TIMEOUT_MS;

			console.warn = warnSpy;
			process.env.ELEFANT_HOOK_TIMEOUT_MS = '25';

			registry.register('shutdown', async () => {
				await Bun.sleep(100);
				effects.push('slow-handler');
			});

			// No options provided - should use env var (25ms)
			await emit(registry, 'shutdown', { reason: 'manual' });

			console.warn = originalConsoleWarn;
			process.env.ELEFANT_HOOK_TIMEOUT_MS = originalEnv;

			expect(effects).toEqual([]); // Handler was skipped due to timeout
			expect(warnSpy).toHaveBeenCalledTimes(1);
			expect(warnSpy.mock.calls[0][0]).toContain('timeoutMs=25');
		});

		it('handler resolving normally is unaffected (result passed through correctly)', async () => {
			const registry = new HookRegistry();
			const warnSpy = mock(() => {});
			const originalConsoleWarn = console.warn;
			console.warn = warnSpy;

			registry.register('tool:before', async () => {
				return { toolName: 'modified' };
			});

			const result = await emit(
				registry,
				'tool:before',
				{
					toolName: 'original',
					args: { command: 'pwd' },
					conversationId: 'conv-timeout-normal',
				},
				{ timeoutMs: 100 },
			);

			console.warn = originalConsoleWarn;

			expect(result.toolName).toBe('modified');
			expect(warnSpy).not.toHaveBeenCalled(); // No timeout warning
		});

		it('falls back to default 30s when no option or env var provided', async () => {
			const registry = new HookRegistry();
			const effects: string[] = [];
			const warnSpy = mock(() => {});
			const originalConsoleWarn = console.warn;
			const originalEnv = process.env.ELEFANT_HOOK_TIMEOUT_MS;

			console.warn = warnSpy;
			delete process.env.ELEFANT_HOOK_TIMEOUT_MS;

			registry.register('shutdown', async () => {
				await Bun.sleep(10);
				effects.push('fast-handler');
			});

			// No options, no env var - should use default 30s
			await emit(registry, 'shutdown', { reason: 'manual' });

			console.warn = originalConsoleWarn;
			if (originalEnv !== undefined) {
				process.env.ELEFANT_HOOK_TIMEOUT_MS = originalEnv;
			}

			expect(effects).toEqual(['fast-handler']); // Handler completed normally
			expect(warnSpy).not.toHaveBeenCalled(); // No timeout
		});
	});

	it('handler errors do not prevent subsequent handlers from running', async () => {
		const registry = new HookRegistry();
		const calls: number[] = [];
		const errorSpy = mock(() => {});
		const originalConsoleError = console.error;
		console.error = errorSpy;

		registry.register('stream:end', async () => {
			calls.push(1);
		});
		registry.register('stream:end', async () => {
			calls.push(2);
			throw new Error('boom');
		});
		registry.register('stream:end', async () => {
			calls.push(3);
		});

		await emit(registry, 'stream:end', {
			provider: 'anthropic',
			model: 'claude-3.7-sonnet',
			conversationId: 'conv-3',
			totalTokens: 42,
		});

		console.error = originalConsoleError;

		expect(calls).toEqual([1, 2, 3]);
		expect(errorSpy).toHaveBeenCalledTimes(1);
	});

	it('all handlers run even when a middle handler throws', async () => {
		const registry = new HookRegistry();
		const callOrder: string[] = [];

		registry.register('shutdown', async () => {
			callOrder.push('first');
		});
		registry.register('shutdown', async () => {
			callOrder.push('middle');
			throw new Error('expected failure');
		});
		registry.register('shutdown', async () => {
			callOrder.push('last');
		});

		await emit(registry, 'shutdown', {
			reason: 'manual',
		});

		expect(callOrder).toEqual(['first', 'middle', 'last']);
	});

	it('awaits async handlers sequentially', async () => {
		const registry = new HookRegistry();
		let firstCompleted = false;

		registry.register('message:before', async () => {
			await Bun.sleep(20);
			firstCompleted = true;
		});

		registry.register('message:before', async () => {
			expect(firstCompleted).toBe(true);
		});

		await emit(registry, 'message:before', {
			messages: [
				{
					role: 'user',
					content: 'Run the command',
				},
			],
			provider: 'openai',
			model: 'gpt-4.1',
		});
	});

	it('passes typed context to each handler', async () => {
		const registry = new HookRegistry();
		const seenConversationIds: string[] = [];

		registry.register('tool:after', async (context) => {
			seenConversationIds.push(context.conversationId);
			expect(context.toolName).toBe('glob');
			expect(context.result.isError).toBe(false);
		});

		registry.register('tool:after', async (context) => {
			seenConversationIds.push(context.conversationId);
			expect(context.durationMs).toBe(8);
			expect(context.args.pattern).toBe('src/**/*.ts');
		});

		await emit(registry, 'tool:after', {
			toolName: 'glob',
			args: { pattern: 'src/**/*.ts' },
			result: {
				toolCallId: 'call-1',
				content: '[]',
				isError: false,
			},
			durationMs: 8,
			conversationId: 'conv-4',
		});

		expect(seenConversationIds).toEqual(['conv-4', 'conv-4']);
	});
});
