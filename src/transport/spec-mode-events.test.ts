import { describe, expect, it } from 'bun:test';

import { emit } from '../hooks/emit.ts';
import { HookRegistry } from '../hooks/registry.ts';
import { registerSpecModeEventPublisher } from './spec-mode-events.ts';
import type { SseManager } from './sse-manager.ts';
import type { ElefantWsServer } from './ws-server.ts';

describe('registerSpecModeEventPublisher', () => {
	it('publishes spec:locked events to SSE and WebSocket project channels', async () => {
		const hooks = new HookRegistry();
		const sseCalls: Array<{ projectId: string; sessionId: string; eventType: string; data: unknown }> = [];
		const wsCalls: Array<{ room: string; message: unknown }> = [];

		const sse = {
			publish(projectId: string, sessionId: string, eventType: string, data: unknown) {
				sseCalls.push({ projectId, sessionId, eventType, data });
			},
		} as unknown as SseManager;

		const ws = {
			broadcastToRoom(room: string, message: unknown) {
				wsCalls.push({ room, message });
			},
		} as unknown as ElefantWsServer;

		registerSpecModeEventPublisher(hooks, sse, ws);

		await emit(hooks, 'spec:locked', {
			projectId: 'project-1',
			workflowId: 'spec-mode',
			lockedAt: '2026-04-29T00:00:00.000Z',
		});

		expect(sseCalls).toHaveLength(1);
		expect(sseCalls[0].projectId).toBe('project-1');
		expect(sseCalls[0].sessionId).toBe('spec-mode');
		expect(sseCalls[0].eventType).toBe('spec-mode:event');
		expect(sseCalls[0].data).toMatchObject({
			type: 'spec-mode:event',
			event: 'spec:locked',
			projectId: 'project-1',
			workflowId: 'spec-mode',
			payload: {
				projectId: 'project-1',
				workflowId: 'spec-mode',
				lockedAt: '2026-04-29T00:00:00.000Z',
			},
		});

		expect(wsCalls).toHaveLength(1);
		expect(wsCalls[0].room).toBe('project:project-1');
		expect(wsCalls[0].message).toMatchObject({
			type: 'event',
			event: 'spec_event',
		});
	});
});
