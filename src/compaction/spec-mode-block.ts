import type { Database as BunDatabase } from 'bun:sqlite';

import type { Database } from '../db/database.ts';
import { SpecAdlRepo } from '../db/repo/spec/adl.ts';
import { MustHavesRepo } from '../db/repo/spec/must-haves.ts';
import { SpecWorkflowsRepo } from '../db/repo/spec/workflows.ts';
import { buildResumeDirectiveFromWorkflow } from './blocks.ts';

type TaskStatusRow = {
	status: string;
	count: number;
};

function buildTaskSummary(db: BunDatabase, workflowPk: string, waveNumber: number): string {
	const rows = db
		.query(
			`SELECT t.status AS status, COUNT(*) AS count
			 FROM spec_tasks t
			 JOIN spec_waves w ON w.id = t.wave_id
			 JOIN spec_blueprints b ON b.id = w.blueprint_id
			 WHERE b.workflow_id = ? AND w.wave_number = ?
			 GROUP BY t.status
			 ORDER BY t.status ASC`,
		)
		.all(workflowPk, waveNumber) as TaskStatusRow[];

	if (rows.length === 0) return '0 tasks';
	return rows.map((row) => `${row.status}: ${row.count}`).join(', ');
}

function buildTaskProgress(
	db: BunDatabase,
	workflowPk: string,
	waveNumber: number,
): { done: number; inProgress: number } {
	const rows = db
		.query(
			`SELECT t.status AS status, COUNT(*) AS count
			 FROM spec_tasks t
			 JOIN spec_waves w ON w.id = t.wave_id
			 JOIN spec_blueprints b ON b.id = w.blueprint_id
			 WHERE b.workflow_id = ? AND w.wave_number = ?
			 GROUP BY t.status`,
		)
		.all(workflowPk, waveNumber) as TaskStatusRow[];

	const done = rows
		.filter((row) => row.status === 'done' || row.status === 'complete')
		.reduce((sum, row) => sum + row.count, 0);
	const inProgress = rows
		.filter((row) => row.status !== 'done' && row.status !== 'complete')
		.reduce((sum, row) => sum + row.count, 0);

	return { done, inProgress };
}

export function buildSpecModeBlock(
	db: Database,
	projectId: string,
	workflowId: string,
): string {
	const workflowsRepo = new SpecWorkflowsRepo(db);
	const mustHavesRepo = new MustHavesRepo(db);
	const adlRepo = new SpecAdlRepo(db);

	const workflow = workflowsRepo.get(projectId, workflowId);
	if (!workflow) return '';

	const mustHaves = mustHavesRepo.list(workflow.id).slice(0, 5);
	const lastAdl = adlRepo.getLastN(workflow.id, 3);
	const taskSummary = buildTaskSummary(db.db, workflow.id, workflow.currentWave);
	const progress = buildTaskProgress(db.db, workflow.id, workflow.currentWave);

	const lines: string[] = [];

	if (workflow.lazyAutopilot) {
		lines.push('> **LAZY AUTOPILOT ACTIVE — DO NOT ASK QUESTIONS, INFER FROM CONTEXT.**');
		lines.push('');
	}

	lines.push(`## SPEC MODE — ${workflowId}`);
	lines.push(buildResumeDirectiveFromWorkflow({
		workflowId,
		phase: workflow.phase,
		currentWave: workflow.currentWave,
		totalWaves: workflow.totalWaves,
		lazyAutopilot: workflow.lazyAutopilot,
	}));
	lines.push('> 1) Run `wf_status` to confirm phase/wave/task state.');
	lines.push('> 2) Continue the current phase using the appropriate command (`/execute`, `/plan`, `/audit`, `/accept`).');
	lines.push('> 3) Resume the *next incomplete task*; do not restart completed work.');
	lines.push('');
	lines.push(`**Phase:** ${workflow.phase} | **Mode:** ${workflow.mode} | **Depth:** ${workflow.depth}`);
	lines.push(`**Spec Locked:** ${workflow.specLocked ? '🔒 Yes' : 'No'} | **Wave:** ${workflow.currentWave}/${workflow.totalWaves}`);
	lines.push(`**Current Wave Tasks:** ${taskSummary}`);
	if (workflow.autopilot) lines.push(`**Autopilot:** ${workflow.lazyAutopilot ? 'Lazy' : 'Standard'}`);
	lines.push('');
	lines.push('## Progress');
	lines.push('### Done');
	lines.push(`- [x] ${progress.done} task${progress.done !== 1 ? 's' : ''} completed`);
	lines.push('### In Progress');
	lines.push(`- [ ] ${progress.inProgress} task${progress.inProgress !== 1 ? 's' : ''} remaining`);
	lines.push('');

	if (mustHaves.length > 0) {
		lines.push('**Locked Must-Haves (top 5):**');
		for (const mustHave of mustHaves) {
			lines.push(`- ${mustHave.mhId}: ${mustHave.title}`);
		}
		lines.push('');
	}

	if (lastAdl.length > 0) {
		lines.push('**Last 3 ADL:**');
		for (const entry of lastAdl) {
			lines.push(`- [${entry.type}] ${entry.title} (${entry.createdAt.slice(0, 10)})`);
		}
		lines.push('');
	}

	return `${lines.join('\n')}\n`;
}
