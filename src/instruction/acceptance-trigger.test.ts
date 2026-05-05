import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { HookRegistry } from '../hooks/registry.ts';
import { emit } from '../hooks/emit.ts';
import type { ElefantConfig } from '../config/schema.ts';
import type { ConfigManager, ConfigError } from '../config/loader.ts';
import type { LoadedInstruction, InstructionService } from './types.ts';
import { registerAcceptanceTrigger, type AcceptanceTriggerDeps } from './acceptance-trigger.ts';

const tempDirs: string[] = [];

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-acceptance-trigger-'));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tempDirs.length = 0;
});

function mockConfigManager(autoUpdate: boolean): ConfigManager {
	return {
		getConfig: async () => ({
			ok: true,
			data: { agentsMd: { autoUpdate } } as ElefantConfig,
		}),
	} as ConfigManager;
}

function mockConfigManagerThrowing(): ConfigManager {
	return {
		getConfig: async () => {
			throw new Error('Failed to read config');
		},
	} as unknown as ConfigManager;
}

function mockConfigManagerErr(): ConfigManager {
	return {
		getConfig: async () => ({
			ok: false,
			error: { code: 'FILE_NOT_FOUND', message: 'config not found' } as ConfigError,
		}),
	} as ConfigManager;
}

function mockInstructionService(existingContent: string | null): InstructionService {
	return {
		resolveRoot: async (): Promise<LoadedInstruction | null> => {
			if (existingContent === null) return null;
			return { filepath: join('/fake', 'AGENTS.md'), content: existingContent };
		},
		resolveForFile: async () => [],
		invalidate: () => {},
		invalidateAll: () => {},
	} satisfies InstructionService;
}

function mockInstructionServiceThrowing(): InstructionService {
	return {
		resolveRoot: async () => {
			throw new Error('instruction read failed');
		},
		resolveForFile: async () => [],
		invalidate: () => {},
		invalidateAll: () => {},
	} satisfies InstructionService;
}

interface WriterCall {
	mode: 'update';
	projectRoot: string;
	codebaseDigest: unknown;
	priorContent: string | null;
	chronicleSummary?: string;
}

function createDeps({
	autoUpdate = true,
	existingContent = null as string | null,
	configThrows = false,
	configErr = false,
}: {
	autoUpdate?: boolean;
	existingContent?: string | null;
	configThrows?: boolean;
	configErr?: boolean;
} = {}): {
	deps: AcceptanceTriggerDeps;
	calls: WriterCall[];
	registry: HookRegistry;
	projectRoot: string;
} {
	const calls: WriterCall[] = [];
	const registry = new HookRegistry();
	const projectRoot = createTempDir();

	// Create a minimal project so analyzeCodebase runs without error
	writeFileSync(
		join(projectRoot, 'package.json'),
		JSON.stringify({ name: 'test-project', scripts: { test: 'bun test' } }),
	);

	let configManager: ConfigManager;
	if (configThrows) {
		configManager = mockConfigManagerThrowing();
	} else if (configErr) {
		configManager = mockConfigManagerErr();
	} else {
		configManager = mockConfigManager(autoUpdate);
	}

	const deps: AcceptanceTriggerDeps = {
		hookRegistry: registry,
		configManager,
		instructionService: mockInstructionService(existingContent),
		projectRoot,
		spawnWriter: async (prompt) => {
			calls.push(prompt as WriterCall);
		},
	};

	return { deps, calls, registry, projectRoot };
}

