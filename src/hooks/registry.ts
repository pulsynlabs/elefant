import type { Disposer, HookEventName, HookHandler } from './types.ts';
import { HOOK_EVENT_NAMES } from './types.ts';

type HandlerEntry<E extends HookEventName> = {
	handler: HookHandler<E>;
	priority: number;
	seq: number;
};

type HandlerStore = {
	[E in HookEventName]: Array<HandlerEntry<E>>;
};

function createEmptyStore(): HandlerStore {
	return {
		'tool:before': [],
		'tool:after': [],
		'message:before': [],
		'message:after': [],
		'stream:start': [],
		'stream:end': [],
		shutdown: [],
		'project:open': [],
		'project:close': [],
		'session:start': [],
		'session:end': [],
		'session:compact': [],
		'context:transform': [],
		'system:transform': [],
		'permission:ask': [],
		'tool:block': [],
		'tool:allow': [],
	};
}

export class HookRegistry {
	private readonly handlers: HandlerStore;
	private seqCounter = 0;

	public constructor() {
		this.handlers = createEmptyStore();
	}

	public register<E extends HookEventName>(
		event: E,
		handler: HookHandler<E>,
		options?: { priority?: number },
	): Disposer {
		const eventHandlers = this.handlers[event] as Array<HandlerEntry<E>>;
		const entry: HandlerEntry<E> = {
			handler,
			priority: options?.priority ?? 100,
			seq: this.seqCounter,
		};
		this.seqCounter += 1;

		eventHandlers.push(entry);
		eventHandlers.sort((left, right) => {
			if (left.priority === right.priority) {
				return left.seq - right.seq;
			}

			return left.priority - right.priority;
		});

		let disposed = false;
		return () => {
			if (disposed) {
				return;
			}

			disposed = true;
			const index = eventHandlers.indexOf(entry);
			if (index !== -1) {
				eventHandlers.splice(index, 1);
			}
		};
	}

	public getHandlers<E extends HookEventName>(event: E): readonly HookHandler<E>[] {
		const eventHandlers = this.handlers[event] as Array<HandlerEntry<E>>;
		return eventHandlers.map((entry) => entry.handler);
	}

	public clear(): void {
		for (const event of HOOK_EVENT_NAMES) {
			this.handlers[event].length = 0;
		}
	}
}
