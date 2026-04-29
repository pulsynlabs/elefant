import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../db/database.ts';
import { runLegacyMigration } from './migrate-legacy.ts';

const tempDirs: string[] = [];
const databases: Database[] = [];

type SpecWorkflowRow = {
  workflow_id: string;
  project_id: string;
  mode: string;
  depth: string;
  phase: string;
  status: string;
  autopilot: number;
  lazy_autopilot: number;
  spec_locked: number;
  acceptance_confirmed: number;
  interview_complete: number;
  interview_completed_at: string | null;
  current_wave: number;
  total_waves: number;
  is_active: number;
  last_activity: string;
};

function fixture(name: string): string {
  return readFileSync(
    join(import.meta.dirname, '..', 'test', 'fixtures', 'legacy-state', name),
    'utf-8',
  );
}

function createTempProject(prefix = 'elefant-legacy-migration-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createProjectWithDatabase(projectId: string, stateJson?: string) {
  const projectPath = createTempProject();
  const elefantDir = join(projectPath, '.elefant');
  mkdirSync(elefantDir, { recursive: true });

  if (stateJson !== undefined) {
    writeFileSync(join(elefantDir, 'state.json'), stateJson, 'utf-8');
  }

  const database = new Database(join(elefantDir, 'db.sqlite'));
  databases.push(database);
  database.db
    .query('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)')
    .run(projectId, 'migration-test', projectPath);

  return { projectPath, database };
}

function countRows(database: Database, projectId: string): number {
  const row = database.db
    .query('SELECT COUNT(*) AS count FROM spec_workflows WHERE project_id = ?')
    .get(projectId) as { count: number };

  return row.count;
}

function getWorkflow(
  database: Database,
  projectId: string,
  workflowId: string,
): SpecWorkflowRow | null {
  return database.db
    .query('SELECT * FROM spec_workflows WHERE project_id = ? AND workflow_id = ?')
    .get(projectId, workflowId) as SpecWorkflowRow | null;
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('runLegacyMigration', () => {
  it('skips when no legacy state file exists', async () => {
    const projectId = 'proj-no-state';
    const { projectPath, database } = createProjectWithDatabase(projectId);

    const result = await runLegacyMigration({ projectPath, database, projectId });

    expect(result).toEqual({
      status: 'skipped',
      reason: 'no_state_file',
      backupPath: null,
    });
    expect(countRows(database, projectId)).toBe(0);
  });

  it('skips empty legacy workflow maps without renaming state.json', async () => {
    const projectId = 'proj-empty';
    const { projectPath, database } = createProjectWithDatabase(
      projectId,
      fixture('empty.json'),
    );
    const statePath = join(projectPath, '.elefant', 'state.json');

    const result = await runLegacyMigration({ projectPath, database, projectId });

    expect(result).toEqual({
      status: 'skipped',
      reason: 'no_legacy_workflows',
      backupPath: null,
    });
    expect(existsSync(statePath)).toBe(true);
    expect(countRows(database, projectId)).toBe(0);
  });

  it('migrates a single legacy workflow and backs up the source file', async () => {
    const projectId = 'proj-single';
    const now = () => new Date('2026-04-20T00:00:00.000Z');
    const { projectPath, database } = createProjectWithDatabase(
      projectId,
      fixture('single-workflow.json'),
    );
    const statePath = join(projectPath, '.elefant', 'state.json');

    const result = await runLegacyMigration({ projectPath, database, projectId, now });

    expect(result.status).toBe('migrated');
    if (result.status !== 'migrated') {
      throw new Error('Expected migration to succeed');
    }

    expect(result.workflowsMigrated).toBe(1);
    expect(result.backupPath).toBe(`${statePath}.bak.1776643200`);
    expect(existsSync(statePath)).toBe(false);
    if (result.backupPath === null) {
      throw new Error('Expected backup path to be present');
    }
    expect(existsSync(result.backupPath)).toBe(true);

    const row = getWorkflow(database, projectId, 'feat-auth');
    expect(row).not.toBeNull();
    expect(row!.workflow_id).toBe('feat-auth');
    expect(row!.mode).toBe('standard');
    expect(row!.depth).toBe('deep');
    expect(row!.phase).toBe('plan');
    expect(row!.status).toBe('plan');
    expect(row!.autopilot).toBe(1);
    expect(row!.lazy_autopilot).toBe(1);
    expect(row!.spec_locked).toBe(1);
    expect(row!.acceptance_confirmed).toBe(0);
    expect(row!.interview_complete).toBe(1);
    expect(row!.interview_completed_at).toBe('2026-04-12T11:00:00.000Z');
    expect(row!.current_wave).toBe(2);
    expect(row!.total_waves).toBe(5);
    expect(row!.is_active).toBe(1);
    expect(row!.last_activity).toBe('2026-04-15T08:30:00.000Z');
  });

  it('is idempotent when legacy workflows already exist in spec_workflows', async () => {
    const projectId = 'proj-single';
    const { projectPath, database } = createProjectWithDatabase(
      projectId,
      fixture('single-workflow.json'),
    );

    const first = await runLegacyMigration({ projectPath, database, projectId });
    expect(first.status).toBe('migrated');

    writeFileSync(
      join(projectPath, '.elefant', 'state.json'),
      fixture('single-workflow.json'),
      'utf-8',
    );

    const second = await runLegacyMigration({ projectPath, database, projectId });

    expect(second).toEqual({
      status: 'skipped',
      reason: 'already_migrated',
      backupPath: null,
    });
    expect(countRows(database, projectId)).toBe(1);
  });

  it('rolls back DB writes and preserves state.json on insert failure', async () => {
    const fixtureProjectId = 'proj-single';
    const missingProjectId = 'missing-project';
    const { projectPath, database } = createProjectWithDatabase(
      fixtureProjectId,
      fixture('single-workflow.json'),
    );
    const statePath = join(projectPath, '.elefant', 'state.json');

    const result = await runLegacyMigration({
      projectPath,
      database,
      projectId: missingProjectId,
    });

    expect(result.status).toBe('failed');
    expect(existsSync(statePath)).toBe(true);
    expect(countRows(database, fixtureProjectId)).toBe(0);
    expect(countRows(database, missingProjectId)).toBe(0);
  });

  it('coerces unsupported legacy phases to idle and emits a warning', async () => {
    const projectId = 'proj-milestone';
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);
    const { projectPath, database } = createProjectWithDatabase(
      projectId,
      fixture('milestone-phase.json'),
    );

    const result = await runLegacyMigration({ projectPath, database, projectId });

    expect(result.status).toBe('migrated');
    const row = getWorkflow(database, projectId, 'legacy-milestone');
    expect(row?.phase).toBe('idle');
    expect(warnSpy).toHaveBeenCalledWith(
      'Coercing unsupported legacy workflow phase "milestone" to "idle" for workflow "legacy-milestone".',
    );
    warnSpy.mockRestore();
  });

  it('returns failed without mutation for corrupt state.json', async () => {
    const projectId = 'proj-corrupt';
    const { projectPath, database } = createProjectWithDatabase(
      projectId,
      '{"version":2,',
    );
    const statePath = join(projectPath, '.elefant', 'state.json');

    const result = await runLegacyMigration({ projectPath, database, projectId });

    expect(result.status).toBe('failed');
    expect(existsSync(statePath)).toBe(true);
    expect(countRows(database, projectId)).toBe(0);
  });

  // TODO(testing): Add a deterministic mid-rename failure test once the migration
  // runner accepts injectable filesystem operations. POSIX directory permissions
  // behave inconsistently under privileged CI users, making chmod-based coverage
  // brittle here.
});
