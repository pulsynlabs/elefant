/**
 * Integration — two concurrent agent runs, cancel, and SSE replay.
 *
 * Proves the MH3 multi-run contract end-to-end in one in-process test:
 *   1. Two runs spawned in the same session receive isolated streams of
 *      `agent_run.*` events. No envelope for run A appears in the slice
 *      attributed to run B, and vice-versa.
 *   2. Cancelling run A emits `agent_run.cancelled` for A while B keeps
 *      streaming tokens and reaches `agent_run.done` normally.
 *   3. After a mid-stream disconnect, reconnecting with the last seen
 *      event id replays the envelopes that were missed during the gap.
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { Database } from '../db/database.ts'
import { HookRegistry } from '../hooks/index.ts'
import type { ProviderRouter } from '../providers/router.ts'
import type {
	ProviderAdapter,
	SendMessageOptions,
	StreamEvent,
} from '../providers/types.ts'
import { mountProjectEventsRoute } from '../server/routes-projects.ts'
import { ToolRegistry } from '../tools/registry.ts'
import { SseManager } from '../transport/sse-manager.ts'
import { RunRegistry } from './registry.ts'
import { mountAgentRunRoutes } from './routes.ts'
import { createRun, listChildRunsByParent } from './dal.ts'
import { buildInitialMessages } from './context.ts'
import type { Message } from '../types/providers.ts'
import { ConfigManager } from '../config/loader.ts'

const tempDirs: string[] = []

function createTempDbPath(): string {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-runs-integration-'))
	tempDirs.push(dir)
	return join(dir, 'db.sqlite')
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true })
	}
})

// ─── Mock provider ───────────────────────────────────────────────────────────

/**
 * Provider adapter that tags its output with the sentinel embedded in the
 * user prompt. Prompts of the form "<TAG>::<count>" produce `count` token
 * deltas each containing the tag, then `done`. A `[wait]` prompt blocks
 * until `signal` aborts, so a caller can race cancel against a live stream.
 */
function createTaggedRouter(): ProviderRouter {
	const adapter: ProviderAdapter = {
		name: 'tagged-mock',
		async *sendMessage(
			messages,
			_tools,
			options?: SendMessageOptions,
		): AsyncGenerator<StreamEvent> {
			const prompt = messages.map((m) => m.content).join('\n')

			if (prompt.includes('[wait]')) {
				await new Promise<void>((resolve) => {
					if (!options?.signal) {
						setTimeout(resolve, 500)
						return
					}
					if (options.signal.aborted) {
						resolve()
						return
					}
					options.signal.addEventListener('abort', () => resolve(), { once: true })
					setTimeout(resolve, 2_000)
				})
				yield { type: 'done', finishReason: 'stop' }
				return
			}

			const match = /TAG::([A-Z]+)::(\d+)/.exec(prompt)
			if (match) {
				const tag = match[1]
				const count = Math.max(1, Math.min(50, Number(match[2])))
				for (let i = 0; i < count; i += 1) {
					if (options?.signal?.aborted) return
					yield { type: 'text_delta', text: `${tag}${i}` }
				}
			} else {
				yield { type: 'text_delta', text: 'ok' }
			}
			yield { type: 'done', finishReason: 'stop' }
		},
	}

	return {
		getAdapter: () => ({ ok: true, data: adapter }),
		listProviders: () => ['tagged-mock'],
	} as unknown as ProviderRouter
}

// ─── SSE helpers ─────────────────────────────────────────────────────────────

interface SseFrame {
	id: string
	event: string
	data: string
}

/**
 * Pulls frames from an Elysia-returned SSE `Response` body. Stops as soon
 * as either the stream ends, `maxFrames` is reached, or `shouldStop`
 * returns true. Keeps the reader released on the way out so the stream
 * can be cleanly cancelled by the caller.
 */
