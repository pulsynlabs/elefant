// Project event SSE subscription
//
// Subscribes to the daemon's per-project event stream at
// GET /api/projects/:id/events. Supports the typed event names fired by
// the daemon (session lifecycle, permission/tool events, compaction,
// workflow status) while remaining permissive for future event types.

export type ProjectEventType =
	| 'session:start'
	| 'session:end'
	| 'session:compact'
	| 'permission:ask'
	| 'tool:allow'
	| 'tool:block'
	| 'compaction'
	| 'workflow:status'
	| 'message'
	| string;

export interface ProjectEvent {
	event: ProjectEventType;
	data: unknown;
	id?: string;
}

export type ProjectEventHandler = (event: ProjectEvent) => void;

const KNOWN_EVENT_NAMES: readonly ProjectEventType[] = [
	'session:start',
	'session:end',
	'session:compact',
	'permission:ask',
	'tool:allow',
	'tool:block',
	'compaction',
	'workflow:status',
] as const;

/**
 * Subscribe to a project's SSE event stream.
 *
 * Returns a dispose function that closes the underlying EventSource.
 *
 * Note: `EventSource` does not support custom headers; if replay from a
 * `Last-Event-ID` is needed, the browser will send it automatically based on
 * its `lastEventId` tracking. For first-subscription replay with a known
 * cursor, append `?lastEventId=…` as a query param (the daemon honours both).
 */
export function subscribeProjectEvents(
	daemonUrl: string,
	projectId: string,
	onEvent: ProjectEventHandler,
	lastEventId?: string,
): () => void {
	const base = `${daemonUrl}/api/projects/${encodeURIComponent(projectId)}/events`;
	const url = lastEventId ? `${base}?lastEventId=${encodeURIComponent(lastEventId)}` : base;
	const es = new EventSource(url);

	// Default stream (no `event:` field) — emitted as `message`.
	es.onmessage = (e) => {
		try {
			onEvent({ event: 'message', data: JSON.parse(e.data), id: e.lastEventId || undefined });
		} catch {
			// Malformed JSON — drop silently; surface via addEventListener('error') if needed.
		}
	};

	// Typed events fired by the daemon.
	for (const name of KNOWN_EVENT_NAMES) {
		es.addEventListener(name, (e: Event) => {
			const me = e as MessageEvent;
			try {
				onEvent({ event: name, data: JSON.parse(me.data), id: me.lastEventId || undefined });
			} catch {
				// Malformed payload — drop silently.
			}
		});
	}

	return () => {
		es.close();
	};
}
