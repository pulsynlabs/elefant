import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { ElefantConfig } from '../config/schema.ts';
import type { DaemonContext } from '../daemon/context.ts';
import { Database } from '../db/database.ts';
import { emit } from '../hooks/emit.ts';
import { HookRegistry } from '../hooks/registry.ts';
import { PluginLoader } from './loader.ts';
import { dbPath, elefantDir, statePath } from '../project/paths.ts';
import type { ProjectInfo } from '../project/types.ts';
import { ProviderRouter } from '../providers/router.ts';
import { StateManager } from '../state/manager.ts';
import { createToolRegistry } from '../tools/registry.ts';

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
});

describe('example plugin', () => {
	it('loads and registers hook + tool without crashing', async () => {
		const projectPath = makeTempProject('elefant-plugin-example-');
		const context = createMockContext(projectPath);
		const loader = context.plugins;

		const exampleEntrypoint = resolve('src/plugins/example/index.ts');
		const invokeLoadOne = loader as unknown as { loadOne: (entrypoint: string) => Promise<void> };
		await invokeLoadOne.loadOne(exampleEntrypoint);

		await expect(
			emit(context.hooks, 'project:open', {
				projectId: context.project.projectId,
				projectPath: context.project.projectPath,
				elefantDir: context.project.elefantDir,
			}),
		).resolves.toBeDefined();

		const helloTool = context.tools.get('hello');
		expect(helloTool.ok).toBe(true);

		await context.plugins.unloadAll();
		context.db.close();
	});
});
