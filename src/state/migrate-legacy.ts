import { access, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from '../db/database.ts';
import {
  ElefantStateSchema,
  SpecWorkflowDepth,
  SpecWorkflowMode,
  SpecWorkflowPhase,
  type ElefantState,
  type WorkflowEntry,
} from './schema.ts';

export type MigrationInput = {
  projectPath: string;
  database: Database;
  projectId: string;
  now?: () => Date;
};

export type MigrationResult =
  | {
      status: 'skipped';
      reason: 'no_state_file' | 'no_legacy_workflows' | 'already_migrated';
      backupPath: null;
    }
  | { status: 'migrated'; workflowsMigrated: number; backupPath: string | null }
  | { status: 'failed'; error: string; backupPath: null };

type RawWorkflowEntry = Omit<WorkflowEntry, 'phase'> & {
  status?: string;
  phase?: string;
};

type RawLegacyState = Omit<ElefantState, 'workflow' | 'workflows'> & {
  workflow: RawWorkflowEntry;
  workflows: Record<string, RawWorkflowEntry>;
};

const SPEC_PHASES = new Set<SpecWorkflowPhase>(SpecWorkflowPhase.options);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeLegacyPhases(raw: unknown): unknown {
  if (!isRecord(raw)) {
    return raw;
  }

  const normalized = structuredClone(raw) as Record<string, unknown>;

  const normalizeWorkflow = (value: unknown) => {
    if (!isRecord(value)) {
      return;
    }

    const phase = value.phase;
    if (typeof phase === 'string' && !SPEC_PHASES.has(phase as SpecWorkflowPhase)) {
      value.phase = 'idle';
    }
  };

  normalizeWorkflow(normalized.workflow);

  if (isRecord(normalized.workflows)) {
    for (const workflow of Object.values(normalized.workflows)) {
      normalizeWorkflow(workflow);
    }
  }

  return normalized;
}

function extractRawLegacyState(raw: unknown, parsed: ElefantState): RawLegacyState {
  const rawRecord = isRecord(raw) ? raw : {};
  const rawWorkflow = isRecord(rawRecord.workflow) ? rawRecord.workflow : {};
  const rawWorkflows = isRecord(rawRecord.workflows) ? rawRecord.workflows : {};

  const workflow: RawWorkflowEntry = {
    ...parsed.workflow,
    ...(typeof rawWorkflow.status === 'string' ? { status: rawWorkflow.status } : {}),
    ...(typeof rawWorkflow.phase === 'string' ? { phase: rawWorkflow.phase } : {}),
  };

  const workflows: Record<string, RawWorkflowEntry> = {};
  for (const [workflowId, entry] of Object.entries(parsed.workflows)) {
    const rawEntry = rawWorkflows[workflowId];
    workflows[workflowId] = {
      ...entry,
      ...(isRecord(rawEntry) && typeof rawEntry.status === 'string'
        ? { status: rawEntry.status }
        : {}),
      ...(isRecord(rawEntry) && typeof rawEntry.phase === 'string'
        ? { phase: rawEntry.phase }
        : {}),
    };
  }

  return {
    ...parsed,
    workflow,
    workflows,
  };
}

function coerceSpecPhase(workflowId: string, phase: string | undefined): SpecWorkflowPhase {
  if (phase && SPEC_PHASES.has(phase as SpecWorkflowPhase)) {
    return phase as SpecWorkflowPhase;
  }

  if (phase) {
    console.warn(
      `Coercing unsupported legacy workflow phase "${phase}" to "idle" for workflow "${workflowId}".`,
    );
  }

  return 'idle';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function existingWorkflowIds(
  database: Database,
  projectId: string,
  workflowIds: string[],
): Set<string> {
  const existing = new Set<string>();
  const query = database.db.query(
    'SELECT 1 FROM spec_workflows WHERE project_id = ? AND workflow_id = ?',
  );

  for (const workflowId of workflowIds) {
    if (query.get(projectId, workflowId)) {
      existing.add(workflowId);
    }
  }

  return existing;
}

export async function runLegacyMigration(
  input: MigrationInput,
): Promise<MigrationResult> {
  const statePath = join(input.projectPath, '.elefant', 'state.json');
  const clock = input.now ?? (() => new Date());

  try {
    await access(statePath);
  } catch {
    return { status: 'skipped', reason: 'no_state_file', backupPath: null };
  }

  let raw: unknown;
  let legacyState: RawLegacyState;

  try {
    raw = JSON.parse(await readFile(statePath, 'utf-8')) as unknown;
    const normalized = normalizeLegacyPhases(raw);
    const parsed = ElefantStateSchema.parse(normalized);
    legacyState = extractRawLegacyState(raw, parsed);
  } catch (error) {
    return { status: 'failed', error: errorMessage(error), backupPath: null };
  }

  const workflows = Object.entries(legacyState.workflows);
  if (workflows.length === 0) {
    return { status: 'skipped', reason: 'no_legacy_workflows', backupPath: null };
  }

  const existing = existingWorkflowIds(
    input.database,
    input.projectId,
    workflows.map(([workflowId]) => workflowId),
  );

  if (existing.size === workflows.length) {
    return { status: 'skipped', reason: 'already_migrated', backupPath: null };
  }

  let workflowsMigrated = 0;

  try {
    input.database.db.transaction(() => {
      const insert = input.database.db.query(`INSERT INTO spec_workflows (
        id,
        project_id,
        workflow_id,
        mode,
        depth,
        phase,
        status,
        autopilot,
        lazy_autopilot,
        spec_locked,
        acceptance_confirmed,
        interview_complete,
        interview_completed_at,
        current_wave,
        total_waves,
        is_active,
        last_activity,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

      for (const [workflowId, workflow] of workflows) {
        if (existing.has(workflowId)) {
          continue;
        }

        const now = clock().toISOString();
        insert.run(
          crypto.randomUUID(),
          input.projectId,
          workflowId,
          SpecWorkflowMode.catch('standard').parse(workflow.mode),
          SpecWorkflowDepth.catch('standard').parse(workflow.depth),
          coerceSpecPhase(workflowId, workflow.phase),
          workflow.status ?? 'idle',
          workflow.autopilot ? 1 : 0,
          workflow.lazyAutopilot ? 1 : 0,
          workflow.specLocked ? 1 : 0,
          workflow.acceptanceConfirmed ? 1 : 0,
          workflow.interviewComplete ? 1 : 0,
          workflow.interviewCompletedAt ?? null,
          workflow.currentWave ?? 0,
          workflow.totalWaves ?? 0,
          workflowId === legacyState.workflow.workflowId ? 1 : 0,
          workflow.lastActivity ?? now,
          now,
          now,
        );
        workflowsMigrated += 1;
      }
    })();
  } catch (error) {
    return { status: 'failed', error: errorMessage(error), backupPath: null };
  }

  const backupPath = `${statePath}.bak.${Math.floor(clock().getTime() / 1000)}`;
  try {
    await rename(statePath, backupPath);
  } catch (error) {
    // The DB transaction has already committed and is the new source of truth.
    // Keep the migration successful even if defensive cleanup cannot rename the
    // legacy file; callers can retry and idempotency will skip existing rows.
    console.warn(`Legacy state migrated but backup rename failed: ${errorMessage(error)}`);
    return { status: 'migrated', workflowsMigrated, backupPath: null };
  }

  return { status: 'migrated', workflowsMigrated, backupPath };
}