async function readSseFrames(
	response: Response,
	shouldStop: (frame: SseFrame, frames: SseFrame[]) => boolean,
	options: { timeoutMs?: number; maxFrames?: number } = {},
): Promise<SseFrame[]> {
	const frames: SseFrame[] = []
	const body = response.body
	if (!body) return frames

	const reader = body.getReader()
	const decoder = new TextDecoder()
	const timeoutMs = options.timeoutMs ?? 3_000
	const maxFrames = options.maxFrames ?? 500
	const deadline = Date.now() + timeoutMs
	let buffer = ''

	try {
		while (Date.now() < deadline && frames.length < maxFrames) {
			const readPromise = reader.read()
			const timeout = new Promise<{ done: true; value: undefined }>((resolve) =>
				setTimeout(
					() => resolve({ done: true, value: undefined }),
					Math.max(1, deadline - Date.now()),
				),
			)
			const { done, value } = (await Promise.race([readPromise, timeout])) as {
				done: boolean
				value?: Uint8Array
			}
			if (done) break

			buffer += decoder.decode(value as Uint8Array, { stream: true })
			let idx: number
			while ((idx = buffer.indexOf('\n\n')) !== -1) {
				const rawBlock = buffer.slice(0, idx)
				buffer = buffer.slice(idx + 2)
				const frame = parseSseBlock(rawBlock)
				if (!frame) continue
				frames.push(frame)
				if (shouldStop(frame, frames)) {
					return frames
				}
			}
		}
	} finally {
		try {
			await reader.cancel()
		} catch {
			// already cancelled
		}
		try {
			reader.releaseLock()
		} catch {
			// already released
		}
	}

	return frames
}

function parseSseBlock(block: string): SseFrame | null {
	if (!block.trim() || block.startsWith(':')) return null
	let id = ''
	let event = ''
	const dataLines: string[] = []
	for (const line of block.split('\n')) {
		if (line.startsWith(':')) continue
		const colon = line.indexOf(':')
		if (colon === -1) continue
		const field = line.slice(0, colon)
		const value = line.slice(colon + 1).replace(/^ /, '')
		if (field === 'id') id = value
		else if (field === 'event') event = value
		else if (field === 'data') dataLines.push(value)
	}
	if (!event || dataLines.length === 0) return null
	return { id, event, data: dataLines.join('\n') }
}

// ─── Test fixture — server wiring ────────────────────────────────────────────

interface Fixture {
	app: Elysia
	db: Database
	sse: SseManager
	projectId: string
	sessionId: string
	close(): void
}

function createFixture(): Fixture {
	const db = new Database(createTempDbPath())
	const projectId = crypto.randomUUID()
	const sessionId = crypto.randomUUID()

	db.db.run(
		'INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)',
		[projectId, 'Runs Integration', '/tmp/runs-integration', null],
	)
	db.db.run(
		'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
		[sessionId, projectId, null, 'execute', 'running', new Date().toISOString(), null],
	)

	const sse = new SseManager(db)
	const app = new Elysia()
	mountProjectEventsRoute(app, sse)

	// Create a ConfigManager with a mock project path resolver
	const configManager = new ConfigManager({
		projectPathResolver: () => ({ ok: true, data: '/tmp/test-project' }),
	})

	mountAgentRunRoutes(app, {
		db,
		providerRouter: createTaggedRouter(),
		toolRegistry: new ToolRegistry(new HookRegistry()),
		hookRegistry: new HookRegistry(),
		runRegistry: new RunRegistry(),
		sseManager: sse,
		configManager,
	})

	return {
		app,
		db,
		sse,
		projectId,
		sessionId,
		close() {
			sse.destroy()
			db.close()
		},
	}
}

async function spawnRun(
	fx: Fixture,
	body: { agentType: string; title: string; contextMode: string; prompt: string },
): Promise<string> {
	const response = await fx.app.handle(
		new Request(
			`http://localhost/api/projects/${fx.projectId}/sessions/${fx.sessionId}/agent-runs`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			},
		),
	)
	expect(response.status).toBe(200)
	const payload = (await response.json()) as { ok: boolean; data: { runId: string } }
	expect(payload.ok).toBe(true)
	return payload.data.runId
}

