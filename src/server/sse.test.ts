import { describe, expect, it } from 'bun:test'

import { formatSSEEvent, formatSSEKeepalive } from './sse.ts'

describe('SSE formatting helpers', () => {
	it('formats SSE events with JSON payload and proper terminator', () => {
		const output = formatSSEEvent('token', { text: 'Hello' })
		expect(output).toBe('event: token\ndata: {"text":"Hello"}\n\n')
	})

	it('formats keepalive comments with proper terminator', () => {
		expect(formatSSEKeepalive()).toBe(': keepalive\n\n')
	})
})
