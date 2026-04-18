import type { Elysia } from 'elysia';
import type { SseManager } from '../transport/sse-manager.ts';

export function mountProjectEventsRoute(app: Elysia, sse: SseManager): Elysia {
	return app.get('/api/projects/:id/events', ({ params, request }) => {
		const lastEventId = request.headers.get('Last-Event-ID') ?? undefined;
		return sse.subscribe(params.id, lastEventId);
	});
}