describe('registerAcceptanceTrigger', () => {
	test('autoUpdate=true → spawnWriter called', async () => {
		const { deps, calls, registry } = createDeps({ autoUpdate: true });
		registerAcceptanceTrigger(deps);

		await emit(registry, 'spec:acceptance_confirmed', {
			projectId: 'proj-1',
			workflowId: 'wf-123',
			confirmedAt: new Date().toISOString(),
		});

		expect(calls.length).toBe(1);
		expect(calls[0].mode).toBe('update');
		expect(calls[0].projectRoot).toBe(deps.projectRoot);
		expect(calls[0].codebaseDigest).toBeDefined();
		expect(calls[0].priorContent).toBeNull();
	});

	test('autoUpdate=false → spawnWriter NOT called', async () => {
		const { deps, calls, registry } = createDeps({ autoUpdate: false });
		registerAcceptanceTrigger(deps);

		await emit(registry, 'spec:acceptance_confirmed', {
			projectId: 'proj-2',
			workflowId: 'wf-456',
			confirmedAt: new Date().toISOString(),
		});

		expect(calls.length).toBe(0);
	});

	test('Config read failure → spawnWriter NOT called (fail-open)', async () => {
		const { deps, calls, registry } = createDeps({ configThrows: true });
		registerAcceptanceTrigger(deps);

		await emit(registry, 'spec:acceptance_confirmed', {
			projectId: 'proj-3',
			workflowId: 'wf-789',
			confirmedAt: new Date().toISOString(),
		});

		expect(calls.length).toBe(0);
	});

	test('Config error result → spawnWriter NOT called (fail-open)', async () => {
		const { deps, calls, registry } = createDeps({ configErr: true });
		registerAcceptanceTrigger(deps);

		await emit(registry, 'spec:acceptance_confirmed', {
			projectId: 'proj-4',
			workflowId: 'wf-101',
			confirmedAt: new Date().toISOString(),
		});

		expect(calls.length).toBe(0);
	});

	test('spawnWriter receives priorContent when AGENTS.md exists', async () => {
		const { deps, calls, registry } = createDeps({
			autoUpdate: true,
			existingContent: '# Existing instructions\nUse tabs for indentation.',
		});
		registerAcceptanceTrigger(deps);

		await emit(registry, 'spec:acceptance_confirmed', {
			projectId: 'proj-5',
			workflowId: 'wf-202',
			confirmedAt: new Date().toISOString(),
		});

		expect(calls.length).toBe(1);
		expect(calls[0].priorContent).toBe('# Existing instructions\nUse tabs for indentation.');
	});

	test('InstructionService resolveRoot throws → spawnWriter still called with null priorContent', async () => {
		const projectRoot = createTempDir();
		writeFileSync(
			join(projectRoot, 'package.json'),
			JSON.stringify({ name: 'test-project' }),
		);

		const calls: WriterCall[] = [];
		const registry = new HookRegistry();

		const deps: AcceptanceTriggerDeps = {
			hookRegistry: registry,
			configManager: mockConfigManager(true),
			instructionService: mockInstructionServiceThrowing(),
			projectRoot,
			spawnWriter: async (prompt) => {
				calls.push(prompt as WriterCall);
			},
		};

		registerAcceptanceTrigger(deps);

		await emit(registry, 'spec:acceptance_confirmed', {
			projectId: 'proj-6',
			workflowId: 'wf-303',
			confirmedAt: new Date().toISOString(),
		});

		expect(calls.length).toBe(1);
		expect(calls[0].priorContent).toBeNull();
	});

	test('disposer → handler is unregistered and not called on emit', async () => {
		const { deps, calls, registry } = createDeps({ autoUpdate: true });
		const dispose = registerAcceptanceTrigger(deps);

		dispose();

		await emit(registry, 'spec:acceptance_confirmed', {
			projectId: 'proj-7',
			workflowId: 'wf-404',
			confirmedAt: new Date().toISOString(),
		});

		expect(calls.length).toBe(0);
	});

	test('spawnWriter receives codebaseDigest with expected structure', async () => {
		const { deps, calls, registry } = createDeps({ autoUpdate: true });

		// Add an AGENTS.md to the fixture so the digest picks up existingInstruction
		writeFileSync(join(deps.projectRoot, 'AGENTS.md'), '# Fixture instructions');

		registerAcceptanceTrigger(deps);

		await emit(registry, 'spec:acceptance_confirmed', {
			projectId: 'proj-8',
			workflowId: 'wf-505',
			confirmedAt: new Date().toISOString(),
		});

		expect(calls.length).toBe(1);
		const digest = calls[0].codebaseDigest as Record<string, unknown>;
		expect(digest).toBeDefined();
		expect(digest.projectRoot).toBe(deps.projectRoot);
		expect(digest.manifest).toBeDefined();
	});
});
