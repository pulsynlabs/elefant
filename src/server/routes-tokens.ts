import type { Elysia } from 'elysia'
import { tokenCounter, type TokenDeltaEvent } from './token-counter.ts'

function toSseFrame(event: TokenDeltaEvent): string {
	return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

export function mountTokenRoutes(app: Elysia): void {
	app.get('/api/projects/:projectId/sessions/:sessionId/tokens/events', ({ params }) => {
		const { sessionId } = params as Record<string, string>
		let teardown: (() => void) | null = null

		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const encoder = new TextEncoder()
				const initial = tokenCounter.getSnapshot(sessionId)
				const now = new Date(initial.updatedAt).toISOString()
				const bootstrap: TokenDeltaEvent[] = [
					{
						type: 'tokens.window',
						sessionId,
						data: {
							windowTokens: initial.windowTokens,
							windowMax: initial.windowMax,
							sessionTokens: initial.sessionTokens,
							deltaTokens: 0,
							reason: 'bootstrap',
						},
						ts: now,
					},
					{
						type: 'tokens.session',
						sessionId,
						data: {
							windowTokens: initial.windowTokens,
							windowMax: initial.windowMax,
							sessionTokens: initial.sessionTokens,
							deltaTokens: 0,
							reason: 'bootstrap',
						},
						ts: now,
					},
					{
						type: 'tokens.breakdown',
						sessionId,
						data: {
							windowTokens: initial.windowTokens,
							windowMax: initial.windowMax,
							sessionTokens: initial.sessionTokens,
							breakdown: initial.breakdown,
						},
						ts: now,
					},
				]

				for (const event of bootstrap) {
					controller.enqueue(encoder.encode(toSseFrame(event)))
				}

				const unsubscribe = tokenCounter.subscribe(sessionId, (event) => {
					controller.enqueue(encoder.encode(toSseFrame(event)))
				})

				const keepAlive = setInterval(() => {
					controller.enqueue(encoder.encode(': ping\n\n'))
				}, 15_000)

				teardown = () => {
					clearInterval(keepAlive)
					unsubscribe()
				}
			},
			cancel() {
				teardown?.()
				teardown = null
			},
		})

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
				'X-Accel-Buffering': 'no',
			},
		})
	})
}