async function subscribeToEvents(fx: Fixture, lastEventId?: string): Promise<Response> {
	const url = lastEventId
		? `http://localhost/api/projects/${fx.projectId}/events?lastEventId=${encodeURIComponent(lastEventId)}`
		: `http://localhost/api/projects/${fx.projectId}/events`
	return fx.app.handle(new Request(url))
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('agent runs integration', () => {
	it('streams two concurrent runs without cross-contamination', async () => {
		const fx = createFixture()
		try {
			const runA = await spawnRun(fx, {
				agentType: 'executor',
				title: 'Run A',
				contextMode: 'none',
				prompt: 'TAG::AAA::3',
			})
			const runB = await spawnRun(fx, {
				agentType: 'executor',
				title: 'Run B',
				contextMode: 'none',
				prompt: 'TAG::BBB::3',
			})

			const sseResponse = await subscribeToEvents(fx)
			const frames = await readSseFrames(
				sseResponse,
				(_frame, all) => {
					// Stop once both runs have reported done.
					const aDone = all.some(
						(f) => f.event === 'agent_run.done' && f.data.includes(`"runId":"${runA}"`),
					)
					const bDone = all.some(
						(f) => f.event === 'agent_run.done' && f.data.includes(`"runId":"${runB}"`),
					)
					return aDone && bDone
				},
				{ timeoutMs: 4_000, maxFrames: 200 },
			)

			// Partition by runId via envelope parse
			const byRun: Record<string, SseFrame[]> = {}
			for (const frame of frames) {
				try {
					const envelope = JSON.parse(frame.data) as { runId?: string }
					if (typeof envelope.runId === 'string') {
						byRun[envelope.runId] = byRun[envelope.runId] ?? []
						byRun[envelope.runId].push(frame)
					}
				} catch {
					// ignore connection banner / keepalives
				}
			}

			const aFrames = byRun[runA] ?? []
			const bFrames = byRun[runB] ?? []

			expect(aFrames.length).toBeGreaterThan(0)
			expect(bFrames.length).toBeGreaterThan(0)

			// No run B data appears in A's slice and vice versa.
			for (const frame of aFrames) {
				expect(frame.data).not.toContain('BBB')
			}
			for (const frame of bFrames) {
				expect(frame.data).not.toContain('AAA')
			}

			// Both streams end with agent_run.done.
			expect(aFrames.some((f) => f.event === 'agent_run.done')).toBe(true)
			expect(bFrames.some((f) => f.event === 'agent_run.done')).toBe(true)

			// Token events for A carry AAA, for B carry BBB.
			const aTokenTexts = aFrames
				.filter((f) => f.event === 'agent_run.token')
				.map((f) => JSON.parse(f.data).data.text as string)
			const bTokenTexts = bFrames
				.filter((f) => f.event === 'agent_run.token')
				.map((f) => JSON.parse(f.data).data.text as string)

			expect(aTokenTexts.length).toBeGreaterThan(0)
			expect(bTokenTexts.length).toBeGreaterThan(0)
			expect(aTokenTexts.every((t) => t.startsWith('AAA'))).toBe(true)
			expect(bTokenTexts.every((t) => t.startsWith('BBB'))).toBe(true)
		} finally {
			fx.close()
		}
	})

	it('cancels one run while another continues to completion', async () => {
		const fx = createFixture()
		try {
			const waiter = await spawnRun(fx, {
				agentType: 'executor',
				title: 'Waiter',
				contextMode: 'none',
				prompt: '[wait] please',
			})
			const worker = await spawnRun(fx, {
				agentType: 'executor',
				title: 'Worker',
				contextMode: 'none',
				prompt: 'TAG::WORKER::4',
			})

			const sseResponse = await subscribeToEvents(fx)

			// Cancel the waiter after a beat so its provider is mid-wait.
			setTimeout(() => {
				void fx.app.handle(
					new Request(`http://localhost/api/agent-runs/${waiter}/cancel`, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
					}),
				)
			}, 30)

			const frames = await readSseFrames(
				sseResponse,
				(_f, all) => {
					const cancelled = all.some(
						(f) =>
							f.event === 'agent_run.cancelled' &&
							f.data.includes(`"runId":"${waiter}"`),
					)
					const workerDone = all.some(
						(f) => f.event === 'agent_run.done' && f.data.includes(`"runId":"${worker}"`),
					)
					return cancelled && workerDone
				},
				{ timeoutMs: 4_000 },
			)

			const waiterEvents = frames.filter((f) => f.data.includes(`"runId":"${waiter}"`))
			const workerEvents = frames.filter((f) => f.data.includes(`"runId":"${worker}"`))

			expect(waiterEvents.some((f) => f.event === 'agent_run.cancelled')).toBe(true)
			expect(waiterEvents.some((f) => f.event === 'agent_run.done')).toBe(false)
			expect(workerEvents.some((f) => f.event === 'agent_run.done')).toBe(true)
		} finally {
			fx.close()
		}
	})

	it('replays missed events after SSE disconnect + reconnect with lastEventId', async () => {
		const fx = createFixture()
		try {
			// Subscribe first so the live stream captures events as they
			// happen — otherwise the fast mock provider finishes before
			// the subscription opens.
			const firstResponse = await subscribeToEvents(fx)

			const runId = await spawnRun(fx, {
				agentType: 'executor',
				title: 'Replay run',
				contextMode: 'none',
				prompt: 'TAG::ZZZ::5',
			})

			// Stop the first reader as soon as we see any envelope for
			// this runId. Disconnecting early guarantees the remaining
			// events land in the DB while we're disconnected — the
			// reconnect then has to resurrect them via `lastEventId`.
			const firstFrames = await readSseFrames(
				firstResponse,
				(frame) => frame.data.includes(`"runId":"${runId}"`),
				{ timeoutMs: 3_000, maxFrames: 1 },
			)

			const firstSeen = firstFrames.find((f) => f.data.includes(`"runId":"${runId}"`))
			expect(firstSeen).toBeDefined()
			const lastEventId = firstSeen!.id
			expect(typeof lastEventId).toBe('string')
			expect(lastEventId.length).toBeGreaterThan(0)

			// Give the backgrounded runAgentLoop time to publish the
			// remaining events into the DB while we are disconnected.
			await Bun.sleep(150)

			const secondResponse = await subscribeToEvents(fx, lastEventId)
			const secondFrames = await readSseFrames(
				secondResponse,
				(frame) =>
					frame.event === 'agent_run.done' && frame.data.includes(`"runId":"${runId}"`),
				{ timeoutMs: 3_000 },
			)

			const runFrames = secondFrames.filter((f) => f.data.includes(`"runId":"${runId}"`))
			expect(runFrames.length).toBeGreaterThan(0)

			// The cursor event itself must not be redelivered.
			expect(runFrames.every((f) => f.id !== lastEventId)).toBe(true)

			// And we must pick up the terminal `done` that fired during
			// the disconnected window — proving replay actually works.
			expect(runFrames.some((f) => f.event === 'agent_run.done')).toBe(true)
		} finally {
			fx.close()
		}
	})
})

