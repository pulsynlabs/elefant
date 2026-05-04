import type { Elysia } from 'elysia'
import { access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { getProjectById } from '../db/repo/projects.ts'
import { getSessionById } from '../db/repo/sessions.ts'
import type { Database } from '../db/database.ts'
import type { ElefantError } from '../types/errors.ts'
import type { Result } from '../types/result.ts'
import { err, ok } from '../types/result.ts'

type ClientMessage =
	| { type: 'input'; data: string }
	| { type: 'resize'; cols: number; rows: number }
	| { type: 'close' }

type ServerMessage =
	| { type: 'output'; data: string }
	| { type: 'exit'; code: number }
	| { type: 'error'; message: string }

type ShellProcess = {
	stdin: Bun.Subprocess<'pipe', 'pipe', 'pipe'>['stdin']
	process: Bun.Subprocess<'pipe', 'pipe', 'pipe'>
	closed: boolean
	killTimer: ReturnType<typeof setTimeout> | null
}

type SessionConnection = {
	projectId: string
	sessionId: string
	shell: ShellProcess
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

			const setup = await setupPtyForSession(db, projectId, sessionId)
			if (!setup.ok) {
				sendServerMessage(ws, { type: 'error', message: setup.error.message })
				ws.close()
				return
			}

			const shell = spawnInteractiveShell(setup.data.shell, setup.data.cwd)
			if (!shell.ok) {
				console.error('[pty] failed to spawn shell', shell.error.details)
				sendServerMessage(ws, { type: 'error', message: shell.error.message })
				ws.close()
				return
			}

			const connection: SessionConnection = {
				projectId,
				sessionId,
				shell: shell.data,
			}
			activeBySession.set(sessionId, connection)

			void streamOutputToWebSocket(ws, connection, activeBySession)
		},
		message: (ws, raw) => {
			const { sessionId } = getRouteParams(ws)
			if (!sessionId) return
			const connection = activeBySession.get(sessionId)
			if (!connection) return

			const payload = parseClientMessage(raw)
			if (!payload) {
				sendServerMessage(ws, { type: 'error', message: 'Invalid PTY message payload' })
				return
			}

				switch (payload.type) {
				case 'input':
					void connection.shell.stdin.write(new TextEncoder().encode(payload.data))
					break
				case 'resize':
					// Bun.spawn does not expose PTY resize controls. Accept message as no-op.
					void payload
					break
				case 'close':
					cleanupConnection(activeBySession, connection)
					try {
						ws.close()
					} catch {
						// ignored
					}
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
	ws.send(JSON.stringify(payload))
}

async function setupPtyForSession(
	db: Database,
	projectId: string,
	sessionId: string,
): Promise<Result<{ cwd: string; shell: string }, ElefantError>> {
	const project = getProjectById(db, projectId)
	if (!project.ok) return err(project.error)

	const session = getSessionById(db, sessionId)
	if (!session.ok) return err(session.error)
	if (session.data.project_id !== projectId) {
		return err({
			code: 'VALIDATION_ERROR',
			message: `Session ${sessionId} does not belong to project ${projectId}`,
		})
	}

	try {
		await access(project.data.path, fsConstants.R_OK | fsConstants.W_OK)
	} catch (error) {
		return err({
			code: 'PERMISSION_DENIED',
			message: `Project path is not accessible: ${project.data.path}`,
			details: error,
		})
	}

	const shell = await resolveShellPath()
	return ok({ cwd: project.data.path, shell })
}

async function resolveShellPath(): Promise<string> {
	const candidates = [process.env.SHELL, '/bin/bash', '/bin/sh'].filter((x): x is string => Boolean(x))
	for (const candidate of candidates) {
		try {
			await access(candidate, fsConstants.X_OK)
			return candidate
		} catch {
			// keep trying fallbacks
		}
	}
	return '/bin/sh'
}

function spawnInteractiveShell(shell: string, cwd: string): Result<ShellProcess, ElefantError> {
	try {
		const child = Bun.spawn([shell, '-i'], {
			cwd,
			env: {
				...process.env,
				TERM: 'xterm-256color',
			},
			stdin: 'pipe',
			stdout: 'pipe',
			stderr: 'pipe',
		})

		return ok({
			stdin: child.stdin,
			process: child,
			closed: false,
			killTimer: null,
		})
	} catch (error) {
		return err({
			code: 'TOOL_EXECUTION_FAILED',
			message: 'Failed to spawn shell process',
			details: error,
		})
	}
}

async function streamOutputToWebSocket(
	ws: WsLike,
	connection: SessionConnection,
	activeBySession: Map<string, SessionConnection>,
): Promise<void> {
	const decoder = new TextDecoder('utf-8')

	const readStream = async (stream: ReadableStream<Uint8Array>) => {
		for await (const chunk of stream) {
			if (connection.shell.closed) return
			sendServerMessage(ws, { type: 'output', data: decoder.decode(chunk, { stream: true }) })
		}
	}

	await Promise.allSettled([
		readStream(connection.shell.process.stdout),
		readStream(connection.shell.process.stderr),
	])

	const code = await connection.shell.process.exited
	if (!connection.shell.closed) {
		sendServerMessage(ws, { type: 'exit', code })
	}

	cleanupConnection(activeBySession, connection)
	try {
		ws.close()
	} catch {
		// ignored
	}
}

function cleanupConnection(
	activeBySession: Map<string, SessionConnection>,
	connection: SessionConnection,
): void {
	if (connection.shell.closed) return
	connection.shell.closed = true
	activeBySession.delete(connection.sessionId)

	try {
		void connection.shell.stdin.end()
	} catch {
		// ignored
	}

	connection.shell.process.kill('SIGTERM')
	connection.shell.killTimer = setTimeout(() => {
		if (connection.shell.process.exitCode === null) {
			connection.shell.process.kill('SIGKILL')
		}
	}, 2_000)
}
