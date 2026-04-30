import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigManager } from '../config/loader.ts';
import { MCPManager } from './manager.ts';

const tempDirs: string[] = [];

function createFilesystemConfigManager(): { manager: ConfigManager; serverId: string } {
	const serverId = '00000000-0000-4000-8000-000000000751';
	const dir = mkdtempSync(join(tmpdir(), 'elefant-mcp-e2e-'));
	tempDirs.push(dir);
	const configPath = join(dir, 'elefant.config.json');
	writeFileSync(configPath, JSON.stringify({
		providers: [],
		defaultProvider: '',
		mcp: [
			{
				id: serverId,
				name: 'filesystem-smoke',
				transport: 'stdio',
				command: ['bunx', '@modelcontextprotocol/server-filesystem', '/tmp'],
				timeout: 30_000,
			},
		],
		tokenBudgetPercent: 10,
	}, null, 2));

	return { manager: new ConfigManager({ globalConfigPath: configPath }), serverId };
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('MCP filesystem e2e smoke', () => {
	test.skipIf(process.env.CI === '1')('connects to filesystem server, lists tools, calls list_directory, and shuts down cleanly', async () => {
		const { manager: configManager, serverId } = createFilesystemConfigManager();
		const manager = new MCPManager(configManager);

		try {
			await manager.init();
			expect(manager.getStatus(serverId)).toBe('connected');

			const tools = await manager.listTools(serverId);
			expect(tools.length).toBeGreaterThanOrEqual(1);
			expect(tools.some((tool) => tool.name === 'list_directory')).toBe(true);

			const result = await manager.callTool(serverId, 'list_directory', { path: '/tmp' });
			expect(result.isError).not.toBe(true);
			expect(Array.isArray(result.content)).toBe(true);
			expect(result.content.length).toBeGreaterThan(0);
		} finally {
			await manager.shutdown();
			expect(manager.getStatus(serverId)).toBeUndefined();
		}
	}, 45_000);
});
