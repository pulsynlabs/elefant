import type { Elysia } from 'elysia';
import type { ElefantWsServer } from '../transport/ws-server.ts';

export function mountWsRoute(app: Elysia, ws: ElefantWsServer): Elysia {
	return ws.mount(app);
}
