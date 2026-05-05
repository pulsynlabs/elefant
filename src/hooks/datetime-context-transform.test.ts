import { describe, expect, it } from 'bun:test';

import { createDatetimeContextTransformHandler } from './datetime-context-transform.ts';

describe('createDatetimeContextTransformHandler', () => {
	it('pushes one datetime line to ctx.system', async () => {
		const handler = createDatetimeContextTransformHandler();
		const ctx = { system: [] as string[], sessionId: 'test', phase: 'idle' as const };
		await handler(ctx);

		expect(ctx.system).toHaveLength(1);
		expect(ctx.system[0]).toMatch(
			/^Current date\/time: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC \(\w+\)$/,
		);
	});

	it('does not modify sessionId or phase fields', async () => {
		const handler = createDatetimeContextTransformHandler();
		const ctx = { system: [] as string[], sessionId: 'test', phase: 'idle' as const };
		await handler(ctx);

		expect(ctx.sessionId).toBe('test');
		expect(ctx.phase).toBe('idle');
	});

	it('resolves without throwing even if formatting fails', async () => {
		const handler = createDatetimeContextTransformHandler();
		const ctx = { system: [] as string[], sessionId: 'test2', phase: 'idle' as const };
		await expect(handler(ctx)).resolves.toBeUndefined();
	});
});
