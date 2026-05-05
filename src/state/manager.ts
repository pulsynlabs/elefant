import { existsSync, readFileSync } from 'node:fs';
import type { Database as BunDatabase } from 'bun:sqlite';
import type { Database } from '../db/database.ts';
import { SpecAdlRepo } from '../db/repo/spec/adl.ts';
import { SpecWorkflowsRepo } from '../db/repo/spec/workflows.ts';
import { emit } from '../hooks/emit.ts';
import type { HookContextMap, HookEventName } from '../hooks/types.ts';
import type { HookRegistry } from '../hooks/registry.ts';
import { statePath } from '../project/paths.ts';
import { atomicWriteJson } from './atomic.ts';
import {
  InvalidTransitionError,
  SpecModeNotConfiguredError,
  WorkflowExistsError,
  WorkflowNotFoundError,
} from './errors.ts';
import { migrateToV2 } from './migrate.ts';
import { AsyncMutex } from './mutex.ts';
import {
  createDefaultState,
  ElefantStateSchema,
  SpecWorkflowSchema,
  type ElefantState,
  type SpecWorkflow,
  type SpecWorkflowDepth,
  type SpecWorkflowMode,
  type SpecWorkflowPhase,
  type WorkflowEntry,
} from './schema.ts';

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    deepFreeze(record[key]);
  }

  return Object.freeze(value);
}

type WorkflowPhase = ElefantState['workflow']['phase'];

type StateManagerOptions = {
  id: string;
  name: string;
  path: string;
  database?: Database;
  hookRegistry?: HookRegistry;
};

type SpecWorkflowRow = {
  id: string;
  project_id: string;
  workflow_id: string;
  mode: SpecWorkflowMode;
  depth: SpecWorkflowDepth;
  phase: SpecWorkflowPhase;
  status: string;
  autopilot: number;
  lazy_autopilot: number;
  locked: number;
  acceptance_confirmed: number;
  interview_complete: number;
  interview_completed_at: string | null;
  current_wave: number;
  total_waves: number;
  is_active: number;
  last_activity: string;
  created_at: string;
  updated_at: string;
};

type CreateSpecWorkflowInput = {
  projectId: string;
  workflowId: string;
  mode?: SpecWorkflowMode;
  depth?: SpecWorkflowDepth;
  phase?: SpecWorkflowPhase;
  status?: string;
  autopilot?: boolean;
  lazyAutopilot?: boolean;
  specLocked?: boolean;
  acceptanceConfirmed?: boolean;
  interviewComplete?: boolean;
  interviewCompletedAt?: string | null;
  currentWave?: number;
  totalWaves?: number;
  isActive?: boolean;
};

type TransitionSpecPhaseOptions = {
  force?: boolean;
  reason?: string;
};

function nextActivityIso(previous: string): string {
  const nowMs = Date.now();
  const previousMs = Date.parse(previous);
  if (Number.isNaN(previousMs) || nowMs > previousMs) {
    return new Date(nowMs).toISOString();
  }

  return new Date(previousMs + 1).toISOString();
}

const VALID_PHASE_TRANSITIONS: Record<WorkflowPhase, WorkflowPhase[]> = {
  idle: ['plan'],
  plan: ['research', 'specify', 'execute'],
  research: ['specify'],
  specify: ['execute'],
  execute: ['accept'],
  accept: ['idle'],
};

const SPEC_PHASE_TRANSITIONS: Record<
  SpecWorkflowPhase,
  ReadonlyArray<SpecWorkflowPhase>
> = {
  idle: ['discuss', 'plan'],
  discuss: ['plan', 'idle'],
  plan: ['research', 'specify', 'execute', 'idle'],
  research: ['specify', 'plan'],
  specify: ['execute', 'plan'],
  execute: ['audit', 'plan'],
  audit: ['execute', 'accept'],
  accept: ['idle'],
};

export class StateManager {
  private state: ElefantState;
  private readonly mutex = new AsyncMutex();
  private readonly specMutexes = new Map<string, AsyncMutex>();
  private readonly filePath: string;
  private readonly db: Database | null;
  private readonly hooks?: HookRegistry;
  private readonly projectMeta: { id: string; name: string; path: string };

  constructor(projectPath: string, options: StateManagerOptions) {
    this.projectMeta = {
      id: options.id,
      name: options.name,
      path: options.path,
    };
    this.db = options.database ?? null;
    this.hooks = options.hookRegistry;
    this.filePath = statePath(projectPath);
    this.state = this.load();
  }

