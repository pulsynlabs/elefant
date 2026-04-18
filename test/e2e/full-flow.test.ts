import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDaemon } from '../../src/index.ts'
import { dbPath, elefantDir, statePath } from '../../src/project/paths.ts'

describe('Full daemon boot flow', () => {
	let tmpDir = ''

	afterEach(() => {
		if (!tmpDir) return
		try {
			rmSync(tmpDir, { recursive: true, force: true })
		} catch {
			// ignore cleanup failure in tests
		}
	})

	it('boots daemon, creates .elefant/ structure, shuts down cleanly', async () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'elefant-e2e-'))

		const config = {
			port: 19999,
			providers: [],
			defaultProvider: '',
			logLevel: 'error' as const,
			projectPath: tmpDir,
		}

		const result = await createDaemon(config)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		await result.data.start()

		const elefantPath = elefantDir(tmpDir)
		const dbFilePath = dbPath(tmpDir)
		const stateFilePath = statePath(tmpDir)

		expect(existsSync(elefantPath)).toBe(true)
		expect(statSync(elefantPath).isDirectory()).toBe(true)
		expect(existsSync(dbFilePath)).toBe(true)
		expect(statSync(dbFilePath).size).toBeGreaterThan(0)
		expect(existsSync(stateFilePath)).toBe(true)

		const stateContent = JSON.parse(readFileSync(stateFilePath, 'utf-8')) as {
			version: number
			project: { path: string }
		}
		expect(stateContent.version).toBe(2)
		expect(stateContent.project.path).toBe(tmpDir)

		await result.data.stop()
	})

	it('bootstrap is idempotent — running twice produces same project id', async () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'elefant-e2e-'))

		const baseConfig = {
			port: 19998,
			providers: [],
			defaultProvider: '',
			logLevel: 'error' as const,
			projectPath: tmpDir,
		}

		const first = await createDaemon(baseConfig)
		expect(first.ok).toBe(true)
		if (!first.ok) return
		await first.data.start()
		await first.data.stop()

		const state1 = JSON.parse(readFileSync(statePath(tmpDir), 'utf-8')) as {
			project: { id: string }
		}

		const second = await createDaemon({ ...baseConfig, port: 19997 })
		expect(second.ok).toBe(true)
		if (!second.ok) return
		await second.data.start()
		await second.data.stop()

		const state2 = JSON.parse(readFileSync(statePath(tmpDir), 'utf-8')) as {
			project: { id: string }
		}

		expect(state1.project.id).toBe(state2.project.id)
	})
})
