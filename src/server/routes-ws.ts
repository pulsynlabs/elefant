import type { Elysia } from 'elysia';
import type { ElefantWsServer } from '../transport/ws-server.ts';

export const FIELD_NOTES_WS_EVENT_TYPES = [
  'fieldnotes:indexed',
  'fieldnotes:provider-changed',
  'fieldnotes:reindex-progress',
] as const;

export type FieldNotesWsEventType = (typeof FIELD_NOTES_WS_EVENT_TYPES)[number];

export const REGISTERED_WS_EVENT_TYPES = [...FIELD_NOTES_WS_EVENT_TYPES] as const;

export function isRegisteredWsEventType(event: string): event is FieldNotesWsEventType {
  return (REGISTERED_WS_EVENT_TYPES as readonly string[]).includes(event);
}

export function mountWsRoute(app: Elysia, ws: ElefantWsServer): Elysia {
	return ws.mount(app);
}
