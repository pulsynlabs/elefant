import type { HookRegistry } from '../hooks/registry.ts';
import type { HookContextMap, HookEventName } from '../hooks/types.ts';
import type { SseManager } from './sse-manager.ts';
import type { ElefantWsServer } from './ws-server.ts';

const SPEC_EVENTS = [
	'wf:locked',
	'wf:unlocked',
	'wf:amended',
	'wf:phase_transitioned',
	'blueprint:created',
	'wave:started',
	'wave:completed',
	'task:assigned',
	'task:completed',
] as const satisfies readonly HookEventName[];

type SpecEventName = typeof SPEC_EVENTS[number];
type SpecPayload = HookContextMap[SpecEventName];

export type SpecModeTransportEvent = {
	type: 'spec-mode:event';
	event: SpecEventName;
	payload: SpecPayload;
	timestamp: string;
	projectId: string;
	workflowId: string;
};

function isSpecPayload(payload: unknown): payload is SpecPayload {
	return Boolean(
		payload &&
			typeof payload === 'object' &&
			'projectId' in payload &&
			'workflowId' in payload &&
			typeof (payload as { projectId?: unknown }).projectId === 'string' &&
			typeof (payload as { workflowId?: unknown }).workflowId === 'string',
	);
}

export function registerSpecModeEventPublisher(
	hookRegistry: HookRegistry,
	sseManager: SseManager,
	wsServer: ElefantWsServer,
): void {
	for (const event of SPEC_EVENTS) {
		hookRegistry.on(event, (payload) => {
			try {
				if (!isSpecPayload(payload)) return;

				const envelope: SpecModeTransportEvent = {
					type: 'spec-mode:event',
					event,
					payload,
					timestamp: new Date().toISOString(),
					projectId: payload.projectId,
					workflowId: payload.workflowId,
				};

				// SseManager's current persistence API is session-oriented. Spec-mode
				// lifecycle events are project-scoped, so workflowId is used as the
				// stable event stream key until a dedicated project-event store exists.
				sseManager.publish(payload.projectId, payload.workflowId, 'spec-mode:event', envelope);
				wsServer.broadcastToRoom(`project:${payload.projectId}`, {
					type: 'event',
					event: 'spec_event',
					data: envelope,
				});
			} catch (caught) {
				console.error(`[elefant] Failed to publish spec-mode event ${event}:`, caught);
			}
		});
	}
}
