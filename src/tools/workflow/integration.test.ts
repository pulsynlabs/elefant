import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../../db/database.ts';
import { HookRegistry } from '../../hooks/index.ts';
import { createToolRegistryForRun } from '../registry.ts';

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('workflow tool registry integration', () => {
	it('registers all 9 workflow tools for spec mode runs', () => {
		const dir = mkdtempSync(join(tmpdir(), 'elefant-spec-registry-'));
		tempDirs.push(dir);
		const database = new Database(join(dir, 'db.sqlite'));
		database.db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', ['project-1', 'Project', dir]);
		const registry = createToolRegistryForRun({
			hookRegistry: new HookRegistry(),
			database,
			runRegistry: {} as never,
			sseManager: {} as never,
			providerRouter: {} as never,
			configManager: {} as never,
			currentRun: { runId: 'run-1', depth: 0, agentType: 'orchestrator', title: 'Run', sessionId: 'session-1', projectId: 'project-1', signal: new AbortController().signal, discoveredMcpTools: new Set<string>() },
			mode: 'spec',
		});
		const names = registry.getAll().map((tool) => tool.name).filter((name) => name.startsWith('wf_')).sort();
		expect(names).toEqual([
			'wf_adl',
			'wf_blueprint',
			'wf_checkpoint',
			'wf_chronicle',
			'wf_requirements',
			'wf_spec',
			'wf_state',
			'wf_status',
			'wf_workflow',
		]);
		database.close();
	});

	it('omits workflow tools for quick mode while keeping interactive tools', () => {
		const dir = mkdtempSync(join(tmpdir(), 'elefant-quick-registry-'));
		tempDirs.push(dir);
		const database = new Database(join(dir, 'db.sqlite'));
		database.db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', ['project-1', 'Project', dir]);

		const registry = createToolRegistryForRun({
			hookRegistry: new HookRegistry(),
			database,
			runRegistry: {} as never,
			sseManager: {} as never,
			providerRouter: {} as never,
			configManager: {} as never,
			currentRun: { runId: 'run-1', depth: 0, agentType: 'primary', title: 'Run', sessionId: 'session-1', projectId: 'project-1', signal: new AbortController().signal, discoveredMcpTools: new Set<string>() },
			mode: 'quick',
		});

		const names = registry.getAll().map((tool) => tool.name);
		expect(names.filter((name) => name.startsWith('wf_'))).toEqual([]);
		expect(names).toContain('question');
		expect(names).toContain('slider');
		database.close();
	});
});
