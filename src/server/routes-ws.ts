import type { Elysia } from 'elysia';
import type { ElefantWsServer } from '../transport/ws-server.ts';

export const RESEARCH_WS_EVENT_TYPES = [
  'research:indexed',
  'research:provider-changed',
  'research:reindex-progress',
] as const;

export type ResearchWsEventType = (typeof RESEARCH_WS_EVENT_TYPES)[number];

export const REGISTERED_WS_EVENT_TYPES = [...RESEARCH_WS_EVENT_TYPES] as const;

export function isRegisteredWsEventType(event: string): event is ResearchWsEventType {
  return (REGISTERED_WS_EVENT_TYPES as readonly string[]).includes(event);
}

export function mountWsRoute(app: Elysia, ws: ElefantWsServer): Elysia {
	return ws.mount(app);
}
