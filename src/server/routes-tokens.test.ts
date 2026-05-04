import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { mountTokenRoutes } from './routes-tokens.ts'
import { tokenCounter } from './token-counter.ts'

function decodeChunk(chunk: Uint8Array): string {
	return new TextDecoder().decode(chunk)
}

describe('mountTokenRoutes', () => {
	it('streams bootstrap events and live token updates', async () => {
		tokenCounter.resetForTests()

		const app = new Elysia()
		mountTokenRoutes(app)

		const response = await app.handle(
			new Request('http://localhost/api/projects/p1/sessions/s1/tokens/events'),
		)

		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toContain('text/event-stream')

		const reader = response.body?.getReader()
		expect(reader).toBeDefined()
		if (!reader) return

		const first = await reader.read()
		expect(first.done).toBe(false)
		const firstText = decodeChunk(first.value)
		expect(firstText).toContain('event: tokens.window')
		expect(firstText).toContain('reason":"bootstrap"')

		tokenCounter.recordTextDelta('s1', 'hello from stream')

		const second = await reader.read()
		expect(second.done).toBe(false)
		const secondText = decodeChunk(second.value)
		expect(secondText).toContain('event: tokens.session')

		await reader.cancel()
	})
})
