import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Database } from '../db/database.ts'
import { SseManager, formatSseEvent } from './sse-manager.ts'

const tempDirs: string[] = []

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true })
	}
})

describe('formatSseEvent', () => {
	it('formats an SSE event payload with id, event, and data lines', () => {
		expect(formatSseEvent('evt-1', 'project:open', { projectId: 'p1' })).toBe(
			'id: evt-1\nevent: project:open\ndata: {"projectId":"p1"}\n\n',
		)
	})
})

	describe('SseManager', () => {
	it('subscribe returns SSE response headers', () => {
		const { db, manager } = createFixture()
		const response = manager.subscribe('proj-1')

		expect(response.headers.get('Content-Type')).toBe('text/event-stream')
		expect(response.headers.get('Cache-Control')).toBe('no-cache')
		expect(response.headers.get('Connection')).toBe('keep-alive')

		manager.destroy()
		db.close()
	})

	it('publish sends events to all active subscribers in project', async () => {
		const { db, manager } = createFixture()

		const responseA = manager.subscribe('proj-1')
		const responseB = manager.subscribe('proj-1')

		const readerA = responseA.body?.getReader()
		const readerB = responseB.body?.getReader()
		expect(readerA).toBeDefined()
		expect(readerB).toBeDefined()
		if (!readerA || !readerB) return

		await readerA.read()
		await readerB.read()

		manager.publish('proj-1', 'session-1', 'session:start', { step: 1 })

		const chunkA = await readerA.read()
		const chunkB = await readerB.read()

		const textA = decodeChunk(chunkA.value)
		const textB = decodeChunk(chunkB.value)

		expect(textA).toContain('event: session:start')
		expect(textA).toContain('"step":1')
		expect(textB).toContain('event: session:start')
		expect(textB).toContain('"step":1')

		await readerA.cancel()
		await readerB.cancel()
		manager.destroy()
		db.close()
	})

	it('destroy clears active project connections', async () => {
		const { db, manager } = createFixture()
		const response = manager.subscribe('proj-1')
		const reader = response.body?.getReader()
		expect(reader).toBeDefined()
		if (!reader) return

		await reader.read()
		expect(manager.getConnectionCount('proj-1')).toBe(1)

		manager.destroy()
		expect(manager.getConnectionCount('proj-1')).toBe(0)

		await reader.cancel()
		db.close()
	})
})

function createFixture(): { db: Database; manager: SseManager } {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-sse-'))
	tempDirs.push(dir)

	const db = new Database(join(dir, 'db.sqlite'))
	db.db.run('INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)', [
		'proj-1',
		'Project 1',
		'/tmp/project-1',
		null,
	])
	db.db.run(
		'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
		['session-1', 'proj-1', null, 'idle', 'running', new Date().toISOString(), null],
	)

	const manager = new SseManager(db)
	return { db, manager }
}

function decodeChunk(chunk: Uint8Array | undefined): string {
	if (!chunk) return ''
	return new TextDecoder().decode(chunk)
}
