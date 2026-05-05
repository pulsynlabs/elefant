import type { Elysia } from 'elysia'
import { createRequire } from 'node:module'
import { access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { getProjectById } from '../db/repo/projects.ts'
import { getSessionById } from '../db/repo/sessions.ts'
import type { Database } from '../db/database.ts'

// node-pty uses native bindings — load via createRequire so Bun doesn't
// attempt ESM transformation of the .node file.
const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodePty = require('node-pty') as typeof import('node-pty')

type ClientMessage =
	| { type: 'input'; data: string }
	| { type: 'resize'; cols: number; rows: number }
	| { type: 'close' }

type ServerMessage =
	| { type: 'output'; data: string }
	| { type: 'exit'; code: number }
	| { type: 'error'; message: string }

type PtySession = {
	pty: import('node-pty').IPty
	closed: boolean
}

type SessionConnection = {
	projectId: string
	sessionId: string
	session: PtySession
}

type WsLike = {
	send: (message: string) => void
	close: () => void
	data?: Record<string, unknown>
}

type WsMountable = {
	ws: (
		path: string,
		handlers: {
			open: (ws: WsLike) => void | Promise<void>
			message: (ws: WsLike, raw: unknown) => void
			close: (ws: WsLike) => void
		},
	) => Elysia
}

export type PtyRouteController = {
	closeSession: (sessionId: string) => void
}

export function mountPtyRoute(app: Elysia, db: Database): PtyRouteController {
	const activeBySession = new Map<string, SessionConnection>()
	const wsApp = app as unknown as WsMountable

	wsApp.ws('/api/projects/:projectId/sessions/:sessionId/pty', {
		open: async (ws) => {
			const { projectId, sessionId } = getRouteParams(ws)
			if (!projectId || !sessionId) {
				sendServerMessage(ws, { type: 'error', message: 'Missing route params' })
				ws.close()
				return
			}

			if (activeBySession.has(sessionId)) {
				sendServerMessage(ws, { type: 'error', message: 'PTY already active for this session' })
				ws.close()
				return
			}

			// Resolve project path and validate
			const project = getProjectById(db, projectId)
			if (!project.ok) {
				sendServerMessage(ws, { type: 'error', message: project.error.message })
				ws.close()
				return
			}

			const session = getSessionById(db, sessionId)
			if (!session.ok) {
				sendServerMessage(ws, { type: 'error', message: session.error.message })
				ws.close()
				return
			}

			if (session.data.project_id !== projectId) {
				sendServerMessage(ws, { type: 'error', message: `Session does not belong to project` })
				ws.close()
				return
			}

			try {
				await access(project.data.path, fsConstants.R_OK | fsConstants.W_OK)
			} catch {
				sendServerMessage(ws, { type: 'error', message: `Project path not accessible: ${project.data.path}` })
				ws.close()
				return
			}

			const shell = await resolveShellPath()

			let ptyProcess: import('node-pty').IPty
			try {
				ptyProcess = nodePty.spawn(shell, ['-i'], {
					name: 'xterm-256color',
					cols: 80,
					rows: 24,
					cwd: project.data.path,
					env: {
						...process.env as Record<string, string>,
						TERM: 'xterm-256color',
						COLORTERM: 'truecolor',
					},
				})
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error)
				sendServerMessage(ws, { type: 'error', message: `Failed to spawn shell: ${msg}` })
				ws.close()
				return
			}

			const ptySession: PtySession = { pty: ptyProcess, closed: false }
			const connection: SessionConnection = { projectId, sessionId, session: ptySession }
			activeBySession.set(sessionId, connection)

			// Stream PTY output to WebSocket
			ptyProcess.onData((data: string) => {
				if (ptySession.closed) return
				sendServerMessage(ws, { type: 'output', data })
			})

			ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
				if (!ptySession.closed) {
					ptySession.closed = true
					activeBySession.delete(sessionId)
					sendServerMessage(ws, { type: 'exit', code: exitCode })
				}
				try { ws.close() } catch { /* ignored */ }
			})
		},

		message: (ws, raw) => {
			const { sessionId } = getRouteParams(ws)
			if (!sessionId) return
			const connection = activeBySession.get(sessionId)
			if (!connection || connection.session.closed) return

			const payload = parseClientMessage(raw)
			if (!payload) {
				sendServerMessage(ws, { type: 'error', message: 'Invalid PTY message payload' })
				return
			}

			const pty = connection.session.pty
			switch (payload.type) {
				case 'input':
					pty.write(payload.data)
					break
				case 'resize': {
					const cols = Math.max(2, Math.floor(payload.cols))
					const rows = Math.max(2, Math.floor(payload.rows))
					pty.resize(cols, rows)
					break
				}
				case 'close':
					cleanupConnection(activeBySession, connection)
					try { ws.close() } catch { /* ignored */ }
					break
			}
		},

		close: (ws) => {
			const { sessionId } = getRouteParams(ws)
			if (!sessionId) return
			const connection = activeBySession.get(sessionId)
			if (!connection) return
			cleanupConnection(activeBySession, connection)
		},
	})

	return {
		closeSession: (sessionId: string) => {
			const connection = activeBySession.get(sessionId)
			if (!connection) return
			cleanupConnection(activeBySession, connection)
		},
	}
}

