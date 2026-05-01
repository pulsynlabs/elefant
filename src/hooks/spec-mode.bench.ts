import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../db/database.ts';
import { StateManager } from '../state/manager.ts';
import { instantiateSpecTools } from '../tools/workflow/index.ts';
import { emit } from './emit.ts';
import { HookRegistry } from './registry.ts';
import { createPhaseAllowListFromSpecTools, createSpecPhaseGateHandler } from './wf-phase-gate.ts';

type BenchCase = {
	name: string;
	run: () => Promise<void>;
};

function percentile(sortedMs: readonly number[], percentileValue: number): number {
	const index = Math.min(sortedMs.length - 1, Math.ceil(sortedMs.length * percentileValue) - 1);
	return sortedMs[index] ?? 0;
}

async function runCase(testCase: BenchCase): Promise<void> {
	const iterations = 1_000;
	const timings: number[] = [];

	for (let index = 0; index < 50; index += 1) await testCase.run();

	for (let index = 0; index < iterations; index += 1) {
		const start = Bun.nanoseconds();
		await testCase.run();
		const elapsedNs = Bun.nanoseconds() - start;
		timings.push(elapsedNs / 1_000_000);
	}

	timings.sort((left, right) => left - right);
	const p50 = percentile(timings, 0.5);
	const p95 = percentile(timings, 0.95);
	const p99 = percentile(timings, 0.99);
	const status = p95 < 2 ? 'PASS' : 'FAIL';
	console.log(`${testCase.name} p50 ${p50.toFixed(4)} ms p95 ${p95.toFixed(4)} ms p99 ${p99.toFixed(4)} ms ${status}`);
	if (p95 >= 2) process.exitCode = 1;
}

const projectPath = mkdtempSync(join(tmpdir(), 'elefant-spec-mode-bench-'));
mkdirSync(join(projectPath, '.elefant'), { recursive: true });
const db = new Database(join(projectPath, '.elefant', 'db.sqlite'));
const projectId = 'bench-project';
const workflowId = 'spec-mode';

db.db.run(
	'INSERT INTO projects (id, name, path, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
	[projectId, projectId, projectPath, null, new Date().toISOString(), new Date().toISOString()],
);

const state = new StateManager(projectPath, {
	id: projectId,
	name: projectId,
	path: projectPath,
	database: db,
});
await state.createSpecWorkflow({ projectId, workflowId, phase: 'execute', isActive: true });

const hooks = new HookRegistry();
hooks.on('tool:before', createSpecPhaseGateHandler(state, createPhaseAllowListFromSpecTools(instantiateSpecTools())));

await runCase({
	name: 'tool:before — spec tool, correct phase',
	run: async () => {
		await emit(hooks, 'tool:before', {
			toolName: 'wf_chronicle',
			args: { action: 'append', projectId, workflowId },
			conversationId: 'bench',
		});
	},
});

await runCase({
	name: 'tool:before — non-spec tool (no-op)',
	run: async () => {
		await emit(hooks, 'tool:before', {
			toolName: 'read',
			args: { filePath: 'src/index.ts' },
			conversationId: 'bench',
		});
	},
});

await runCase({
	name: 'tool:before — spec tool, wrong phase (veto)',
	run: async () => {
		await emit(hooks, 'tool:before', {
			toolName: 'wf_requirements',
			args: { action: 'write', projectId, workflowId, content: '# Requirements' },
			conversationId: 'bench',
		});
	},
});

db.close();
rmSync(projectPath, { recursive: true, force: true });
