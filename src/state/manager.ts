import { existsSync, readFileSync } from 'node:fs';
import { statePath } from '../project/paths.ts';
import { atomicWriteJson } from './atomic.ts';
import { migrateToV2 } from './migrate.ts';
import { AsyncMutex } from './mutex.ts';
import {
  createDefaultState,
  ElefantStateSchema,
  type ElefantState,
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

export class StateManager {
  private state: ElefantState;
  private readonly mutex = new AsyncMutex();
  private readonly filePath: string;

  constructor(
    projectPath: string,
    private readonly projectMeta: { id: string; name: string; path: string },
  ) {
    this.filePath = statePath(projectPath);
    this.state = this.load();
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

  async transitionPhase(to: WorkflowPhase): Promise<boolean> {
    const current = this.state.workflow.phase;
    if (!VALID_PHASE_TRANSITIONS[current].includes(to)) {
      return false;
    }

    await this.persist((state) => {
      state.workflow.phase = to;
    });

    return true;
  }

  async lockSpec(): Promise<void> {
    await this.persist((state) => {
      state.workflow.specLocked = true;
    });
  }

  async unlockSpec(): Promise<void> {
    await this.persist((state) => {
      state.workflow.specLocked = false;
    });
  }

  async confirmAcceptance(): Promise<void> {
    await this.persist((state) => {
      state.workflow.acceptanceConfirmed = true;
    });
  }

  async completeInterview(): Promise<void> {
    await this.persist((state) => {
      state.workflow.interviewComplete = true;
      state.workflow.interviewCompletedAt = new Date().toISOString();
    });
  }

  async setMode(mode: ElefantState['workflow']['mode']): Promise<void> {
    await this.persist((state) => {
      state.workflow.mode = mode;
    });
  }

  async setDepth(depth: ElefantState['workflow']['depth']): Promise<void> {
    await this.persist((state) => {
      state.workflow.depth = depth;
    });
  }

  async setAutopilot(on: boolean, lazy = false): Promise<void> {
    await this.persist((state) => {
      state.workflow.autopilot = on;
      state.workflow.lazyAutopilot = lazy ? true : undefined;
    });
  }

  async updateWave(current: number, total: number): Promise<void> {
    await this.persist((state) => {
      state.workflow.currentWave = current;
      state.workflow.totalWaves = total;
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
