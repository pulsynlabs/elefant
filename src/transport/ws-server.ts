import type { Elysia } from 'elysia'

import type { DaemonContext } from '../daemon/context.ts'
import { RoomManager } from './rooms.ts'
import {
	parseClientMessage,
	serializeMessage,
	type ApprovalRequest,
	type ServerMessage,
} from './ws-protocol.ts'

type PendingApproval = {
	resolve: (approved: boolean, reason?: string) => void
	reject: (reason?: string) => void
	timer: ReturnType<typeof setTimeout>
}

type ConnectionState = {
	send: (msg: string) => void
	lastPong: number
}

type WsWithConnection = {
	send: (msg: string) => void
	__elefantConn?: ConnectionState
}

type WsHandlers = {
	open: (ws: WsWithConnection) => void
	message: (ws: WsWithConnection, raw: unknown) => void
	close: (ws: WsWithConnection) => void
}

type WsMountable = {
	ws: (path: string, handlers: WsHandlers) => Elysia
}

export class ElefantWsServer {
	readonly rooms = new RoomManager()

	private readonly pending = new Map<string, PendingApproval>()
	private readonly connections = new Set<ConnectionState>()
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null

	constructor(ctx: DaemonContext) {
		void ctx
	}

	mount(app: Elysia): Elysia {
		const wsApp = app as unknown as WsMountable
		return wsApp.ws('/api/ws', {
			open: (ws) => {
				const conn: ConnectionState = {
					send: (msg: string) => {
						ws.send(msg)
					},
					lastPong: Date.now(),
				}
				ws.__elefantConn = conn
				this.connections.add(conn)
			},
			message: (ws, raw) => {
				const message = parseWsRaw(raw)
				if (!message) return

				const parsed = parseClientMessage(message)
				if (!parsed) return

				const conn = ws.__elefantConn
				if (!conn) return

				switch (parsed.type) {
					case 'join':
						this.rooms.join(conn.send, parsed.room)
						break
					case 'leave':
						this.rooms.leave(conn.send, parsed.room)
						break
					case 'ping':
						ws.send(serializeMessage({ type: 'ping', ts: Date.now() }))
						break
					case 'pong':
						conn.lastPong = Date.now()
						break
					case 'approval:response': {
						const pending = this.pending.get(parsed.requestId)
						if (!pending) break
						clearTimeout(pending.timer)
						this.pending.delete(parsed.requestId)
						pending.resolve(parsed.approved, parsed.reason)
						break
					}
				}
			},
			close: (ws) => {
				const conn = ws.__elefantConn
				if (!conn) return
				this.rooms.leaveAll(conn.send)
				this.connections.delete(conn)
			},
		})
	}

	startHeartbeat(intervalMs = 30_000, timeoutMs = 10_000): void {
		this.stopHeartbeat()
		this.heartbeatTimer = setInterval(() => {
			const now = Date.now()
			for (const conn of this.connections) {
				if (now - conn.lastPong > intervalMs + timeoutMs) {
					this.connections.delete(conn)
					this.rooms.leaveAll(conn.send)
					continue
				}

				try {
					conn.send(serializeMessage({ type: 'ping', ts: now }))
				} catch {
					this.connections.delete(conn)
					this.rooms.leaveAll(conn.send)
				}
			}
		}, intervalMs)
	}

	stopHeartbeat(): void {
		if (!this.heartbeatTimer) return
		clearInterval(this.heartbeatTimer)
		this.heartbeatTimer = null
	}

	broadcastToRoom(room: string, msg: ServerMessage): void {
		this.rooms.broadcast(room, serializeMessage(msg))
	}

	async requestApproval(
		params: Omit<ApprovalRequest, 'type'>,
		timeoutMs = 5 * 60_000,
	): Promise<{ approved: boolean; reason?: string }> {
		return new Promise((resolve) => {
			const request: ApprovalRequest = { type: 'approval:request', ...params }

			const timer = setTimeout(() => {
				this.pending.delete(params.requestId)
				resolve({ approved: false, reason: 'timeout' })
			}, timeoutMs)

			this.pending.set(params.requestId, {
				resolve: (approved, reason) => {
					resolve({ approved, reason })
				},
				reject: (reason) => {
					resolve({ approved: false, reason })
				},
				timer,
			})

			this.broadcastToRoom(`approval:${params.conversationId}`, request)
		})
	}
}

function parseWsRaw(raw: unknown): string | null {
	if (typeof raw === 'string') return raw
	if (raw instanceof Uint8Array) return Buffer.from(raw).toString()
	if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString()
	return null
}
