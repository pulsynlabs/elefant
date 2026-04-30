import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigManager } from '../config/loader.ts';
import { MCPManager } from './manager.ts';

const tempDirs: string[] = [];

function createConfigManager(config: Record<string, unknown>): ConfigManager {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-mcp-manager-test-'));
	tempDirs.push(dir);
	const configPath = join(dir, 'elefant.config.json');
	writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
	return new ConfigManager({ globalConfigPath: configPath });
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('MCPManager', () => {
	it('runs init without error when zero servers are configured', async () => {
		const manager = new MCPManager(createConfigManager({ mcp: [] }));

		await expect(manager.init()).resolves.toBeUndefined();
	});

	it('returns undefined for unknown server status', () => {
		const manager = new MCPManager(createConfigManager({ mcp: [] }));

		expect(manager.getStatus('missing')).toBeUndefined();
	});

	it('runs shutdown without error on empty state', async () => {
		const manager = new MCPManager(createConfigManager({ mcp: [] }));

		await expect(manager.shutdown()).resolves.toBeUndefined();
	});

	it('stores disabled servers with disabled status after init', async () => {
		const disabledServerId = '00000000-0000-4000-8000-000000000001';
		const manager = new MCPManager(createConfigManager({
			mcp: [
				{
					id: disabledServerId,
					name: 'local-filesystem',
					transport: 'stdio',
					command: ['bunx', '@modelcontextprotocol/server-filesystem', '/tmp'],
					enabled: false,
				},
			],
		}));

		await manager.init();

		expect(manager.getStatus(disabledServerId)).toBe('disabled');
	});
});
