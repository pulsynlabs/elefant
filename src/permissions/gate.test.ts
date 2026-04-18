import { describe, expect, it, mock } from 'bun:test';

import type { DaemonContext } from '../daemon/context.ts';
import { HookRegistry } from '../hooks/registry.ts';
import type { ElefantWsServer } from '../transport/ws-server.ts';
import { PermissionGate } from './gate.ts';

interface MockApprovalResult {
	approved: boolean;
	reason?: string;
}

interface MockWs {
	requestApproval: (
		payload: Record<string, unknown>,
		timeoutMs: number,
	) => Promise<MockApprovalResult>;
}

function createContext(hooks: HookRegistry): DaemonContext {
	const dbStub = {
		db: {
			query: () => ({
				get: () => null,
			}),
		},
	};

	return {
		hooks,
		db: dbStub,
	} as unknown as DaemonContext;
}

describe('PermissionGate', () => {
	it('auto-approves low-risk tool without WebSocket approval call', async () => {
		const hooks = new HookRegistry();
		const ws: MockWs = {
			requestApproval: mock(async () => ({ approved: true })),
		};

		const gate = new PermissionGate(
			createContext(hooks),
			ws as unknown as ElefantWsServer,
		);

		const result = await gate.check('read', { path: '/tmp/file.txt' }, 'conv-low');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.approved).toBe(true);
			expect(result.data.risk).toBe('low');
		}

		expect(ws.requestApproval).toHaveBeenCalledTimes(0);
	});

	it('auto-approves medium-risk tool and logs', async () => {
		const hooks = new HookRegistry();
		const originalLog = console.log;
		const logSpy = mock(() => {});
		console.log = logSpy;

		const gate = new PermissionGate(createContext(hooks), null);
		const result = await gate.check('write', { path: '/tmp/file.txt' }, 'conv-medium');

		console.log = originalLog;

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.approved).toBe(true);
			expect(result.data.risk).toBe('medium');
		}
		expect(logSpy).toHaveBeenCalledTimes(1);
	});

	it('denies high-risk tool when WebSocket is unavailable', async () => {
		const hooks = new HookRegistry();
		const gate = new PermissionGate(createContext(hooks), null);

		const result = await gate.check('webfetch', { url: 'https://example.com' }, 'conv-nowebsocket');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.approved).toBe(false);
			expect(result.data.risk).toBe('high');
			expect(result.data.reason).toContain('requires approval');
		}
	});

	it('approves high-risk tool when WebSocket approval is granted', async () => {
		const hooks = new HookRegistry();
		const ws: MockWs = {
			requestApproval: mock(async () => ({ approved: true, reason: 'approved by user' })),
		};

		const gate = new PermissionGate(
			createContext(hooks),
			ws as unknown as ElefantWsServer,
		);

		const result = await gate.check('webfetch', { url: 'https://example.com' }, 'conv-approve');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.approved).toBe(true);
			expect(result.data.risk).toBe('high');
		}
		expect(ws.requestApproval).toHaveBeenCalledTimes(1);
	});

	it('denies high-risk tool when WebSocket approval is denied', async () => {
		const hooks = new HookRegistry();
		const ws: MockWs = {
			requestApproval: mock(async () => ({ approved: false, reason: 'denied by user' })),
		};

		const gate = new PermissionGate(
			createContext(hooks),
			ws as unknown as ElefantWsServer,
		);

		const result = await gate.check('webfetch', { url: 'https://example.com' }, 'conv-deny');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.approved).toBe(false);
			expect(result.data.risk).toBe('high');
		}
		expect(ws.requestApproval).toHaveBeenCalledTimes(1);
	});

	it('fires permission and allow/block hooks with expected payloads', async () => {
		const hooks = new HookRegistry();
		const permissionAskCalls: Array<{ tool: string; risk: 'low' | 'medium' | 'high' }> = [];
		const allowCalls: string[] = [];
		const blockCalls: string[] = [];

		hooks.register('permission:ask', (ctx) => {
			permissionAskCalls.push({ tool: ctx.tool, risk: ctx.risk });
		});
		hooks.register('tool:allow', (ctx) => {
			allowCalls.push(ctx.tool);
		});
		hooks.register('tool:block', (ctx) => {
			blockCalls.push(ctx.tool);
		});

		const gate = new PermissionGate(createContext(hooks), null);

		await gate.check('read', { path: '/tmp/ok.txt' }, 'conv-hooks-allow');
		await gate.check('webfetch', { url: 'https://example.com' }, 'conv-hooks-block');

		expect(permissionAskCalls).toEqual([
			{ tool: 'read', risk: 'low' },
			{ tool: 'webfetch', risk: 'high' },
		]);
		expect(allowCalls).toEqual(['read']);
		expect(blockCalls).toEqual(['webfetch']);
	});

	it('supports plugin reclassification via permission:ask result merge', async () => {
		const hooks = new HookRegistry();
		hooks.register('permission:ask', () => ({ risk: 'low' }));

		const gate = new PermissionGate(createContext(hooks), null);
		const result = await gate.check('webfetch', { url: 'https://example.com' }, 'conv-reclassify');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.risk).toBe('low');
			expect(result.data.approved).toBe(true);
		}
	});
});
