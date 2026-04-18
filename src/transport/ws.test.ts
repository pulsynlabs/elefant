import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'

import type { DaemonContext } from '../daemon/context.ts'
import { ElefantWsServer } from './ws-server.ts'
import { parseClientMessage, serializeMessage } from './ws-protocol.ts'

describe('ws-protocol', () => {
	it('parses valid client messages and rejects invalid payloads', () => {
		expect(parseClientMessage(JSON.stringify({ type: 'join', room: 'project:1' }))).toEqual({
			type: 'join',
			room: 'project:1',
		})

		expect(parseClientMessage('{invalid-json')).toBeNull()
		expect(parseClientMessage(JSON.stringify({ type: 'join' }))).toBeNull()
	})

	it('serializes server messages as JSON', () => {
		const out = serializeMessage({
			type: 'event',
			event: 'session:start',
			data: { sessionId: 's1' },
		})

		expect(JSON.parse(out)).toEqual({
			type: 'event',
			event: 'session:start',
			data: { sessionId: 's1' },
		})
	})
})

describe('ElefantWsServer', () => {
	it('broadcasts to joined room members', () => {
		const server = new ElefantWsServer(createMockContext())
		const received: string[] = []
		const send = (msg: string) => {
			received.push(msg)
		}

		server.rooms.join(send, 'project:p1')
		server.broadcastToRoom('project:p1', {
			type: 'event',
			event: 'project:open',
			data: { projectId: 'p1' },
		})

		expect(received).toHaveLength(1)
		expect(JSON.parse(received[0] as string)).toEqual({
			type: 'event',
			event: 'project:open',
			data: { projectId: 'p1' },
		})
	})

	it('requestApproval resolves when approval response arrives', async () => {
		const server = new ElefantWsServer(createMockContext())

		let handlers: WsHandlersForTest | undefined

		const app = {
			ws: (_path: string, wsHandlers: WsHandlersForTest) => {
				handlers = wsHandlers
				return new Elysia()
			},
		}

		server.mount(app as unknown as Elysia)
		expect(handlers).toBeDefined()
		if (!handlers) return

		const ws = createMockWs()
		handlers.open(ws)
		handlers.message(ws, JSON.stringify({ type: 'join', room: 'approval:conv-1' }))

		const pending = server.requestApproval(
			{
				requestId: 'req-1',
				tool: 'bash',
				args: { command: 'git push' },
				risk: 'high',
				conversationId: 'conv-1',
				timeoutMs: 5_000,
			},
			250,
		)

		handlers.message(
			ws,
			JSON.stringify({
				type: 'approval:response',
				requestId: 'req-1',
				approved: true,
				reason: 'approved',
			}),
		)

		await expect(pending).resolves.toEqual({ approved: true, reason: 'approved' })
	})

	it('requestApproval times out when no response arrives', async () => {
		const server = new ElefantWsServer(createMockContext())

		const result = await server.requestApproval(
			{
				requestId: 'req-timeout',
				tool: 'bash',
				args: { command: 'rm -rf /tmp/x' },
				risk: 'high',
				conversationId: 'conv-timeout',
				timeoutMs: 20,
			},
			20,
		)

		expect(result).toEqual({ approved: false, reason: 'timeout' })
	})
})

type MockWs = {
	messages: string[]
	send: (msg: string) => void
	__elefantConn?: { send: (msg: string) => void; lastPong: number }
}

type WsHandlersForTest = {
	open: (ws: MockWs) => void
	message: (ws: MockWs, raw: unknown) => void
	close: (ws: MockWs) => void
}

function createMockWs(): MockWs {
	return {
		messages: [],
		send(msg: string): void {
			this.messages.push(msg)
		},
	}
}

function createMockContext(): DaemonContext {
	return {
		config: {} as DaemonContext['config'],
		hooks: {} as DaemonContext['hooks'],
		tools: {} as DaemonContext['tools'],
		providers: {} as DaemonContext['providers'],
		project: {} as DaemonContext['project'],
		db: {} as DaemonContext['db'],
		state: {} as DaemonContext['state'],
		plugins: {} as DaemonContext['plugins'],
	}
}
