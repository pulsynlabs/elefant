import { describe, expect, it, beforeEach, afterEach } from 'bun:test'

import { RoomManager } from './rooms.ts'
import { SseManager } from './sse-manager.ts'
import { formatSseEvent } from './sse-manager.ts'
import { serializeMessage, parseClientMessage } from './ws-protocol.ts'

// ---------------------------------------------------------------------------
// RoomManager integration — full join/broadcast/receive cycle
// ---------------------------------------------------------------------------

describe('RoomManager integration', () => {
	it('join → broadcast → receive completes a full cycle', () => {
		const manager = new RoomManager()

		const receivedA: string[] = []
		const receivedB: string[] = []
		const receivedC: string[] = []

		const sendA = (msg: string) => receivedA.push(msg)
		const sendB = (msg: string) => receivedB.push(msg)
		const sendC = (msg: string) => receivedC.push(msg)

		// Two members in room-alpha, one in room-beta
		manager.join(sendA, 'room-alpha')
		manager.join(sendB, 'room-alpha')
		manager.join(sendC, 'room-beta')

		manager.broadcast('room-alpha', 'hello-alpha')
		manager.broadcast('room-beta', 'hello-beta')

		expect(receivedA).toEqual(['hello-alpha'])
		expect(receivedB).toEqual(['hello-alpha'])
		expect(receivedC).toEqual(['hello-beta'])
	})

	it('leaveAll removes a member from every room', () => {
		const manager = new RoomManager()
		const received: string[] = []
		const send = (msg: string) => received.push(msg)

		manager.join(send, 'room-a')
		manager.join(send, 'room-b')
		manager.join(send, 'room-c')

		manager.leaveAll(send)

		manager.broadcast('room-a', 'msg')
		manager.broadcast('room-b', 'msg')
		manager.broadcast('room-c', 'msg')

		expect(received).toEqual([])
		expect(manager.rooms()).toEqual([])
	})

	it('broadcast to empty room is a no-op', () => {
		const manager = new RoomManager()
		// Should not throw
		expect(() => manager.broadcast('nonexistent', 'msg')).not.toThrow()
	})

	it('dead socket is removed on broadcast failure', () => {
		const manager = new RoomManager()
		const goodReceived: string[] = []
		const goodSend = (msg: string) => goodReceived.push(msg)
		const badSend = () => {
			throw new Error('socket dead')
		}

		manager.join(goodSend, 'room-x')
		manager.join(badSend, 'room-x')

		manager.broadcast('room-x', 'survivor')

		expect(goodReceived).toEqual(['survivor'])
		expect(manager.members('room-x')).toBe(1)
	})
})

// ---------------------------------------------------------------------------
// SseManager integration — subscribe, publish, headers, destroy
// ---------------------------------------------------------------------------

describe('SseManager integration', () => {
	const dbStub = {
		db: {
			query: () => ({
				all: () => [],
				get: () => null,
				run: () => {},
			}),
		},
	} as unknown as import('../db/database.ts').Database

	let sse: SseManager

	beforeEach(() => {
		sse = new SseManager(dbStub)
	})

	afterEach(() => {
		sse.destroy()
	})

	it('subscribe returns a Response with correct SSE headers', () => {
		const response = sse.subscribe('project-1')

		expect(response).toBeInstanceOf(Response)
		expect(response.status).toBe(200)

		const headers = response.headers
		expect(headers.get('Content-Type')).toBe('text/event-stream')
		expect(headers.get('Cache-Control')).toBe('no-cache')
		expect(headers.get('Connection')).toBe('keep-alive')
		expect(headers.get('X-Accel-Buffering')).toBe('no')
	})

	it('publish enqueues an event to active subscribers', async () => {
		const response = sse.subscribe('project-1')
		const body = response.body
		if (!body) throw new Error('No response body')

		const reader = body.getReader()

		// Give the stream a tick to start
		await new Promise((resolve) => setTimeout(resolve, 10))

		sse.publish('project-1', 'session-1', 'test-event', { key: 'value' })

		// Read chunks until we find the event (first chunk may be ": connected")
		let found = false
		for (let i = 0; i < 5; i++) {
			const { value, done } = await reader.read()
			if (done) break

			const text = new TextDecoder().decode(value)
			if (text.includes('event: test-event')) {
				expect(text).toContain('"key":"value"')
				found = true
				break
			}
		}

		expect(found).toBe(true)
		reader.releaseLock()
	})

	it('publish to unknown project is a no-op', () => {
		expect(() => sse.publish('nonexistent', 's1', 'evt', {})).not.toThrow()
	})

	it('destroy closes all connections and clears state', () => {
		sse.subscribe('project-1')
		sse.subscribe('project-2')

		expect(sse.getConnectionCount('project-1')).toBe(1)
		expect(sse.getConnectionCount('project-2')).toBe(1)

		sse.destroy()

		expect(sse.getConnectionCount('project-1')).toBe(0)
		expect(sse.getConnectionCount('project-2')).toBe(0)
	})

	it('getConnectionCount returns 0 for unknown project', () => {
		expect(sse.getConnectionCount('unknown')).toBe(0)
	})
})

// ---------------------------------------------------------------------------
// WS protocol integration — serialize/parse round-trip
// ---------------------------------------------------------------------------

describe('WS protocol integration', () => {
	it('serializes and parses join message', () => {
		const msg = { type: 'join' as const, room: 'approval:conv-1' }
		const serialized = serializeMessage(msg)
		const parsed = parseClientMessage(serialized)

		expect(parsed).not.toBeNull()
		expect(parsed!.type).toBe('join')
		if (parsed!.type === 'join') {
			expect(parsed!.room).toBe('approval:conv-1')
		}
	})

	it('serializes and parses approval:response message', () => {
		const msg = {
			type: 'approval:response' as const,
			requestId: 'req-123',
			approved: true,
			reason: 'looks good',
		}
		const serialized = serializeMessage(msg)
		const parsed = parseClientMessage(serialized)

		expect(parsed).not.toBeNull()
		expect(parsed!.type).toBe('approval:response')
		if (parsed!.type === 'approval:response') {
			expect(parsed!.requestId).toBe('req-123')
			expect(parsed!.approved).toBe(true)
		}
	})

	it('parses server approval:request', () => {
		const msg = {
			type: 'approval:request' as const,
			requestId: 'req-456',
			tool: 'bash',
			args: { command: 'rm -rf /tmp' },
			risk: 'high' as const,
			conversationId: 'conv-1',
			timeoutMs: 300_000,
		}
		const serialized = serializeMessage(msg)
		// Server messages are just JSON — parse manually for verification
		const parsed = JSON.parse(serialized)

		expect(parsed.type).toBe('approval:request')
		expect(parsed.tool).toBe('bash')
		expect(parsed.risk).toBe('high')
	})

	it('rejects invalid client message', () => {
		const parsed = parseClientMessage('{"type":"nonexistent"}')
		expect(parsed).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// formatSseEvent helper
// ---------------------------------------------------------------------------

describe('formatSseEvent', () => {
	it('formats a valid SSE event string', () => {
		const result = formatSseEvent('evt-1', 'user-action', { foo: 'bar' })

		expect(result).toContain('id: evt-1')
		expect(result).toContain('event: user-action')
		expect(result).toContain('data: {"foo":"bar"}')
		expect(result).toMatch(/\n\n$/)
	})
})
