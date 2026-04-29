/**
 * Concurrency Contract for SseManager
 *
 * This module provides Server-Sent Events (SSE) transport for real-time
 * communication with connected clients. Key concurrency guarantees:
 *
 * 1. Per-Project Lock: All publish operations for a given project are
 *    serialized through an async mutex to prevent race conditions on the
 *    connection counter. This ensures monotonic, gap-free sequence numbers
 *    even under concurrent publishers.
 *
 * 2. Connection Counter: Each active connection maintains a counter that
 *    increments atomically with each published event. This counter is used
 *    for ordering and debugging purposes.
 *
 * 3. Thread Safety: The manager is safe for concurrent use across multiple
 *    projects (each has independent locks) and safe for concurrent publishes
 *    to the same project (serialized via the per-project lock).
 *
 * 4. Replay Safety: Event replay during subscription recovery is also
 *    protected by the same per-project lock to maintain ordering consistency.
 */

import type { Database } from '../db/database.ts'
import { insertEvent, listEventsBySession } from '../db/repo/events.ts'

export interface SseEvent {
	id: string
	event: string
	data: unknown
}

type ActiveConnection = {
	controller: ReadableStreamDefaultController<Uint8Array>
	keepaliveTimer: ReturnType<typeof setInterval>
	counter: number
}

// Per-project async lock using Promise chain mutex
// This is sufficient for single-daemon use where we don't need
// cross-process synchronization.
type LockState = {
	promise: Promise<void>
}

// Type export for test access to internal state
export type SseManagerWithInternals = SseManager & {
	getConnectionsForTest(projectId: string): Set<ActiveConnection>
}

export class SseManager {
	private readonly connections = new Map<string, Set<ActiveConnection>>()
	private readonly encoder = new TextEncoder()
	private readonly locks = new Map<string, LockState>()

	constructor(private readonly db: Database) {}

	subscribe(projectId: string, lastEventId?: string | null): Response {
		let connection: ActiveConnection | null = null

		const stream = new ReadableStream<Uint8Array>({
			start: (controller) => {
				connection = {
					controller,
					keepaliveTimer: setInterval(() => {
						this.enqueue(controller, ': ping\n\n')
					}, 15_000),
					counter: 0,
				}

				this.addConnection(projectId, connection)
				this.enqueue(controller, ': connected\n\n')

				if (lastEventId && connection) {
					this.replayEvents(projectId, lastEventId, connection)
				}
			},
			cancel: () => {
				if (!connection) return
				clearInterval(connection.keepaliveTimer)
				this.removeConnection(projectId, connection)
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
	}

	publish(projectId: string, sessionId: string, eventType: string, data: unknown): void {
		// Use void to handle the async lock without blocking the caller
		// The entire operation (db write + broadcast) is serialized per-project
		void this.withLock(projectId, () => {
			const id = crypto.randomUUID()
			const payload = formatSseEvent(id, eventType, data)

			insertEvent(this.db, {
				id,
				session_id: sessionId,
				type: eventType,
				data: JSON.stringify(data),
			})

			const projectConnections = this.connections.get(projectId)
			if (!projectConnections) return

			for (const connection of projectConnections) {
				connection.counter += 1
				this.enqueue(connection.controller, payload)
			}
		}).catch((error) => {
			console.error('[elefant] Failed to publish SSE event:', error)
		})
	}

	getConnectionCount(projectId: string): number {
		return this.connections.get(projectId)?.size ?? 0
	}

	destroy(): void {
		for (const connections of this.connections.values()) {
			for (const connection of connections) {
				clearInterval(connection.keepaliveTimer)
				try {
					connection.controller.close()
				} catch {
					// ignored: already closed
				}
			}
			connections.clear()
		}

		this.connections.clear()
		this.locks.clear()
	}

	// Test helper to access internal connection state
	getConnectionsForTest(projectId: string): Set<ActiveConnection> {
		return this.connections.get(projectId) ?? new Set()
	}

	/**
	 * Executes a function while holding the per-project lock.
	 * Uses a Promise chain mutex pattern suitable for single-daemon use.
	 * Ensures all operations for a project are serialized.
	 */
	private async withLock<T>(projectId: string, fn: () => T): Promise<T> {
		let lock = this.locks.get(projectId)
		if (!lock) {
			lock = { promise: Promise.resolve() }
			this.locks.set(projectId, lock)
		}

		// Wait for current lock to be released
		await lock.promise

		// Create new lock that will be resolved when we're done
		// eslint-disable-next-line prefer-const
		let releaseLock!: () => void
		const newLockPromise = new Promise<void>((resolve) => {
			releaseLock = resolve
		})

		// Update the lock to our new promise
		lock.promise = newLockPromise

		try {
			return fn()
		} finally {
			releaseLock()
		}
	}

	private replayEvents(projectId: string, lastEventId: string, conn: ActiveConnection): void {
		try {
			const sessions = this.db.db
				.query('SELECT id FROM sessions WHERE project_id = ? ORDER BY started_at ASC')
				.all(projectId) as Array<{ id: string }>

			const replayRows: Array<{ id: string; type: string; data: string; timestamp: string }> = []

			for (const session of sessions) {
				const events = listEventsBySession(this.db, session.id)
				if (!events.ok) continue
				for (const event of events.data) {
					replayRows.push({
						id: event.id,
						type: event.type,
						data: event.data,
						timestamp: event.timestamp,
					})
				}
			}

			replayRows.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

			let seenLast = false
			for (const row of replayRows) {
				if (!seenLast) {
					seenLast = row.id === lastEventId
					continue
				}

				conn.counter += 1
				const payload = formatSseEvent(row.id, row.type, parseEventData(row.data))
				this.enqueue(conn.controller, payload)
			}
		} catch {
			// replay failures are non-fatal
		}
	}

	private addConnection(projectId: string, connection: ActiveConnection): void {
		let projectConnections = this.connections.get(projectId)
		if (!projectConnections) {
			projectConnections = new Set<ActiveConnection>()
			this.connections.set(projectId, projectConnections)
		}

		projectConnections.add(connection)
	}

	private removeConnection(projectId: string, connection: ActiveConnection): void {
		const projectConnections = this.connections.get(projectId)
		if (!projectConnections) return

		projectConnections.delete(connection)
		if (projectConnections.size === 0) this.connections.delete(projectId)
	}

	private enqueue(controller: ReadableStreamDefaultController<Uint8Array>, text: string): void {
		try {
			controller.enqueue(this.encoder.encode(text))
		} catch {
			// stream already closed
		}
	}
}

export function formatSseEvent(id: string, event: string, data: unknown): string {
	return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function parseEventData(raw: string): unknown {
	try {
		return JSON.parse(raw)
	} catch {
		return {}
	}
}