function getRouteParams(ws: WsLike): { projectId?: string; sessionId?: string } {
	const data = ws.data
	if (!data) return {}
	const params = data.params as Record<string, unknown> | undefined
	const projectId = typeof params?.projectId === 'string' ? params.projectId : undefined
	const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : undefined
	return { projectId, sessionId }
}

function parseClientMessage(raw: unknown): ClientMessage | null {
	const candidate = normalizeMessageObject(raw)
	if (!candidate) return null

	if (candidate.type === 'close') return { type: 'close' }
	if (candidate.type === 'input' && typeof candidate.data === 'string') {
		return { type: 'input', data: candidate.data }
	}
	if (
		candidate.type === 'resize' &&
		typeof candidate.cols === 'number' &&
		Number.isFinite(candidate.cols) &&
		typeof candidate.rows === 'number' &&
		Number.isFinite(candidate.rows)
	) {
		return {
			type: 'resize',
			cols: Math.max(1, Math.floor(candidate.cols)),
			rows: Math.max(1, Math.floor(candidate.rows)),
		}
	}
	return null
}

function normalizeMessageObject(raw: unknown): Record<string, unknown> | null {
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
		return raw as Record<string, unknown>
	}

	let text: string
	if (typeof raw === 'string') text = raw
	else if (raw instanceof Uint8Array) text = Buffer.from(raw).toString('utf8')
	else if (raw instanceof ArrayBuffer) text = Buffer.from(raw).toString('utf8')
	else return null

	try {
		const parsed = JSON.parse(text)
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
		return parsed as Record<string, unknown>
	} catch {
		return null
	}
}

function sendServerMessage(ws: WsLike, payload: ServerMessage): void {
	try {
		ws.send(JSON.stringify(payload))
	} catch { /* ws may already be closing */ }
}

async function resolveShellPath(): Promise<string> {
	const candidates = [process.env.SHELL, '/bin/bash', '/bin/sh'].filter((x): x is string => Boolean(x))
	for (const candidate of candidates) {
		try {
			await access(candidate, fsConstants.X_OK)
			return candidate
		} catch {
			// keep trying
		}
	}
	return '/bin/sh'
}

function cleanupConnection(
	activeBySession: Map<string, SessionConnection>,
	connection: SessionConnection,
): void {
	if (connection.session.closed) return
	connection.session.closed = true
	activeBySession.delete(connection.sessionId)

	try {
		connection.session.pty.kill()
	} catch { /* ignored */ }
}
