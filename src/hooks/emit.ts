import type { HookContextMap, HookEventName } from './types.ts';
import type { HookRegistry } from './registry.ts';

export interface EmitOptions {
	timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function resolveTimeout(options?: EmitOptions): number {
	if (options?.timeoutMs !== undefined) {
		return options.timeoutMs;
	}

	const envTimeout = process.env.ELEFANT_HOOK_TIMEOUT_MS;
	if (envTimeout !== undefined) {
		const parsed = Number.parseInt(envTimeout, 10);
		if (!Number.isNaN(parsed) && parsed > 0) {
			return parsed;
		}
	}

	return DEFAULT_TIMEOUT_MS;
}

export async function emit<E extends HookEventName>(
	registry: HookRegistry,
	event: E,
	context: HookContextMap[E],
	options?: EmitOptions,
): Promise<HookContextMap[E]> {
	let ctx = { ...context } as HookContextMap[E];
	const handlers = registry.getHandlers(event);
	const timeoutMs = resolveTimeout(options);

	for (const handler of handlers) {
		let timeoutId: ReturnType<typeof setTimeout> | undefined;

		try {
			const timeoutPromise = new Promise<undefined>((resolve) => {
				timeoutId = setTimeout(() => {
					console.warn(
						`[elefant] Hook handler timed out (event=${event as string}, timeoutMs=${timeoutMs})`,
					);
					resolve(undefined);
				}, timeoutMs);
			});

			const result = await Promise.race([handler(ctx), timeoutPromise]);
			clearTimeout(timeoutId);

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
			clearTimeout(timeoutId);
			console.error(`[elefant] Hook handler error (${event}):`, error);
		}
	}

	return ctx;
}