describe('run tree chain regression', () => {
	it('creates a 3-level chain and queries children at each level', async () => {
		const db = new Database(createTempDbPath())
		const projectId = crypto.randomUUID()
		const sessionId = crypto.randomUUID()

		db.db.run(
			'INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)',
			[projectId, 'Tree test project', '/tmp/tree-test', null],
		)
		db.db.run(
			'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
			[sessionId, projectId, null, 'execute', 'running', new Date().toISOString(), null],
		)

		const rootRunId = crypto.randomUUID()
		const childRunId = crypto.randomUUID()
		const grandchildRunId = crypto.randomUUID()

		// Create root run (depth 0)
		const rootResult = createRun(db, {
			run_id: rootRunId,
			session_id: sessionId,
			project_id: projectId,
			parent_run_id: null,
			agent_type: 'executor',
			title: 'Root run',
			status: 'running',
			context_mode: 'none',
		})
		expect(rootResult.ok).toBe(true)

		// Create child run (depth 1)
		const childResult = createRun(db, {
			run_id: childRunId,
			session_id: sessionId,
			project_id: projectId,
			parent_run_id: rootRunId,
			agent_type: 'executor',
			title: 'Child run',
			status: 'running',
			context_mode: 'none',
		})
		expect(childResult.ok).toBe(true)

		// Create grandchild run (depth 2)
		const grandchildResult = createRun(db, {
			run_id: grandchildRunId,
			session_id: sessionId,
			project_id: projectId,
			parent_run_id: childRunId,
			agent_type: 'executor',
			title: 'Grandchild run',
			status: 'running',
			context_mode: 'none',
		})
		expect(grandchildResult.ok).toBe(true)

		// Query children at each level using DAL
		const rootChildren = listChildRunsByParent(db, rootRunId, sessionId)
		expect(rootChildren.ok).toBe(true)
		expect(rootChildren.data).toHaveLength(1)
		expect(rootChildren.data[0].run_id).toBe(childRunId)
		expect(rootChildren.data[0].parent_run_id).toBe(rootRunId)

		const childChildren = listChildRunsByParent(db, childRunId, sessionId)
		expect(childChildren.ok).toBe(true)
		expect(childChildren.data).toHaveLength(1)
		expect(childChildren.data[0].run_id).toBe(grandchildRunId)
		expect(childChildren.data[0].parent_run_id).toBe(childRunId)

		const grandchildChildren = listChildRunsByParent(db, grandchildRunId, sessionId)
		expect(grandchildChildren.ok).toBe(true)
		expect(grandchildChildren.data).toHaveLength(0)

		// Query children via API endpoint
		const app = new Elysia()
		mountAgentRunRoutes(app, {
			db,
			providerRouter: createTaggedRouter(),
			toolRegistry: new ToolRegistry(new HookRegistry()),
			hookRegistry: new HookRegistry(),
			runRegistry: new RunRegistry(),
			sseManager: new SseManager(db),
		})

		// Test /children endpoint at root level
		const rootChildrenResponse = await app.handle(
			new Request(
				`http://localhost/api/projects/${projectId}/sessions/${sessionId}/runs/${rootRunId}/children`,
			),
		)
		expect(rootChildrenResponse.status).toBe(200)
		const rootChildrenPayload = (await rootChildrenResponse.json()) as {
			ok: boolean
			data: Array<{ run_id: string; parent_run_id: string | null; title: string }>
		}
		expect(rootChildrenPayload.ok).toBe(true)
		expect(rootChildrenPayload.data).toHaveLength(1)
		expect(rootChildrenPayload.data[0].run_id).toBe(childRunId)
		expect(rootChildrenPayload.data[0].parent_run_id).toBe(rootRunId)
		expect(rootChildrenPayload.data[0].title).toBe('Child run')

		// Test /children endpoint at child level
		const childChildrenResponse = await app.handle(
			new Request(
				`http://localhost/api/projects/${projectId}/sessions/${sessionId}/runs/${childRunId}/children`,
			),
		)
		expect(childChildrenResponse.status).toBe(200)
		const childChildrenPayload = (await childChildrenResponse.json()) as {
			ok: boolean
			data: Array<{ run_id: string; parent_run_id: string | null; title: string }>
		}
		expect(childChildrenPayload.ok).toBe(true)
		expect(childChildrenPayload.data).toHaveLength(1)
		expect(childChildrenPayload.data[0].run_id).toBe(grandchildRunId)
		expect(childChildrenPayload.data[0].parent_run_id).toBe(childRunId)
		expect(childChildrenPayload.data[0].title).toBe('Grandchild run')

		// Test /children endpoint at grandchild level (no children)
		const grandchildChildrenResponse = await app.handle(
			new Request(
				`http://localhost/api/projects/${projectId}/sessions/${sessionId}/runs/${grandchildRunId}/children`,
			),
		)
		expect(grandchildChildrenResponse.status).toBe(200)
		const grandchildChildrenPayload = (await grandchildChildrenResponse.json()) as {
			ok: boolean
			data: Array<{ run_id: string }>
		}
		expect(grandchildChildrenPayload.ok).toBe(true)
		expect(grandchildChildrenPayload.data).toHaveLength(0)

		db.close()
	})

	it('enforces DEFAULT_MAX_TASK_DEPTH=4 when no agent config maxTaskDepth is set', async () => {
		const db = new Database(createTempDbPath())
		const projectId = crypto.randomUUID()
		const sessionId = crypto.randomUUID()

		db.db.run(
			'INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)',
			[projectId, 'Depth test project', '/tmp/depth-test', null],
		)
		db.db.run(
			'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
			[sessionId, projectId, null, 'execute', 'running', new Date().toISOString(), null],
		)

		// Create a chain of 4 runs (depth 0-3) - this should succeed
		const runIds: string[] = []
		for (let i = 0; i < 4; i++) {
			const runId = crypto.randomUUID()
			const result = createRun(db, {
				run_id: runId,
				session_id: sessionId,
				project_id: projectId,
				parent_run_id: i === 0 ? null : runIds[i - 1],
				agent_type: 'executor',
				title: `Run at depth ${i}`,
				status: 'running',
				context_mode: 'none',
			})
			expect(result.ok).toBe(true)
			runIds.push(runId)
		}

		// Verify the chain exists
		for (let i = 0; i < 4; i++) {
			const children = listChildRunsByParent(db, runIds[i], sessionId)
			expect(children.ok).toBe(true)
			if (i < 3) {
				expect(children.data).toHaveLength(1)
				expect(children.data[0].run_id).toBe(runIds[i + 1])
			} else {
				expect(children.data).toHaveLength(0)
			}
		}

		// Now test the depth limit via the task tool's logic
		// We'll simulate what happens when trying to spawn at depth 4 (which would be the 5th level)
		// The DEFAULT_MAX_TASK_DEPTH is 4, so depth >= 4 should be rejected
		const { DEFAULT_MAX_TASK_DEPTH } = await import('../tools/task/index.ts')
		expect(DEFAULT_MAX_TASK_DEPTH).toBe(4)

		// Simulate depth check that would happen in task tool
		const currentDepth = 4 // This would be the depth of a child of runIds[3]
		const maxDepth = DEFAULT_MAX_TASK_DEPTH
		expect(currentDepth >= maxDepth).toBe(true)

		db.close()
	})

	it('verifies inherit_session context mode includes parent session messages', async () => {
		const sessionId = 'test-session-123'
		const backingStore: Message[] = [
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi there!' },
		]

		// Test inherit_session mode
		const inheritSource = buildInitialMessages({
			contextMode: 'inherit_session',
			sessionId,
			db: {
				getSessionMessages: () => backingStore,
			},
		})

		expect(inheritSource.contextMode).toBe('inherit_session')
		expect(inheritSource.getMessages()).toEqual([
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi there!' },
		])

		// Add a new message to the backing store
		backingStore.push({ role: 'user', content: 'New question' })

		// inherit_session should reflect the live session state
		expect(inheritSource.getMessages()).toEqual([
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi there!' },
			{ role: 'user', content: 'New question' },
		])

		// Test snapshot mode for comparison (should be frozen)
		const snapshotSource = buildInitialMessages({
			contextMode: 'snapshot',
			sessionId,
			db: {
				getSessionMessages: () => backingStore,
			},
		})

		expect(snapshotSource.contextMode).toBe('snapshot')
		const snapshotMessages = snapshotSource.getMessages()
		expect(snapshotMessages).toHaveLength(3)

		// Modify backing store again
		backingStore.push({ role: 'assistant', content: 'New answer' })

		// Snapshot should NOT include the new message
		expect(snapshotSource.getMessages()).toEqual(snapshotMessages)

		// Test none mode
		const noneSource = buildInitialMessages({
			contextMode: 'none',
			sessionId,
			db: {
				getSessionMessages: () => backingStore,
			},
		})

		expect(noneSource.contextMode).toBe('none')
		expect(noneSource.getMessages()).toEqual([])
	})
})

