// Lazy autopilot integration test
//
// Verifies the three Wave 9 acceptance contract pieces hold together:
//   1. The compaction block contains the lazy directive when lazyAutopilot=true
//      (Task 9.1 — covered by src/compaction/blocks.test.ts; re-asserted here
//      to keep the lazy contract single-glance auditable).
//   2. The phase auto-progression map covers every non-accept phase command
//      and the /accept entry has no successor (Task 9.2 / VC9.* + AVC6).
//   3. The `question` tool is NOT requested via the agent-loop dispatch when
//      lazy autopilot logic runs — modeled here by asserting the AUTO_PROGRESSION
//      chain never hands the `question` tool name to the next dispatch.
//
// A full agent-loop run requires the daemon, mock providers, and a seeded
// project. That deeper E2E lives in the daemon-level e2e suite. This test
// exercises the lazy contract at the unit level so regressions surface fast.

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../db/database.ts';
import { StateManager } from '../state/manager.ts';
import { buildSpecModeBlock } from '../compaction/wf-context-block.ts';
import { AUTO_PROGRESSION, executeAutoProgression } from '../server/slash-commands.ts';

const tempDirs: string[] = [];

function setupWorkflow(opts: { autopilot: boolean; lazyAutopilot: boolean }) {
	const directory = mkdtempSync(join(tmpdir(), 'elefant-lazy-autopilot-'));
	tempDirs.push(directory);
	mkdirSync(join(directory, '.elefant'), { recursive: true });
	const db = new Database(join(directory, '.elefant', 'db.sqlite'));
	const projectId = 'project-1';
	db.db.run('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)', [projectId, 'Project', directory]);
	const state = new StateManager(directory, {
		id: projectId,
		name: 'Project',
		path: directory,
		database: db,
	});
	return { directory, db, state, projectId };
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('lazy autopilot integration', () => {
	it('compaction block contains the lazy directive when lazyAutopilot=true', async () => {
		const { db, state, projectId } = setupWorkflow({ autopilot: true, lazyAutopilot: true });
		await state.createSpecWorkflow({
			projectId,
			workflowId: 'spec-mode',
			phase: 'execute',
			autopilot: true,
			lazyAutopilot: true,
		});
		const block = buildSpecModeBlock(db, projectId, 'spec-mode');
		expect(block).toContain('LAZY AUTOPILOT ACTIVE');
		db.close();
	});

	it('phase auto-progression covers every non-accept phase command', () => {
		const expectedTransitions: Array<[string, string]> = [
			['/discuss', '/plan'],
			['/plan', '/execute'],
			['/execute', '/audit'],
			['/audit', '/accept'],
		];
		for (const [from, to] of expectedTransitions) {
			expect(AUTO_PROGRESSION[from]).toBe(to);
		}
		// Accept never auto-progresses — terminal human gate
		expect(AUTO_PROGRESSION['/accept']).toBeUndefined();
	});

	it('lazy autopilot progression never hands "question" as the next command', () => {
		// The AUTO_PROGRESSION map uses static `/` triggers — none of them
		// reference the `question` tool. This test guards that invariant so a
		// future regression cannot covertly inject a question-asking step into
		// the lazy chain.
		for (const next of Object.values(AUTO_PROGRESSION)) {
			expect(next).not.toBe('question');
			expect(next.startsWith('/')).toBe(true);
		}
	});

	it('executeAutoProgression returns null without firing question tool path when autopilot is off', async () => {
		const { db, state, projectId } = setupWorkflow({ autopilot: false, lazyAutopilot: false });
		await state.createSpecWorkflow({
			projectId,
			workflowId: 'spec-mode',
			phase: 'execute',
			autopilot: false,
			lazyAutopilot: false,
		});
		// Pass a path that does not exist for commands; should still return null
		// without ever touching the filesystem because autopilot=false short-circuits.
		const match = await executeAutoProgression('/discuss', state, 'spec-mode', projectId, '/nonexistent');
		expect(match).toBeNull();
		db.close();
	});
});