  private emitHook<E extends HookEventName>(event: E, context: HookContextMap[E]): void {
    if (!this.hooks) return;
    void emit(this.hooks, event, context).catch((error) => {
      console.error(`[elefant] Failed to emit ${event}:`, error);
    });
  }

  private requireDb(): BunDatabase {
    if (!this.db) {
      throw new SpecModeNotConfiguredError(
        'Spec Mode requires a Database instance. Pass options.database to StateManager.',
      );
    }

    return this.db.db;
  }

  private getSpecMutex(projectId: string, workflowId: string): AsyncMutex {
    const key = `${projectId}:${workflowId}`;
    let mutex = this.specMutexes.get(key);
    if (!mutex) {
      mutex = new AsyncMutex();
      this.specMutexes.set(key, mutex);
    }

    return mutex;
  }

  private rowToSpecWorkflow(row: SpecWorkflowRow): SpecWorkflow {
    return SpecWorkflowSchema.parse({
      id: row.id,
      projectId: row.project_id,
      workflowId: row.workflow_id,
      mode: row.mode,
      depth: row.depth,
      phase: row.phase,
      status: row.status,
      autopilot: row.autopilot === 1,
      lazyAutopilot: row.lazy_autopilot === 1,
      specLocked: row.locked === 1,
      acceptanceConfirmed: row.acceptance_confirmed === 1,
      interviewComplete: row.interview_complete === 1,
      interviewCompletedAt: row.interview_completed_at,
      currentWave: row.current_wave,
      totalWaves: row.total_waves,
      isActive: row.is_active === 1,
      lastActivity: row.last_activity,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private getSpecWorkflowOrThrow(
    db: BunDatabase,
    projectId: string,
    workflowId: string,
  ): SpecWorkflow {
    const row = db
      .query('SELECT * FROM spec_workflows WHERE project_id = ? AND workflow_id = ?')
      .get(projectId, workflowId) as SpecWorkflowRow | null;

    if (!row) {
      throw new WorkflowNotFoundError({
        code: 'WORKFLOW_NOT_FOUND',
        projectId,
        workflowId,
      });
    }

    return this.rowToSpecWorkflow(row);
  }

  private updateSpecWorkflowFields(
    db: BunDatabase,
    projectId: string,
    workflowId: string,
    fields: Record<string, string | number | null>,
  ): SpecWorkflow {
    const entries = Object.entries(fields);
    if (entries.length === 0) {
      return this.getSpecWorkflowOrThrow(db, projectId, workflowId);
    }

    const assignments = entries.map(([field]) => `${field} = ?`).join(', ');
    const result = db
      .query(
        `UPDATE spec_workflows SET ${assignments}, last_activity = datetime('now'), updated_at = datetime('now') WHERE project_id = ? AND workflow_id = ?`,
      )
      .run(...entries.map(([, value]) => value), projectId, workflowId);

    if (result.changes === 0) {
      throw new WorkflowNotFoundError({
        code: 'WORKFLOW_NOT_FOUND',
        projectId,
        workflowId,
      });
    }

    return this.getSpecWorkflowOrThrow(db, projectId, workflowId);
  }

  private async appendAdlForced(
    projectId: string,
    workflowId: string,
    context: object,
  ): Promise<void> {
    if (!this.db) return;

    const workflowsRepo = new SpecWorkflowsRepo(this.db);
    const workflow = workflowsRepo.get(projectId, workflowId);
    if (!workflow) return;

    const adlRepo = new SpecAdlRepo(this.db);
    adlRepo.append(workflow.id, {
      type: 'deviation',
      title: 'Forced phase transition',
      body: JSON.stringify(context),
      rule: null,
      files: [],
    });
  }

  private load(): ElefantState {
    if (!existsSync(this.filePath)) {
      const defaults = createDefaultState(this.projectMeta);
      atomicWriteJson(this.filePath, defaults);
      return defaults;
    }

    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8')) as unknown;
      const migrated = migrateToV2(raw, this.projectMeta);
      const validated = ElefantStateSchema.parse(migrated);

      if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 2) {
        atomicWriteJson(this.filePath, validated);
      }

      return validated;
    } catch {
      const defaults = createDefaultState(this.projectMeta);
      atomicWriteJson(this.filePath, defaults);
      return defaults;
    }
  }

  getState(): Readonly<ElefantState> {
    return deepFreeze(structuredClone(this.state));
  }

  private async persist(mutator: (state: ElefantState) => void): Promise<void> {
    await this.mutex.withLock(async () => {
      mutator(this.state);
      this.state.workflow.lastActivity = nextActivityIso(
        this.state.workflow.lastActivity,
      );
      ElefantStateSchema.parse(this.state);
      atomicWriteJson(this.filePath, this.state);
    });
  }

  async updateWorkflow(patch: Partial<WorkflowEntry>): Promise<void> {
    await this.persist((state) => {
      Object.assign(state.workflow, patch);
    });
  }

  async createWorkflow(
    id: string,
    initial?: Partial<WorkflowEntry>,
  ): Promise<WorkflowEntry> {
    const entry: WorkflowEntry = {
      workflowId: id,
      phase: 'idle',
      mode: 'standard',
      depth: 'standard',
      specLocked: false,
      acceptanceConfirmed: false,
      interviewComplete: false,
      interviewCompletedAt: null,
      currentWave: 0,
      totalWaves: 0,
      lastActivity: new Date().toISOString(),
      ...initial,
    };

    await this.persist((state) => {
      state.workflows[id] = entry;
    });

    return entry;
  }

  async setActiveWorkflow(id: string): Promise<boolean> {
    if (id !== 'default' && !this.state.workflows[id]) {
      return false;
    }

    const source = id === 'default' ? this.state.workflow : this.state.workflows[id];
    if (!source) {
      return false;
    }

    await this.persist((state) => {
      state.workflow = { ...source, workflowId: id };
    });

    return true;
  }

  // Legacy file-based transition (no DB, returns boolean)
  async transitionPhase(to: WorkflowPhase): Promise<boolean>;
  // Spec-mode DB-backed transition (requires DB, returns SpecWorkflow)
  async transitionPhase(
    projectId: string,
    workflowId: string,
    to: SpecWorkflowPhase,
    opts?: TransitionSpecPhaseOptions,
  ): Promise<SpecWorkflow>;
  async transitionPhase(
    toOrProjectId: WorkflowPhase | string,
    workflowIdOrTo?: string | SpecWorkflowPhase,
    toOrOpts?: SpecWorkflowPhase | TransitionSpecPhaseOptions,
    opts?: TransitionSpecPhaseOptions,
  ): Promise<boolean | SpecWorkflow> {
    // Legacy path: single WorkflowPhase argument
    if (typeof workflowIdOrTo === 'undefined') {
      const to = toOrProjectId as WorkflowPhase;
      const current = this.state.workflow.phase;
      if (!VALID_PHASE_TRANSITIONS[current].includes(to)) {
        return false;
      }

      await this.persist((state) => {
        state.workflow.phase = to;
      });

      return true;
    }

    // Spec-mode path: projectId, workflowId, to, opts?
    const projectId = toOrProjectId as string;
    const workflowId = workflowIdOrTo as string;
    const to = toOrOpts as SpecWorkflowPhase;
    const transitionOpts = (typeof opts !== 'undefined' ? opts : toOrOpts) as TransitionSpecPhaseOptions;

    const db = this.requireDb();
    const mutex = this.getSpecMutex(projectId, workflowId);

    return mutex.withLock(async () => {
      const current = this.getSpecWorkflowOrThrow(db, projectId, workflowId);
      const allowed = SPEC_PHASE_TRANSITIONS[current.phase];

      if (!allowed.includes(to) && transitionOpts.force !== true) {
        throw new InvalidTransitionError({
          code: 'INVALID_TRANSITION',
          from: current.phase,
          to,
          allowed,
        });
      }

      if (!allowed.includes(to)) {
        await this.appendAdlForced(projectId, workflowId, {
          from: current.phase,
          to,
          reason: transitionOpts.reason ?? null,
          allowed,
        });
      }

      const updated = db.transaction(() =>
        this.updateSpecWorkflowFields(db, projectId, workflowId, { phase: to }),
      )();

      this.emitHook('wf:phase_transitioned', {
        workflowId,
        projectId,
        from: current.phase,
        to,
        forced: transitionOpts.force === true && !allowed.includes(to),
      });
      return updated;
    });
  }

  async listSpecWorkflows(projectId: string): Promise<SpecWorkflow[]> {
    const db = this.requireDb();
    const rows = db
      .query(
        'SELECT * FROM spec_workflows WHERE project_id = ? ORDER BY last_activity DESC',
      )
      .all(projectId) as SpecWorkflowRow[];

    return rows.map((row) => this.rowToSpecWorkflow(row));
  }

  async getSpecWorkflow(
    projectId: string,
    workflowId: string,
  ): Promise<SpecWorkflow | null> {
    const db = this.requireDb();
    const row = db
      .query('SELECT * FROM spec_workflows WHERE project_id = ? AND workflow_id = ?')
      .get(projectId, workflowId) as SpecWorkflowRow | null;

    return row ? this.rowToSpecWorkflow(row) : null;
  }

  async createSpecWorkflow(input: CreateSpecWorkflowInput): Promise<SpecWorkflow> {
    const db = this.requireDb();
    const id = crypto.randomUUID();

    try {
      db.query(
        `INSERT INTO spec_workflows (
          id,
          project_id,
          workflow_id,
          mode,
          depth,
          phase,
          status,
          autopilot,
          lazy_autopilot,
          locked,
          acceptance_confirmed,
          interview_complete,
          interview_completed_at,
          current_wave,
          total_waves,
          is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.projectId,
        input.workflowId,
        input.mode ?? 'standard',
        input.depth ?? 'standard',
        input.phase ?? 'idle',
        input.status ?? 'idle',
        input.autopilot ? 1 : 0,
        input.lazyAutopilot ? 1 : 0,
        input.specLocked ? 1 : 0,
        input.acceptanceConfirmed ? 1 : 0,
        input.interviewComplete ? 1 : 0,
        input.interviewCompletedAt ?? null,
        input.currentWave ?? 0,
        input.totalWaves ?? 0,
        input.isActive ? 1 : 0,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('UNIQUE') || message.includes('constraint failed')) {
        throw new WorkflowExistsError({
          code: 'WORKFLOW_EXISTS',
          projectId: input.projectId,
          workflowId: input.workflowId,
        });
      }

      throw error;
    }

    // TODO(Wave 3 Task 3.2): emit spec:created hook event here.
    return this.getSpecWorkflowOrThrow(db, input.projectId, input.workflowId);
  }

  async setActiveSpecWorkflow(
    projectId: string,
    workflowId: string,
  ): Promise<SpecWorkflow> {
    const db = this.requireDb();

    db.transaction(() => {
      db.query('UPDATE spec_workflows SET is_active = 0 WHERE project_id = ?').run(
        projectId,
      );
      const result = db
        .query(
          `UPDATE spec_workflows
           SET is_active = 1, last_activity = datetime('now'), updated_at = datetime('now')
           WHERE project_id = ? AND workflow_id = ?`,
        )
        .run(projectId, workflowId);

      if (result.changes === 0) {
        throw new WorkflowNotFoundError({
          code: 'WORKFLOW_NOT_FOUND',
          projectId,
          workflowId,
        });
      }
    })();

    return this.getSpecWorkflowOrThrow(db, projectId, workflowId);
  }

  async lock(): Promise<void>;
  async lock(projectId: string, workflowId: string): Promise<SpecWorkflow>;
  async lock(
    projectId?: string,
    workflowId?: string,
  ): Promise<void | SpecWorkflow> {
    if (projectId && workflowId) {
      const db = this.requireDb();
      const mutex = this.getSpecMutex(projectId, workflowId);
      return mutex.withLock(async () => {
        const updated = db.transaction(() =>
          this.updateSpecWorkflowFields(db, projectId, workflowId, { locked: 1 }),
        )();
        this.emitHook('wf:locked', {
          workflowId,
          projectId,
          lockedAt: updated.updatedAt,
        });
        return updated;
      });
    }

    await this.persist((state) => {
      state.workflow.specLocked = true;
    });
  }

  async unlock(): Promise<void>;
  async unlock(projectId: string, workflowId: string): Promise<SpecWorkflow>;
  async unlock(
    projectId?: string,
    workflowId?: string,
  ): Promise<void | SpecWorkflow> {
    if (projectId && workflowId) {
      const db = this.requireDb();
      const mutex = this.getSpecMutex(projectId, workflowId);
      return mutex.withLock(async () => {
        const updated = db.transaction(() =>
          this.updateSpecWorkflowFields(db, projectId, workflowId, { locked: 0 }),
        )();
        this.emitHook('wf:unlocked', { workflowId, projectId });
        return updated;
      });
    }

    await this.persist((state) => {
      state.workflow.specLocked = false;
    });
  }

  async confirmAcceptance(): Promise<void>;
  async confirmAcceptance(projectId: string, workflowId: string): Promise<SpecWorkflow>;
  async confirmAcceptance(
    projectId?: string,
    workflowId?: string,
  ): Promise<void | SpecWorkflow> {
    if (projectId && workflowId) {
      const db = this.requireDb();
      const mutex = this.getSpecMutex(projectId, workflowId);
      return mutex.withLock(async () => {
        const updated = db.transaction(() =>
          this.updateSpecWorkflowFields(db, projectId, workflowId, {
            acceptance_confirmed: 1,
          }),
        )();
        this.emitHook('spec:acceptance_confirmed', {
          projectId,
          workflowId,
          confirmedAt: updated.updatedAt,
        });
        return updated;
      });
    }

    await this.persist((state) => {
      state.workflow.acceptanceConfirmed = true;
    });
  }

  async resetAcceptance(
    projectId: string,
    workflowId: string,
  ): Promise<SpecWorkflow> {
    const db = this.requireDb();
    const mutex = this.getSpecMutex(projectId, workflowId);
    return mutex.withLock(async () =>
      db.transaction(() =>
        this.updateSpecWorkflowFields(db, projectId, workflowId, {
          acceptance_confirmed: 0,
        }),
      )(),
    );
  }

  async completeInterview(): Promise<void>;
  async completeInterview(projectId: string, workflowId: string): Promise<SpecWorkflow>;
  async completeInterview(
    projectId?: string,
    workflowId?: string,
  ): Promise<void | SpecWorkflow> {
    if (projectId && workflowId) {
      const db = this.requireDb();
      const mutex = this.getSpecMutex(projectId, workflowId);
      return mutex.withLock(async () =>
        db.transaction(() =>
          this.updateSpecWorkflowFields(db, projectId, workflowId, {
            interview_complete: 1,
            interview_completed_at: new Date().toISOString(),
          }),
        )(),
      );
    }

    await this.persist((state) => {
      state.workflow.interviewComplete = true;
      state.workflow.interviewCompletedAt = new Date().toISOString();
    });
  }

  async setMode(mode: ElefantState['workflow']['mode']): Promise<void>;
  async setMode(
    projectId: string,
    workflowId: string,
    mode: SpecWorkflowMode,
  ): Promise<SpecWorkflow>;
  async setMode(
    modeOrProjectId: ElefantState['workflow']['mode'] | string,
    workflowId?: string,
    mode?: SpecWorkflowMode,
  ): Promise<void | SpecWorkflow> {
    if (workflowId && mode) {
      const projectId = modeOrProjectId;
      const db = this.requireDb();
      const mutex = this.getSpecMutex(projectId, workflowId);
      return mutex.withLock(async () =>
        db.transaction(() =>
          this.updateSpecWorkflowFields(db, projectId, workflowId, { mode }),
        )(),
      );
    }

    await this.persist((state) => {
      state.workflow.mode = modeOrProjectId as ElefantState['workflow']['mode'];
    });
  }

  async setDepth(depth: ElefantState['workflow']['depth']): Promise<void>;
  async setDepth(
    projectId: string,
    workflowId: string,
    depth: SpecWorkflowDepth,
  ): Promise<SpecWorkflow>;
  async setDepth(
    depthOrProjectId: ElefantState['workflow']['depth'] | string,
    workflowId?: string,
    depth?: SpecWorkflowDepth,
  ): Promise<void | SpecWorkflow> {
    if (workflowId && depth) {
      const projectId = depthOrProjectId;
      const db = this.requireDb();
      const mutex = this.getSpecMutex(projectId, workflowId);
      return mutex.withLock(async () =>
        db.transaction(() =>
          this.updateSpecWorkflowFields(db, projectId, workflowId, { depth }),
        )(),
      );
    }

    await this.persist((state) => {
      state.workflow.depth = depthOrProjectId as ElefantState['workflow']['depth'];
    });
  }

  async setAutopilot(on: boolean, lazy?: boolean): Promise<void>;
  async setAutopilot(
    projectId: string,
    workflowId: string,
    autopilot: boolean,
    lazy?: boolean,
  ): Promise<SpecWorkflow>;
  async setAutopilot(
    onOrProjectId: boolean | string,
    workflowIdOrLazy?: string | boolean,
    autopilot?: boolean,
    lazy = false,
  ): Promise<void | SpecWorkflow> {
    if (typeof onOrProjectId === 'string' && typeof workflowIdOrLazy === 'string' && typeof autopilot === 'boolean') {
      const projectId = onOrProjectId;
      const workflowId = workflowIdOrLazy;
      const db = this.requireDb();
      const mutex = this.getSpecMutex(projectId, workflowId);
      return mutex.withLock(async () =>
        db.transaction(() =>
          this.updateSpecWorkflowFields(db, projectId, workflowId, {
            autopilot: autopilot ? 1 : 0,
            lazy_autopilot: lazy ? 1 : 0,
          }),
        )(),
      );
    }

    if (typeof onOrProjectId !== 'boolean') {
      throw new TypeError('Legacy setAutopilot requires a boolean first argument');
    }

    await this.persist((state) => {
      state.workflow.autopilot = onOrProjectId;
      state.workflow.lazyAutopilot = workflowIdOrLazy === true ? true : undefined;
    });
  }

  async setLazyAutopilot(
    projectId: string,
    workflowId: string,
    lazy: boolean,
  ): Promise<SpecWorkflow> {
    const db = this.requireDb();
    const mutex = this.getSpecMutex(projectId, workflowId);
    return mutex.withLock(async () =>
      db.transaction(() =>
        this.updateSpecWorkflowFields(db, projectId, workflowId, {
          lazy_autopilot: lazy ? 1 : 0,
          ...(lazy ? { autopilot: 1 } : {}),
        }),
      )(),
    );
  }

  async updateWave(current: number, total: number): Promise<void>;
  async updateWave(
    projectId: string,
    workflowId: string,
    currentWave: number,
    totalWaves: number,
  ): Promise<SpecWorkflow>;
  async updateWave(
    currentOrProjectId: number | string,
    totalOrWorkflowId: number | string,
    currentWave?: number,
    totalWaves?: number,
  ): Promise<void | SpecWorkflow> {
    if (typeof currentOrProjectId === 'string' && typeof totalOrWorkflowId === 'string' && typeof currentWave === 'number' && typeof totalWaves === 'number') {
      const projectId = currentOrProjectId;
      const workflowId = totalOrWorkflowId;
      const db = this.requireDb();
      const mutex = this.getSpecMutex(projectId, workflowId);
      return mutex.withLock(async () => {
        const previous = this.getSpecWorkflowOrThrow(db, projectId, workflowId);
        const updated = db.transaction(() =>
          this.updateSpecWorkflowFields(db, projectId, workflowId, {
            current_wave: currentWave,
            total_waves: totalWaves,
          }),
        )();
        if (currentWave > previous.currentWave) {
          if (previous.currentWave > 0) {
            this.emitHook('wave:completed', {
              workflowId,
              projectId,
              waveNumber: previous.currentWave,
            });
          }
          this.emitHook('wave:started', {
            workflowId,
            projectId,
            waveNumber: currentWave,
            taskCount: 0,
          });
        }
        return updated;
      });
    }

    if (typeof currentOrProjectId !== 'number' || typeof totalOrWorkflowId !== 'number') {
      throw new TypeError('Legacy updateWave requires numeric current and total values');
    }

    await this.persist((state) => {
      state.workflow.currentWave = currentOrProjectId;
      state.workflow.totalWaves = totalOrWorkflowId;
    });
  }

  async amendSpec(
    projectId: string,
    workflowId: string,
    amendment: { rationale: string },
  ): Promise<SpecWorkflow> {
    const db = this.requireDb();
    const mutex = this.getSpecMutex(projectId, workflowId);

    return mutex.withLock(async () => {
      const updated = db.transaction(() => {
        const existing = this.getSpecWorkflowOrThrow(db, projectId, workflowId);
        const priorLocked = existing.specLocked;
        void priorLocked;
        void amendment.rationale;

        db.query(
          `UPDATE spec_workflows
           SET locked = 0, last_activity = datetime('now'), updated_at = datetime('now')
           WHERE project_id = ? AND workflow_id = ?`,
        ).run(projectId, workflowId);

        // Extension point: Wave 1/2 document mutation and amendment persistence run here.

        return this.updateSpecWorkflowFields(db, projectId, workflowId, {
          locked: 1,
        });
      })();

      return updated;
    });
  }

  async reset(): Promise<void> {
    await this.persist((state) => {
      const fresh = createDefaultState(this.projectMeta);
      state.workflow = fresh.workflow;
      state.execution = fresh.execution;
      state.workflows = {};
    });
  }
}
