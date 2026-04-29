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

describe('spec tool registry integration', () => {
	it('registers all 11 spec tools in per-run registry', () => {
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
			currentRun: { runId: 'run-1', depth: 0, agentType: 'orchestrator', title: 'Run', sessionId: 'session-1', projectId: 'project-1', signal: new AbortController().signal },
		});
		const names = registry.getAll().map((tool) => tool.name).filter((name) => name.startsWith('spec_')).sort();
		expect(names).toEqual([
			'spec_adl',
			'spec_blueprint',
			'spec_checkpoint',
			'spec_chronicle',
			'spec_reference',
			'spec_requirements',
			'spec_skill',
			'spec_spec',
			'spec_state',
			'spec_status',
			'spec_workflow',
		]);
		database.close();
	});
});
