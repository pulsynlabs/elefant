import type { HookContextMap, HookEventName } from './types.ts';
import type { HookRegistry } from './registry.ts';

export async function emit<E extends HookEventName>(
	registry: HookRegistry,
	event: E,
	context: HookContextMap[E],
): Promise<HookContextMap[E]> {
	let ctx = { ...context } as HookContextMap[E];
	const handlers = registry.getHandlers(event);

	for (const handler of handlers) {
		try {
			const result = await handler(ctx);
			if (result == null) {
				continue;
			}

			if (
				typeof result === 'object' &&
				'cancel' in result &&
				result.cancel === true
			) {
				break;
			}

			if (typeof result === 'object') {
				ctx = { ...ctx, ...result };
			}
		} catch (error) {
			console.error(`[elefant] Hook handler error (${event}):`, error);
		}
	}

	return ctx;
}
