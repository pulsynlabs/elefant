import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ElefantConfig } from '../config/schema.ts';
import { Database } from '../db/database.ts';
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

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}

	delete process.env.ELEFANT_PLUGIN_LOADER_FLAG;
	delete process.env.ELEFANT_PLUGIN_LOADS;
});

describe('PluginLoader', () => {
	it('discovers project plugins and loads them', async () => {
		const projectPath = makeTempProject('elefant-plugin-loader-');
		const context = createMockContext(projectPath);
		const pluginsDir = join(context.project.elefantDir, 'plugins', 'my-plugin');
		mkdirSync(pluginsDir, { recursive: true });

		const entrypoint = join(pluginsDir, 'index.ts');
		writeFileSync(
			entrypoint,
			[
				"export default async function plugin(_api) {",
				"  process.env.ELEFANT_PLUGIN_LOADER_FLAG = 'loaded';",
				"  const current = Number(process.env.ELEFANT_PLUGIN_LOADS ?? '0');",
				"  process.env.ELEFANT_PLUGIN_LOADS = String(current + 1);",
				'}',
			].join('\n'),
			'utf-8',
		);

		const discovered = context.plugins.discover();
		expect(discovered).toContain(entrypoint);

		await context.plugins.loadAll();
		expect(process.env.ELEFANT_PLUGIN_LOADER_FLAG).toBe('loaded');
		expect(process.env.ELEFANT_PLUGIN_LOADS).toBe('1');

		await context.plugins.unloadAll();
		context.db.close();
	});
});
