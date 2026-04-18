import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test'

import type { DaemonContext } from '../daemon/context.ts'
import { HookRegistry } from '../hooks/registry.ts'
import { PermissionGate } from './gate.ts'
import type { ElefantWsServer } from '../transport/ws-server.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockContext(hooks: HookRegistry): DaemonContext {
	const dbStub = {
		db: {
			query: () => ({
				get: () => null,
				all: () => [],
				run: () => {},
			}),
		},
	}

	return {
		config: { projectPath: '/tmp/test-project', port: 0 },
		hooks,
		tools: {} as DaemonContext['tools'],
		providers: {} as DaemonContext['providers'],
		project: {
			projectId: 'test-project-id',
			projectPath: '/tmp/test-project',
			elefantDir: '/tmp/test-project/.elefant',
			dbPath: '/tmp/test-project/.elefant/db.sqlite',
			statePath: '/tmp/test-project/.elefant/state.json',
			logsDir: '/tmp/test-project/.elefant/logs',
			checkpointsDir: '/tmp/test-project/.elefant/checkpoints',
			memoryDir: '/tmp/test-project/.elefant/memory',
		},
		db: dbStub as unknown as DaemonContext['db'],
		state: {} as DaemonContext['state'],
		plugins: {} as DaemonContext['plugins'],
		ws: {} as DaemonContext['ws'],
		sse: {} as DaemonContext['sse'],
		permissions: {} as DaemonContext['permissions'],
	}
}

function createMockWs(approvalResult: { approved: boolean; reason?: string }): ElefantWsServer {
	return {
		requestApproval: mock(async () => approvalResult),
		broadcastToRoom: mock(() => {}),
	} as unknown as ElefantWsServer
}

// ---------------------------------------------------------------------------
// Integration: PermissionGate with hooks
// ---------------------------------------------------------------------------

describe('PermissionGate integration', () => {
	it('low-risk tool is auto-approved without WS call', async () => {
		const hooks = new HookRegistry()
		const ctx = createMockContext(hooks)
		const ws = createMockWs({ approved: true })

		const gate = new PermissionGate(ctx, ws)
		const result = await gate.check('read', { path: '/project/file.txt' }, 'conv-1')

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.data.approved).toBe(true)
			expect(result.data.risk).toBe('low')
		}
	})

	it('high-risk tool is denied when WS is null', async () => {
		const hooks = new HookRegistry()
		const ctx = createMockContext(hooks)

		const gate = new PermissionGate(ctx, null)
		const result = await gate.check('bash', { command: 'rm -rf /tmp' }, 'conv-2')

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.data.approved).toBe(false)
			expect(result.data.risk).toBe('high')
			expect(result.data.reason).toContain('no WebSocket')
		}
	})

	it('permission:ask hook fires during check and can reclassify risk', async () => {
		const hooks = new HookRegistry()
		const ctx = createMockContext(hooks)
		const ws = createMockWs({ approved: true })

		let hookFired = false
		let capturedRisk: string | undefined

		hooks.register('permission:ask', async (ctx) => {
			hookFired = true
			capturedRisk = ctx.risk
			return ctx
		}, { priority: 10 })

		const gate = new PermissionGate(ctx, ws)
		await gate.check('read', { path: '/project/file.txt' }, 'conv-3')

		expect(hookFired).toBe(true)
		expect(capturedRisk).toBe('low')
	})

	it('tool:allow hook fires when a tool is approved', async () => {
		const hooks = new HookRegistry()
		const ctx = createMockContext(hooks)
		const ws = createMockWs({ approved: true })

		let allowFired = false
		let capturedTool: string | undefined

		hooks.register('tool:allow', async (ctx) => {
			allowFired = true
			capturedTool = ctx.tool
			return ctx
		})

		const gate = new PermissionGate(ctx, ws)
		await gate.check('read_file', { path: '/project/file.txt' }, 'conv-4')

		expect(allowFired).toBe(true)
		expect(capturedTool).toBe('read_file')
	})

	it('tool:block hook fires when a tool is denied', async () => {
		const hooks = new HookRegistry()
		const ctx = createMockContext(hooks)

		let blockFired = false
		let capturedReason: string | undefined

		hooks.register('tool:block', async (ctx) => {
			blockFired = true
			capturedReason = ctx.reason
			return ctx
		})

		const gate = new PermissionGate(ctx, null)
		await gate.check('bash', { command: 'rm -rf /' }, 'conv-5')

		expect(blockFired).toBe(true)
		expect(capturedReason).toContain('no WebSocket')
	})

	it('high-risk tool with WS goes through approval flow', async () => {
		const hooks = new HookRegistry()
		const ctx = createMockContext(hooks)
		const ws = createMockWs({ approved: true, reason: 'user approved' })

		const gate = new PermissionGate(ctx, ws)
		const result = await gate.check('bash', { command: 'rm -rf /tmp' }, 'conv-6')

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.data.approved).toBe(true)
			expect(result.data.risk).toBe('high')
		}
	})

	it('high-risk tool denied by user returns denied decision', async () => {
		const hooks = new HookRegistry()
		const ctx = createMockContext(hooks)
		const ws = createMockWs({ approved: false, reason: 'unsafe command' })

		const gate = new PermissionGate(ctx, ws)
		const result = await gate.check('bash', { command: 'rm -rf /' }, 'conv-7')

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.data.approved).toBe(false)
			expect(result.data.reason).toBe('unsafe command')
		}
	})

	it('medium-risk tool is auto-approved and logged', async () => {
		const hooks = new HookRegistry()
		const ctx = createMockContext(hooks)
		const ws = createMockWs({ approved: true })

		const gate = new PermissionGate(ctx, ws)
		const result = await gate.check('write', { path: '/project/file.txt', content: 'hello' }, 'conv-8')

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.data.approved).toBe(true)
			expect(result.data.risk).toBe('medium')
			expect(result.data.reason).toContain('medium risk')
		}
	})
})