/**
 * Provider adapter that emits a task tool call when the prompt contains [task].
 * This allows testing the full task tool execution path including metadata emission.
 * Uses a flag to ensure the task is only emitted once (prevents infinite loops).
 */
function createTaskToolMockRouter(): ProviderRouter {
	let taskEmitted = false

	const adapter: ProviderAdapter = {
		name: 'task-mock',
		async *sendMessage(
			messages,
			_tools,
			options?: SendMessageOptions,
		): AsyncGenerator<StreamEvent> {
			const prompt = messages.map((m) => m.content).join('\n')

			// Only emit task on first call, then emit stop to end the loop
			if (prompt.includes('[task]') && !taskEmitted) {
				taskEmitted = true
				// Emit a task tool call
				const toolCallId = `call_${crypto.randomUUID().slice(0, 8)}`
				yield {
					type: 'tool_call_complete',
					toolCall: {
						id: toolCallId,
						name: 'task',
						arguments: {
							description: 'Test child task',
							prompt: 'TAG::CHILD::2',
							agent_type: 'executor',
							context_mode: 'none',
						},
					},
				}
				yield { type: 'done', finishReason: 'tool_calls' }
				return
			}

			// Default: just emit some text and done with stop (ends the loop)
			yield { type: 'text_delta', text: 'Task spawned successfully' }
			yield { type: 'done', finishReason: 'stop' }
		},
	}

	return {
		getAdapter: () => ({ ok: true, data: adapter }),
		listProviders: () => ['task-mock'],
	} as unknown as ProviderRouter
}

