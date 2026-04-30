import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ElefantConfig } from '../config/schema.ts';
import { Database } from '../db/database.ts';
import { emit } from '../hooks/emit.ts';
import { HookRegistry } from '../hooks/registry.ts';
import { dbPath, elefantDir, statePath } from '../project/paths.ts';
import type { ProjectInfo } from '../project/types.ts';
import { ProviderRouter } from '../providers/router.ts';
import { StateManager } from '../state/manager.ts';
import { createToolRegistry } from '../tools/registry.ts';
import type { DaemonContext } from '../daemon/context.ts';
import { PluginLoader } from './loader.ts';

const tempDirs: string[] = [];

function makeTempProject(prefix: string): string {
	const projectDir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(projectDir);
	return projectDir;
}

function createConfig(projectPath: string): ElefantConfig {
	return {
		port: 0,
		providers: [],
		defaultProvider: '',
		logLevel: 'info',
		projectPath,
		mcp: [],
		tokenBudgetPercent: 10,
	};
}

function createProjectInfo(projectPath: string): ProjectInfo {
	const root = elefantDir(projectPath);
	return {
		projectId: `project-${crypto.randomUUID()}`,
		projectPath,
		elefantDir: root,
		dbPath: dbPath(projectPath),
		statePath: statePath(projectPath),
		logsDir: join(root, 'logs'),
		checkpointsDir: join(root, 'checkpoints'),
		memoryDir: join(root, 'memory'),
	};
}

function createMockContext(projectPath: string): DaemonContext {
	const project = createProjectInfo(projectPath);
	mkdirSync(project.elefantDir, { recursive: true });
	mkdirSync(project.logsDir, { recursive: true });
	mkdirSync(project.checkpointsDir, { recursive: true });
	mkdirSync(project.memoryDir, { recursive: true });
	mkdirSync(join(project.elefantDir, 'plugins'), { recursive: true });

	const config = createConfig(projectPath);
	const hooks = new HookRegistry();
	const tools = createToolRegistry(hooks);
	const providers = new ProviderRouter(config);
	const db = new Database(project.dbPath);
	const state = new StateManager(projectPath, {
		id: project.projectId,
		name: 'test-project',
		path: projectPath,
	});

	const base = {
		config,
		hooks,
		tools,
		providers,
		project,
		db,
		state,
	} as Omit<DaemonContext, 'plugins'>;

	const context = base as DaemonContext;
	const loader = new PluginLoader(context);
	context.plugins = loader;
	return context;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}

	delete process.env.ELEFANT_ISOLATION_FACTORY_OK;
	delete process.env.ELEFANT_ISOLATION_HANDLER_OK;
});

describe('plugin isolation', () => {
	it('continues loading when one plugin factory throws', async () => {
		const projectPath = makeTempProject('elefant-plugin-isolation-factory-');
		const context = createMockContext(projectPath);
		const pluginsBase = join(context.project.elefantDir, 'plugins');

		const badPluginDir = join(pluginsBase, 'bad-plugin');
		mkdirSync(badPluginDir, { recursive: true });
		writeFileSync(
			join(badPluginDir, 'index.ts'),
			[
				'export default function badPlugin() {',
				"  throw new Error('factory exploded');",
				'}',
			].join('\n'),
			'utf-8',
		);

		const goodPluginDir = join(pluginsBase, 'good-plugin');
		mkdirSync(goodPluginDir, { recursive: true });
		writeFileSync(
			join(goodPluginDir, 'index.ts'),
			[
				'export default function goodPlugin() {',
				"  process.env.ELEFANT_ISOLATION_FACTORY_OK = '1';",
				'}',
			].join('\n'),
			'utf-8',
		);

		await context.plugins.loadAll();
		expect(process.env.ELEFANT_ISOLATION_FACTORY_OK).toBe('1');

		await context.plugins.unloadAll();
		context.db.close();
	});

	it('isolates plugin hook handler failures and keeps chain running', async () => {
		const projectPath = makeTempProject('elefant-plugin-isolation-hook-');
		const context = createMockContext(projectPath);
		const pluginDir = join(context.project.elefantDir, 'plugins', 'hook-plugin');
		mkdirSync(pluginDir, { recursive: true });

		writeFileSync(
			join(pluginDir, 'index.ts'),
			[
				'export default function hookPlugin(api) {',
				"  api.on('project:open', async () => {",
				"    throw new Error('hook failed');",
				'  });',
				"  api.on('project:open', async () => {",
				"    process.env.ELEFANT_ISOLATION_HANDLER_OK = '1';",
				'  });',
				'}',
			].join('\n'),
			'utf-8',
		);

		await context.plugins.loadAll();

		await expect(
			emit(context.hooks, 'project:open', {
				projectId: context.project.projectId,
				projectPath: context.project.projectPath,
				elefantDir: context.project.elefantDir,
			}),
		).resolves.toBeDefined();

		expect(process.env.ELEFANT_ISOLATION_HANDLER_OK).toBe('1');

		await context.plugins.unloadAll();
		context.db.close();
	});
});
