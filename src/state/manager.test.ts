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
import { statePath } from '../project/paths.ts';
import {
  InvalidTransitionError,
  SpecModeNotConfiguredError,
  WorkflowExistsError,
  WorkflowNotFoundError,
} from './errors.ts';
import { StateManager } from './manager.ts';

const tempDirs: string[] = [];
const databases: Database[] = [];

function createTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'elefant-state-manager-'));
  tempDirs.push(dir);
  return dir;
}

function createManager(projectPath: string): StateManager {
  return new StateManager(projectPath, {
    id: `project-${crypto.randomUUID()}`,
    name: 'elefant-test',
    path: projectPath,
  });
}

function createSpecManager(): {
  manager: StateManager;
  database: Database;
  projectId: string;
  projectPath: string;
} {
  const projectPath = createTempProject();
  const projectId = `project-${crypto.randomUUID()}`;
  mkdirSync(join(projectPath, '.elefant'), { recursive: true });
  const database = new Database(join(projectPath, '.elefant', 'db.sqlite'));
  databases.push(database);
  database.db
    .query('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)')
    .run(projectId, 'elefant-test', projectPath);

  const manager = new StateManager(projectPath, {
    id: projectId,
    name: 'elefant-test',
    path: projectPath,
    database,
  });

  return { manager, database, projectId, projectPath };
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('StateManager spec-mode', () => {
  it('createSpecWorkflow persists and returns a parsed workflow', async () => {
    const { manager, projectId } = createSpecManager();

    const workflow = await manager.createSpecWorkflow({
      projectId,
      workflowId: 'flow-a',
      mode: 'quick',
      depth: 'deep',
      isActive: true,
    });

    expect(workflow.id.length).toBeGreaterThan(0);
    expect(workflow.projectId).toBe(projectId);
    expect(workflow.workflowId).toBe('flow-a');
    expect(workflow.mode).toBe('quick');
    expect(workflow.depth).toBe('deep');
    expect(workflow.phase).toBe('idle');
    expect(workflow.isActive).toBe(true);
  });

  it('createSpecWorkflow rejects duplicates with WorkflowExistsError', async () => {
    const { manager, projectId } = createSpecManager();

    await manager.createSpecWorkflow({ projectId, workflowId: 'flow-a' });

    await expect(
      manager.createSpecWorkflow({ projectId, workflowId: 'flow-a' }),
    ).rejects.toBeInstanceOf(WorkflowExistsError);
  });

  it('getSpecWorkflow returns null for missing workflow', async () => {
    const { manager, projectId } = createSpecManager();

    await expect(manager.getSpecWorkflow(projectId, 'missing')).resolves.toBeNull();
  });

  it('listSpecWorkflows returns workflows ordered by last_activity descending', async () => {
    const { manager, database, projectId } = createSpecManager();

    await manager.createSpecWorkflow({ projectId, workflowId: 'old' });
    await manager.createSpecWorkflow({ projectId, workflowId: 'new' });
    database.db
      .query(
        `UPDATE spec_workflows
         SET last_activity = ?
         WHERE project_id = ? AND workflow_id = ?`,
      )
      .run('2026-01-01 00:00:00', projectId, 'old');
    database.db
      .query(
        `UPDATE spec_workflows
         SET last_activity = ?
         WHERE project_id = ? AND workflow_id = ?`,
      )
      .run('2026-01-02 00:00:00', projectId, 'new');

    const workflows = await manager.listSpecWorkflows(projectId);

    expect(workflows.map((workflow) => workflow.workflowId)).toEqual(['new', 'old']);
  });

  it('setActiveSpecWorkflow sets exactly one active workflow', async () => {
    const { manager, projectId } = createSpecManager();
    await manager.createSpecWorkflow({ projectId, workflowId: 'flow-a', isActive: true });
    await manager.createSpecWorkflow({ projectId, workflowId: 'flow-b' });

    const active = await manager.setActiveSpecWorkflow(projectId, 'flow-b');
    const workflows = await manager.listSpecWorkflows(projectId);

    expect(active.workflowId).toBe('flow-b');
    expect(workflows.filter((workflow) => workflow.isActive)).toHaveLength(1);
    expect(workflows.find((workflow) => workflow.isActive)?.workflowId).toBe('flow-b');
  });

  it('setActiveSpecWorkflow rejects missing workflows', async () => {
    const { manager, projectId } = createSpecManager();

    await expect(
      manager.setActiveSpecWorkflow(projectId, 'missing'),
    ).rejects.toBeInstanceOf(WorkflowNotFoundError);
  });

  it('transitionSpecPhase persists a valid transition', async () => {
    const { manager, projectId } = createSpecManager();
    await manager.createSpecWorkflow({ projectId, workflowId: 'flow-a' });

    const workflow = await manager.transitionSpecPhase(projectId, 'flow-a', 'plan');

    expect(workflow.phase).toBe('plan');
  });

  it('transitionSpecPhase rejects invalid non-forced transitions with allowed phases', async () => {
    const { manager, projectId } = createSpecManager();
    await manager.createSpecWorkflow({ projectId, workflowId: 'flow-a' });

    try {
      await manager.transitionSpecPhase(projectId, 'flow-a', 'execute');
      throw new Error('Expected transition to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransitionError);
      const transitionError = error as InvalidTransitionError;
      expect(transitionError.from).toBe('idle');
      expect(transitionError.to).toBe('execute');
      expect(transitionError.allowed).toEqual(['discuss', 'plan']);
    }

    const workflow = await manager.getSpecWorkflow(projectId, 'flow-a');
    expect(workflow?.phase).toBe('idle');
  });

  it('transitionSpecPhase allows invalid forced transitions and logs the ADL stub', async () => {
    const { manager, projectId } = createSpecManager();
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);
    await manager.createSpecWorkflow({ projectId, workflowId: 'flow-a' });

    const workflow = await manager.transitionSpecPhase(projectId, 'flow-a', 'execute', {
      force: true,
      reason: 'operator override',
    });

    expect(workflow.phase).toBe('execute');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('spec_adl_forced_stub');
    warnSpy.mockRestore();
  });

  it('lockSpec and unlockSpec toggle spec_locked', async () => {
    const { manager, projectId } = createSpecManager();
    await manager.createSpecWorkflow({ projectId, workflowId: 'flow-a' });

    const locked = await manager.lockSpec(projectId, 'flow-a');
    const unlocked = await manager.unlockSpec(projectId, 'flow-a');

    expect(locked.specLocked).toBe(true);
    expect(unlocked.specLocked).toBe(false);
  });

  it('setMode and setDepth persist workflow settings', async () => {
    const { manager, projectId } = createSpecManager();
    await manager.createSpecWorkflow({ projectId, workflowId: 'flow-a' });

    const withMode = await manager.setMode(projectId, 'flow-a', 'comprehensive');
    const withDepth = await manager.setDepth(projectId, 'flow-a', 'deep');

    expect(withMode.mode).toBe('comprehensive');
    expect(withDepth.depth).toBe('deep');
  });

  it('setAutopilot persists autopilot and lazy flags atomically', async () => {
    const { manager, projectId } = createSpecManager();
    await manager.createSpecWorkflow({ projectId, workflowId: 'flow-a' });

    const workflow = await manager.setAutopilot(projectId, 'flow-a', true, true);

    expect(workflow.autopilot).toBe(true);
    expect(workflow.lazyAutopilot).toBe(true);
  });

  it('setLazyAutopilot(true) implies autopilot', async () => {
    const { manager, projectId } = createSpecManager();
    await manager.createSpecWorkflow({ projectId, workflowId: 'flow-a' });

    const workflow = await manager.setLazyAutopilot(projectId, 'flow-a', true);

    expect(workflow.autopilot).toBe(true);
    expect(workflow.lazyAutopilot).toBe(true);
  });

  it('completeInterview sets the flag and completion timestamp', async () => {
    const { manager, projectId } = createSpecManager();
    await manager.createSpecWorkflow({ projectId, workflowId: 'flow-a' });

    const workflow = await manager.completeInterview(projectId, 'flow-a');

    expect(workflow.interviewComplete).toBe(true);
    expect(workflow.interviewCompletedAt).not.toBeNull();
  });

  it('updateWave persists current and total wave counters', async () => {
    const { manager, projectId } = createSpecManager();
    await manager.createSpecWorkflow({ projectId, workflowId: 'flow-a' });

    const workflow = await manager.updateWave(projectId, 'flow-a', 2, 5);

    expect(workflow.currentWave).toBe(2);
    expect(workflow.totalWaves).toBe(5);
  });

  it('confirmAcceptance and resetAcceptance toggle acceptance flag', async () => {
    const { manager, projectId } = createSpecManager();
    await manager.createSpecWorkflow({ projectId, workflowId: 'flow-a' });

    const confirmed = await manager.confirmAcceptance(projectId, 'flow-a');
    const reset = await manager.resetAcceptance(projectId, 'flow-a');

    expect(confirmed.acceptanceConfirmed).toBe(true);
    expect(reset.acceptanceConfirmed).toBe(false);
  });

  it('amendSpec ends with spec_locked true', async () => {
    const { manager, projectId } = createSpecManager();
    await manager.createSpecWorkflow({ projectId, workflowId: 'flow-a', specLocked: true });

    const workflow = await manager.amendSpec(projectId, 'flow-a', {
      rationale: 'Adjust locked contract',
    });

    expect(workflow.specLocked).toBe(true);
  });

  it('serializes concurrent transitions on the same workflow mutex', async () => {
    const { manager, projectId } = createSpecManager();
    await manager.createSpecWorkflow({ projectId, workflowId: 'flow-a' });

    const results = await Promise.all([
      manager.transitionSpecPhase(projectId, 'flow-a', 'discuss'),
      manager.transitionSpecPhase(projectId, 'flow-a', 'plan'),
      manager.transitionSpecPhase(projectId, 'flow-a', 'research'),
      manager.transitionSpecPhase(projectId, 'flow-a', 'specify'),
      manager.transitionSpecPhase(projectId, 'flow-a', 'execute'),
    ]);

    expect(results.map((workflow) => workflow.phase)).toEqual([
      'discuss',
      'plan',
      'research',
      'specify',
      'execute',
    ]);
    expect((await manager.getSpecWorkflow(projectId, 'flow-a'))?.phase).toBe('execute');
  });

  it('continues supporting legacy state operations without a database', async () => {
    const projectPath = createTempProject();
    const manager = createManager(projectPath);

    await manager.updateWorkflow({ mode: 'quick' });

    expect(manager.getState().workflow.mode).toBe('quick');
  });

  it('throws SpecModeNotConfiguredError for spec-mode methods without a database', async () => {
    const projectPath = createTempProject();
    const manager = createManager(projectPath);

    await expect(manager.listSpecWorkflows('project-a')).rejects.toBeInstanceOf(
      SpecModeNotConfiguredError,
    );
  });
});

describe('StateManager', () => {
  it('creates default state.json in empty project', () => {
    const projectPath = createTempProject();
    const manager = createManager(projectPath);
    const state = manager.getState();

    expect(existsSync(statePath(projectPath))).toBe(true);
    expect(state.version).toBe(2);
    expect(state.workflow.workflowId).toBe('default');
    expect(state.workflow.phase).toBe('idle');
  });

  it('supports all mutator operations', async () => {
    const projectPath = createTempProject();
    const manager = createManager(projectPath);

    await manager.updateWorkflow({ phase: 'plan' });
    expect(manager.getState().workflow.phase).toBe('plan');

    const created = await manager.createWorkflow('flow-a', { mode: 'quick' });
    expect(created.workflowId).toBe('flow-a');
    expect(manager.getState().workflows['flow-a']?.mode).toBe('quick');

    expect(await manager.setActiveWorkflow('flow-a')).toBe(true);
    expect(manager.getState().workflow.workflowId).toBe('flow-a');

    expect(await manager.setActiveWorkflow('missing-flow')).toBe(false);

    await manager.reset();
    expect(manager.getState().workflow.phase).toBe('idle');

    expect(await manager.transitionPhase('plan')).toBe(true);
    expect(await manager.transitionPhase('accept')).toBe(false);
    expect(manager.getState().workflow.phase).toBe('plan');

    await manager.lockSpec();
    expect(manager.getState().workflow.specLocked).toBe(true);

    await manager.unlockSpec();
    expect(manager.getState().workflow.specLocked).toBe(false);

    await manager.confirmAcceptance();
    expect(manager.getState().workflow.acceptanceConfirmed).toBe(true);

    await manager.completeInterview();
    expect(manager.getState().workflow.interviewComplete).toBe(true);
    expect(manager.getState().workflow.interviewCompletedAt).not.toBeNull();

    await manager.setMode('comprehensive');
    expect(manager.getState().workflow.mode).toBe('comprehensive');

    await manager.setDepth('deep');
    expect(manager.getState().workflow.depth).toBe('deep');

    await manager.setAutopilot(true, true);
    expect(manager.getState().workflow.autopilot).toBe(true);
    expect(manager.getState().workflow.lazyAutopilot).toBe(true);

    await manager.updateWave(2, 5);
    expect(manager.getState().workflow.currentWave).toBe(2);
    expect(manager.getState().workflow.totalWaves).toBe(5);

    await manager.reset();
    const reset = manager.getState();
    expect(reset.workflow.phase).toBe('idle');
    expect(reset.execution.pendingTasks).toEqual([]);
    expect(reset.workflows).toEqual({});
  });

  it('round-trips persisted state through disk', async () => {
    const projectPath = createTempProject();
    const managerA = createManager(projectPath);

    await managerA.updateWorkflow({ phase: 'plan', mode: 'milestone' });
    await managerA.lockSpec();
    await managerA.createWorkflow('wf-1', { depth: 'deep' });
    await managerA.updateWave(1, 3);

    const expected = managerA.getState();
    const managerB = createManager(projectPath);
    const loaded = managerB.getState();

    expect(loaded).toEqual(expected);
  });

  it('serializes concurrent mutations without corruption', async () => {
    const projectPath = createTempProject();
    const manager = createManager(projectPath);

    const before = manager.getState().workflow.lastActivity;

    await Promise.all([
      manager.updateWorkflow({ mode: 'quick' }),
      manager.updateWorkflow({ mode: 'standard' }),
      manager.updateWorkflow({ mode: 'comprehensive' }),
      manager.updateWorkflow({ mode: 'milestone' }),
      manager.updateWorkflow({ depth: 'deep' }),
    ]);

    const after = manager.getState();
    expect(after.version).toBe(2);
    expect(after.workflow.lastActivity).not.toBe(before);

    const parsed = JSON.parse(readFileSync(statePath(projectPath), 'utf-8')) as {
      version: number;
      workflow: {
        workflowId: string;
      };
      execution: {
        pendingTasks: unknown[];
      };
    };
    expect(parsed.version).toBe(2);
    expect(parsed.workflow.workflowId.length).toBeGreaterThan(0);
    expect(Array.isArray(parsed.execution.pendingTasks)).toBe(true);
  });

  it('migrates v1 state to v2 on load', () => {
    const projectPath = createTempProject();
    const path = statePath(projectPath);
    mkdirSync(join(projectPath, '.elefant'), { recursive: true });

    writeFileSync(path, JSON.stringify({ phase: 'execute' }), 'utf-8');

    const manager = createManager(projectPath);
    const state = manager.getState();

    expect(state.version).toBe(2);
    expect(state.workflow.phase).toBe('execute');
    expect(state.workflows).toEqual({});
    expect(state.execution.activeCheckpointId).toBeNull();
  });
});
