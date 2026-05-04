import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Elysia } from 'elysia'
import { Database } from '../db/database.ts'
import { mountPtyRoute } from './routes-pty.ts'

type ServerMessage =
	| { type: 'output'; data: string }
	| { type: 'exit'; code: number }
	| { type: 'error'; message: string }

describe('mountPtyRoute', () => {
	let db: Database
	let app: Elysia
	let server: ReturnType<Elysia['listen']>
	let baseUrl = ''
	let projectId = ''
	let sessionId = ''

	beforeEach(async () => {
		db = new Database(':memory:')
		app = new Elysia()
		mountPtyRoute(app, db)

		const projectPath = await mkdtemp(join(tmpdir(), 'elefant-pty-test-'))
		projectId = crypto.randomUUID()
		sessionId = crypto.randomUUID()

		db.db.run(
			'INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)',
			[projectId, 'PTY Test Project', projectPath, null],
		)
		db.db.run(
			"INSERT INTO sessions (id, project_id, workflow_id, mode, phase, status, started_at, completed_at) VALUES (?, ?, ?, 'quick', 'idle', 'pending', ?, ?)",
			[sessionId, projectId, null, new Date().toISOString(), null],
		)

		server = app.listen(0)
		const port = app.server?.port
		if (!port) throw new Error('Failed to bind test server port')
		baseUrl = `ws://127.0.0.1:${port}`
	})

	afterEach(() => {
		server?.stop(true)
		db.close()
	})

	it('spawns shell and receives output', async () => {
		const socket = openPtySocket(baseUrl, projectId, sessionId)
		await waitForOpen(socket)
		await Bun.sleep(100)
		socket.send(JSON.stringify({ type: 'input', data: '\n' }))
		const output = await waitForMessage(socket, (message) => message.type === 'output' && message.data.length > 0)
		expect(output.type).toBe('output')
		socket.close()
	})

	it('echo hello writes and reads terminal output', async () => {
		const socket = openPtySocket(baseUrl, projectId, sessionId)
		await waitForOpen(socket)
		await Bun.sleep(100)

		socket.send(JSON.stringify({ type: 'input', data: 'echo hello\n' }))
		const hello = await waitForMessage(socket, (message) => message.type === 'output' && message.data.includes('hello'))
		expect(hello.type).toBe('output')
		if (hello.type === 'output') {
			expect(hello.data).toContain('hello')
		}
		socket.close()
	})

	it('resize message is accepted without server error', async () => {
		const socket = openPtySocket(baseUrl, projectId, sessionId)
		await waitForOpen(socket)
		await Bun.sleep(100)

		socket.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }))
		socket.send(JSON.stringify({ type: 'input', data: 'echo resized\n' }))
		const output = await waitForMessage(socket, (message) => message.type === 'output' && message.data.includes('resized'))
		expect(output.type).toBe('output')

		socket.close()
	})

	it('close message closes websocket cleanly', async () => {
		const socket = openPtySocket(baseUrl, projectId, sessionId)
		await waitForOpen(socket)

		const closePromise = waitForClose(socket)
		socket.send(JSON.stringify({ type: 'close' }))
		await closePromise
		expect(socket.readyState).toBe(WebSocket.CLOSED)
	})
})

function openPtySocket(baseUrl: string, projectId: string, sessionId: string): WebSocket {
	return new WebSocket(`${baseUrl}/api/projects/${projectId}/sessions/${sessionId}/pty`)
}

function waitForOpen(socket: WebSocket, timeoutMs = 5_000): Promise<void> {
	if (socket.readyState === WebSocket.OPEN) return Promise.resolve()
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			socket.removeEventListener('open', onOpen)
			reject(new Error('Timed out waiting for websocket open'))
		}, timeoutMs)

		const onOpen = () => {
			clearTimeout(timeout)
			socket.removeEventListener('open', onOpen)
			resolve()
		}

		socket.addEventListener('open', onOpen)
	})
}

function waitForMessage(
	socket: WebSocket,
	predicate: (message: ServerMessage) => boolean,
	timeoutMs = 5_000,
): Promise<ServerMessage> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			socket.removeEventListener('message', onMessage)
			reject(new Error('Timed out waiting for websocket message'))
		}, timeoutMs)

		const onMessage = (event: MessageEvent<string | Uint8Array>) => {
			const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8')
			const parsed = JSON.parse(raw) as ServerMessage
			if (!predicate(parsed)) return

			clearTimeout(timeout)
			socket.removeEventListener('message', onMessage)
			resolve(parsed)
		}

		socket.addEventListener('message', onMessage)
	})
}

function waitForClose(socket: WebSocket, timeoutMs = 5_000): Promise<void> {
	if (socket.readyState === WebSocket.CLOSED) return Promise.resolve()
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			socket.removeEventListener('close', onClose)
			reject(new Error('Timed out waiting for websocket close'))
		}, timeoutMs)

		const onClose = () => {
			clearTimeout(timeout)
			socket.removeEventListener('close', onClose)
			resolve()
		}

		socket.addEventListener('close', onClose)
	})
}
