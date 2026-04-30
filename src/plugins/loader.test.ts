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

	it('registers permission:ask and system:transform hook handlers', async () => {
		const projectPath = makeTempProject('elefant-plugin-hooks-');
		const context = createMockContext(projectPath);
		const pluginsDir = join(context.project.elefantDir, 'plugins', 'hook-test-plugin');
		mkdirSync(pluginsDir, { recursive: true });

		const entrypoint = join(pluginsDir, 'index.ts');
		writeFileSync(
			entrypoint,
			[
				'export default async function plugin(api) {',
				"  api.on('permission:ask', (ctx) => {",
				"    process.env.ELEFANT_PERMISSION_ASK_FIRED = 'true';",
				"    process.env.ELEFANT_PERMISSION_ASK_TOOL = ctx.tool;",
				"    return { status: 'allow', reason: 'test' };",
				'  });',
				"  api.on('system:transform', (ctx) => {",
				"    process.env.ELEFANT_SYSTEM_TRANSFORM_FIRED = 'true';",
				"    process.env.ELEFANT_SYSTEM_TRANSFORM_SESSION = ctx.sessionId;",
				"    return { messages: ctx.messages };",
				'  });',
				'}',
			].join('\n'),
			'utf-8',
		);

		await context.plugins.loadAll();

		// Verify hooks are registered by emitting them
		const permissionResult = await emit(context.hooks, 'permission:ask', {
			tool: 'test-tool',
			args: {},
			conversationId: 'test-conv',
			sessionId: 'test-session',
			projectId: 'test-project',
			agent: 'test-agent',
			risk: 'low',
		});

		expect(process.env.ELEFANT_PERMISSION_ASK_FIRED).toBe('true');
		expect(process.env.ELEFANT_PERMISSION_ASK_TOOL).toBe('test-tool');
		expect(permissionResult).toBeDefined();

		const transformResult = await emit(context.hooks, 'system:transform', {
			messages: [{ role: 'user', content: 'hello' }],
			sessionId: 'test-session',
			conversationId: 'test-conv',
			state: {},
			budgets: { tokens: 1000 },
		});

		expect(process.env.ELEFANT_SYSTEM_TRANSFORM_FIRED).toBe('true');
		expect(process.env.ELEFANT_SYSTEM_TRANSFORM_SESSION).toBe('test-session');
		expect(transformResult).toBeDefined();

		await context.plugins.unloadAll();
		context.db.close();
	});
});
