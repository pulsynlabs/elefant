import { afterEach, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fetchAnthropicRegistry, invalidateAnthropicCache } from './anthropic.ts';
import { getBundledRegistry } from './bundled.ts';
import { fetchSmitheryRegistry } from './smithery.ts';
import { createMcpRoutes } from '../../server/mcp-routes.ts';
import type { MCPManager } from '../manager.ts';

const tempDirs: string[] = [];

function createMockMCPManager(): MCPManager {
	return {
		getStatus: () => undefined,
		getPinnedTools: () => [],
		connect: async () => undefined,
		disconnect: async () => undefined,
		reconnect: async () => undefined,
		listTools: async () => [],
		getTimeout: () => 30_000,
		searchTools: () => [],
		getServerForTool: () => undefined,
		listAllTools: () => [],
		callTool: async () => ({ content: [] }),
		init: async () => undefined,
		shutdown: async () => undefined,
	} as unknown as MCPManager;
}

function setupApp(): Elysia {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-mcp-offline-'));
	tempDirs.push(dir);
	const configPath = join(dir, 'elefant.config.json');
	writeFileSync(configPath, JSON.stringify({ providers: [], defaultProvider: '', mcp: [] }));
	return createMcpRoutes(new Elysia(), createMockMCPManager(), { configPath });
}

afterEach(() => {
	delete process.env.ELEFANT_DISABLE_NONESSENTIAL_TRAFFIC;
	invalidateAnthropicCache();
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('offline MCP registry behavior', () => {
	it('disables network-backed registries and preserves bundled entries', async () => {
		process.env.ELEFANT_DISABLE_NONESSENTIAL_TRAFFIC = '1';

		await expect(fetchAnthropicRegistry()).resolves.toEqual([]);
		await expect(fetchSmitheryRegistry({})).resolves.toEqual({ entries: [], hasMore: false });
		expect(getBundledRegistry().length).toBeGreaterThanOrEqual(30);
	});

	it('serves only bundled data from source=all when nonessential traffic is disabled', async () => {
		process.env.ELEFANT_DISABLE_NONESSENTIAL_TRAFFIC = '1';
		const app = setupApp();

		const response = await app.handle(new Request('http://localhost/api/mcp/registry?source=all'));
		const body = await response.json() as {
			ok: boolean;
			data: { anthropic: unknown[]; smithery: unknown[]; bundled: unknown[]; hasMore: boolean };
		};

		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.data.anthropic).toEqual([]);
		expect(body.data.smithery).toEqual([]);
		expect(body.data.bundled.length).toBeGreaterThanOrEqual(30);
		expect(body.data.hasMore).toBe(false);
	});
});
