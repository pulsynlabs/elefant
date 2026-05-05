// Current date/time context injector
//
// Injects a single "Current date/time: ..." line into the system prompt
// for every agent dispatch via a `context:transform` handler. Because
// the hook context does not include agent type, injection applies to
// ALL agents — orchestrator and researcher coverage is guaranteed
// without conditional branching.
//
// Failure must never block agent dispatch, so the entire handler body
// is wrapped in try/catch. No external dependencies — uses native
// `Date` + `Intl.DateTimeFormat`.

import type { HookContextMap, HookHandler } from './types.ts';

/**
 * Build a `context:transform` handler that injects the current UTC date/time
 * into the system prompt array. The handler mutates `ctx.system` in place so
 * the change survives without needing a return value.
 *
 * No options required — unlike the PKB hook, this needs no project path or
 * file reader override.
 */
export function createDatetimeContextTransformHandler(): HookHandler<'context:transform'> {
	return async (ctx: HookContextMap['context:transform']) => {
		try {
			const now = new Date();
			const fmt = new Intl.DateTimeFormat('en-US', {
				timeZone: 'UTC',
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				hour12: false,
				weekday: 'long',
			});

			const parts = fmt.formatToParts(now);
			const partMap: Record<string, string> = {};
			for (const { type, value } of parts) {
				if (type !== 'literal') {
					partMap[type] = value;
				}
			}

			// Intl may return '24' for midnight in locales using the h24 cycle.
			// Normalize to '00' so the output is always 00–23.
			let hour = partMap.hour;
			if (hour === '24') {
				hour = '00';
			}

			const formatted =
				`${partMap.year}-${partMap.month}-${partMap.day} ` +
				`${hour}:${partMap.minute}:${partMap.second} UTC (${partMap.weekday})`;

			ctx.system.push(`Current date/time: ${formatted}`);
		} catch {
			// Datetime injection failure should never block agent dispatch.
		}
	};
}
