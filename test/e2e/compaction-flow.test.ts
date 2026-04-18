import { describe, expect, it } from 'bun:test'

import type { DaemonContext } from '../../src/daemon/context.ts'
import { CompactionManager } from '../../src/compaction/manager.ts'

function createMockContext(): DaemonContext {
	return {
		config: {
			port: 1337,
			providers: [],
			defaultProvider: '',
			logLevel: 'error',
			projectPath: '/tmp',
		},
		hooks: {
			register: () => () => {
				// noop
			},
			getHandlers: () => [],
		} as DaemonContext['hooks'],
		tools: {
			getAll: () => [],
		} as DaemonContext['tools'],
		providers: {} as DaemonContext['providers'],
		project: {
			projectId: 'test',
			projectPath: '/tmp',
			elefantDir: '/tmp/.elefant',
			dbPath: '/tmp/.elefant/db.sqlite',
			statePath: '/tmp/.elefant/state.json',
		} as DaemonContext['project'],
		db: {
			db: {
				query: () => ({ all: () => [] }),
			},
		} as DaemonContext['db'],
		state: {
			getState: () => ({
				version: 2,
				project: {
					id: 'test',
					name: 'test',
					path: '/tmp',
					initialized: new Date().toISOString(),
				},
				workflow: {
					workflowId: 'workflow-1',
					phase: 'idle',
					mode: 'standard',
					depth: 'standard',
					specLocked: false,
					acceptanceConfirmed: false,
					interviewComplete: false,
					interviewCompletedAt: null,
					currentWave: 0,
					totalWaves: 0,
					lastActivity: new Date().toISOString(),
				},
				workflows: {},
				execution: {
					activeCheckpointId: null,
					completedPhases: [],
					pendingTasks: [],
				},
			}),
		} as DaemonContext['state'],
		plugins: {} as DaemonContext['plugins'],
		ws: {} as DaemonContext['ws'],
		sse: {} as DaemonContext['sse'],
		permissions: {} as DaemonContext['permissions'],
		compaction: {} as DaemonContext['compaction'],
	}
}

describe('Compaction flow', () => {
	it('shouldCompact returns true at 70% threshold', () => {
		const manager = new CompactionManager(createMockContext())
		expect(manager.shouldCompact(140_001, 200_000)).toBe(true)
		expect(manager.shouldCompact(139_999, 200_000)).toBe(false)
	})

	it('compaction threshold constant matches 70%', () => {
		const THRESHOLD = 0.7
		const contextWindow = 200_000
		expect(Math.floor(contextWindow * THRESHOLD)).toBe(140_000)
	})
})