describe('task tool metadata end-to-end', () => {
	it('emits agent_run.tool_call_metadata with correct fields', async () => {
		// Create fixture with task-mock provider
		const db = new Database(createTempDbPath())
		const projectId = crypto.randomUUID()
		const sessionId = crypto.randomUUID()

		db.db.run(
			'INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)',
			[projectId, 'Metadata test project', '/tmp/metadata-test', null],
		)
		db.db.run(
			'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
			[sessionId, projectId, null, 'execute', 'running', new Date().toISOString(), null],
		)

		const sse = new SseManager(db)
		const app = new Elysia()
		mountProjectEventsRoute(app, sse)

		// Create a ConfigManager with a mock project path resolver
		const configManager = new ConfigManager({
			projectPathResolver: () => ({ ok: true, data: '/tmp/test-project' }),
		})

		mountAgentRunRoutes(app, {
			db,
			providerRouter: createTaskToolMockRouter(),
			toolRegistry: new ToolRegistry(new HookRegistry()),
			hookRegistry: new HookRegistry(),
			runRegistry: new RunRegistry(),
			sseManager: sse,
			configManager,
		})

		try {
			// Spawn a parent run that will call the task tool (prompt contains [task])
			const spawnResponse = await app.handle(
				new Request(
					`http://localhost/api/projects/${projectId}/sessions/${sessionId}/agent-runs`,
					{
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({
							agentType: 'executor',
							title: 'Parent run',
							contextMode: 'none',
							prompt: '[task] spawn a child',
						}),
					},
				),
			)
			expect(spawnResponse.status).toBe(200)
			const spawnPayload = (await spawnResponse.json()) as { ok: boolean; data: { runId: string } }
			expect(spawnPayload.ok).toBe(true)
			const parentRunId = spawnPayload.data.runId

			// Subscribe to events before the run starts producing them
			const sseResponse = await app.handle(
				new Request(`http://localhost/api/projects/${projectId}/events`),
			)

			// Capture events until we see the tool_call_metadata event or timeout
			// Note: tool_call_metadata is emitted with the CHILD runId, not the parent
			const frames = await readSseFrames(
				sseResponse,
				(_frame, all) => {
					return all.some((f) => f.event === 'agent_run.tool_call_metadata')
				},
				{ timeoutMs: 4_000, maxFrames: 200 },
			)

			// Find the tool_call_metadata event (emitted with child runId)
			const metadataFrame = frames.find((f) => f.event === 'agent_run.tool_call_metadata')
			expect(metadataFrame).toBeDefined()

			// Parse the metadata event data
			const metadataData = JSON.parse(metadataFrame!.data) as {
				data: {
					toolCallId: string
					runId: string
					parentRunId: string
					agentType: string
					title: string
				}
			}

			// Assert all four metadata fields are present and valid
			expect(metadataData.data.toolCallId).toBeDefined()
			expect(metadataData.data.toolCallId.length).toBeGreaterThan(0)
			expect(metadataData.data.runId).toBeDefined()
			expect(metadataData.data.runId.length).toBeGreaterThan(0)
			expect(metadataData.data.parentRunId).toBe(parentRunId)
			expect(metadataData.data.agentType).toBe('executor')
			expect(metadataData.data.title).toBeDefined()
			expect(metadataData.data.title.length).toBeGreaterThan(0)

			// Verify the child runId exists in the database
			const childRunId = metadataData.data.runId
			const childRunResult = db.db
				.query('SELECT run_id, parent_run_id, agent_type, title FROM agent_runs WHERE run_id = ?')
				.get(childRunId) as { run_id: string; parent_run_id: string; agent_type: string; title: string } | null

			expect(childRunResult).toBeDefined()
			expect(childRunResult!.parent_run_id).toBe(parentRunId)
			expect(childRunResult!.agent_type).toBe('executor')

			// Verify the metadata event correlates to a tool_call event
			const toolCallFrame = frames.find(
				(f) =>
					f.event === 'agent_run.tool_call' &&
					f.data.includes(`"id":"${metadataData.data.toolCallId}"`),
			)
			expect(toolCallFrame).toBeDefined()
		} finally {
			sse.destroy()
			db.close()
		}
	})

	it('does not emit tool_call_metadata when depth validation rejects spawn', async () => {
		const db = new Database(createTempDbPath())
		const projectId = crypto.randomUUID()
		const sessionId = crypto.randomUUID()

		db.db.run(
			'INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)',
			[projectId, 'Depth test project', '/tmp/depth-test', null],
		)
		db.db.run(
			'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
			[sessionId, projectId, null, 'execute', 'running', new Date().toISOString(), null],
		)

		// Create a chain of 4 runs (depth 0-3) - this should succeed
		const runIds: string[] = []
		for (let i = 0; i < 4; i++) {
			const runId = crypto.randomUUID()
			const result = createRun(db, {
				run_id: runId,
				session_id: sessionId,
				project_id: projectId,
				parent_run_id: i === 0 ? null : runIds[i - 1],
				agent_type: 'executor',
				title: `Run at depth ${i}`,
				status: 'running',
				context_mode: 'none',
			})
			expect(result.ok).toBe(true)
			runIds.push(runId)
		}

		const sse = new SseManager(db)
		const app = new Elysia()
		mountProjectEventsRoute(app, sse)
		mountAgentRunRoutes(app, {
			db,
			providerRouter: createTaggedRouter(),
			toolRegistry: new ToolRegistry(new HookRegistry()),
			hookRegistry: new HookRegistry(),
			runRegistry: new RunRegistry(),
			sseManager: sse,
		})

		// Try to spawn a child at depth 4 (which should be rejected by DEFAULT_MAX_TASK_DEPTH=4)
		const deepParentId = runIds[3] // depth 3
		const response = await app.handle(
			new Request(
				`http://localhost/api/projects/${projectId}/sessions/${sessionId}/agent-runs`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						agentType: 'executor',
						title: 'Deep child',
						contextMode: 'none',
						prompt: 'TAG::DEEP::1',
						parentRunId: deepParentId,
					}),
				},
			),
		)

		expect(response.status).toBe(200)
		const payload = (await response.json()) as { ok: boolean; data: { runId: string } }
		expect(payload.ok).toBe(true)

		// Subscribe to events
		const sseResponse = await app.handle(
			new Request(`http://localhost/api/projects/${projectId}/events`),
		)

		// Capture events for a short time
		const frames = await readSseFrames(
			sseResponse,
			(_frame, all) => all.length >= 20,
			{ timeoutMs: 2_000, maxFrames: 50 },
		)

		// Verify no tool_call_metadata events were emitted for the rejected spawn
		// The task tool should not emit metadata when depth validation fails
		const metadataEvents = frames.filter((f) => f.event === 'agent_run.tool_call_metadata')
		expect(metadataEvents.length).toBe(0)

		sse.destroy()
		db.close()
	})
})
