// Verifier independence assertion (AVC7)
//
// Two independent guards keep the verifier honest:
//   1. The default agent profile for the verifier ships with
//      contextMode === "none" so dispatches inherit fresh context
//      unless explicitly overridden.
//   2. Inserting a verifier `agent_runs` row writes context_mode = 'none'
//      when the profile is honored — the schema accepts the value and
//      reads back identically.
//
// We don't drive a full audit here (that lives in the integration suite);
// we assert the contract surface that the verifier dispatch path depends on.

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Database } from '../db/database.ts';
import { defaultAgentProfiles } from '../config/schema.ts';
import { createRun, getRun } from '../runs/dal.ts';

const tempDirs: string[] = [];

function newDb(): Database {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-verifier-independence-'));
	tempDirs.push(dir);
	return new Database(join(dir, 'db.sqlite'));
}

function seedProjectAndSession(db: Database): { projectId: string; sessionId: string } {
	const projectId = crypto.randomUUID();
	const sessionId = crypto.randomUUID();
	db.db.run('INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)', [
		projectId,
		'audit-test',
		`/tmp/audit-${projectId}`,
		null,
	]);
	db.db.run(
		'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
		[sessionId, projectId, null, 'audit', 'running', new Date().toISOString(), null],
	);
	return { projectId, sessionId };
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('verifier independence (AVC7)', () => {
	it('default verifier profile ships with contextMode = "none"', () => {
		const verifier = defaultAgentProfiles.verifier;
		expect(verifier).toBeDefined();
		expect(verifier.contextMode).toBe('none');
	});

	it('inserting a verifier agent_runs row preserves context_mode = "none"', () => {
		const db = newDb();
		const { projectId, sessionId } = seedProjectAndSession(db);
		const result = createRun(db, {
			run_id: crypto.randomUUID(),
			session_id: sessionId,
			project_id: projectId,
			parent_run_id: null,
			agent_type: 'verifier',
			title: 'Audit run',
			context_mode: 'none',
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const fetched = getRun(db, result.data.run_id);
		expect(fetched.ok).toBe(true);
		if (fetched.ok) {
			expect(fetched.data.agent_type).toBe('verifier');
			expect(fetched.data.context_mode).toBe('none');
		}
		db.close();
	});
});
