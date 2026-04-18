import { afterEach, describe, expect, it } from 'bun:test';
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
import { statePath } from '../project/paths.ts';
import { StateManager } from './manager.ts';

const tempDirs: string[] = [];

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

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
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
