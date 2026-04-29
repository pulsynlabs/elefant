import { describe, expect, it } from 'bun:test';
import { detectVersion, migrateToV2 } from './migrate.ts';
import {
  createDefaultState,
  ElefantStateSchema,
  ExecutionStateSchema,
  SpecWorkflowSchema,
  WorkflowEntrySchema,
} from './schema.ts';

describe('state schema', () => {
  it('parses a valid v2 state', () => {
    const state = {
      version: 2,
      project: {
        id: 'project-1',
        name: 'Elefant',
        path: '/tmp/elefant',
        initialized: new Date().toISOString(),
      },
      workflow: WorkflowEntrySchema.parse({
        workflowId: 'default',
      }),
      workflows: {},
      execution: ExecutionStateSchema.parse({}),
    };

    const parsed = ElefantStateSchema.parse(state);
    expect(parsed.version).toBe(2);
    expect(parsed.workflow.workflowId).toBe('default');
  });

  it('fails to parse an invalid state', () => {
    const invalid = {
      version: 2,
      project: {
        id: 'project-1',
      },
    };

    expect(() => ElefantStateSchema.parse(invalid)).toThrow();
  });

  it('createDefaultState returns valid v2 state', () => {
    const state = createDefaultState({
      id: 'project-1',
      name: 'Elefant',
      path: '/tmp/elefant',
    });

    const parsed = ElefantStateSchema.parse(state);
    expect(parsed.version).toBe(2);
    expect(parsed.workflow.phase).toBe('idle');
    expect(parsed.execution.activeCheckpointId).toBeNull();
  });

  it('detectVersion identifies v1, v2, and unknown', () => {
    expect(detectVersion({ phase: 'idle' })).toBe(1);
    expect(detectVersion({ version: 1 })).toBe(1);
    expect(detectVersion({ version: 2 })).toBe(2);
    expect(detectVersion({ version: 3 })).toBe('unknown');
    expect(detectVersion(null)).toBe('unknown');
  });

  it('migrates v1 to a valid v2 structure', () => {
    const migrated = migrateToV2(
      { phase: 'plan' },
      {
        id: 'project-1',
        name: 'Elefant',
        path: '/tmp/elefant',
      },
    );

    const parsed = ElefantStateSchema.parse(migrated);
    expect(parsed.version).toBe(2);
    expect(parsed.workflow.phase).toBe('plan');
    expect(parsed.workflows).toEqual({});
  });

  // --- Spec Mode: SpecWorkflowSchema ---

  const makeTimestamp = () => new Date().toISOString();

  it('parses a complete SpecWorkflow object successfully', () => {
    const specWorkflow = {
      id: 'sw-1',
      projectId: 'proj-1',
      workflowId: 'my-feature',
      mode: 'comprehensive',
      depth: 'deep',
      phase: 'plan',
      status: 'active',
      autopilot: true,
      lazyAutopilot: false,
      specLocked: false,
      acceptanceConfirmed: false,
      interviewComplete: true,
      interviewCompletedAt: makeTimestamp(),
      currentWave: 2,
      totalWaves: 5,
      isActive: true,
      lastActivity: makeTimestamp(),
      createdAt: makeTimestamp(),
      updatedAt: makeTimestamp(),
    };

    const parsed = SpecWorkflowSchema.parse(specWorkflow);
    expect(parsed.id).toBe('sw-1');
    expect(parsed.mode).toBe('comprehensive');
    expect(parsed.depth).toBe('deep');
    expect(parsed.currentWave).toBe(2);
    expect(parsed.totalWaves).toBe(5);
    expect(parsed.isActive).toBe(true);
  });

  it('parses a minimal SpecWorkflow with only required fields, filling defaults', () => {
    const ts = makeTimestamp();
    const minimal = {
      id: 'sw-min',
      projectId: 'proj-min',
      workflowId: 'minimal',
      lastActivity: ts,
      createdAt: ts,
      updatedAt: ts,
    };

    const parsed = SpecWorkflowSchema.parse(minimal);
    expect(parsed.id).toBe('sw-min');
    expect(parsed.phase).toBe('idle');
    expect(parsed.mode).toBe('standard');
    expect(parsed.depth).toBe('standard');
    expect(parsed.status).toBe('idle');
    expect(parsed.autopilot).toBe(false);
    expect(parsed.lazyAutopilot).toBe(false);
    expect(parsed.specLocked).toBe(false);
    expect(parsed.acceptanceConfirmed).toBe(false);
    expect(parsed.interviewComplete).toBe(false);
    expect(parsed.interviewCompletedAt).toBeNull();
    expect(parsed.currentWave).toBe(0);
    expect(parsed.totalWaves).toBe(0);
    expect(parsed.isActive).toBe(false);
  });

  it('rejects an invalid phase value with a useful error', () => {
    const ts = makeTimestamp();
    const bad = {
      id: 'sw-bad',
      projectId: 'p',
      workflowId: 'bad',
      phase: 'nonesuch',
      lastActivity: ts,
      createdAt: ts,
      updatedAt: ts,
    };

    expect(() => SpecWorkflowSchema.parse(bad)).toThrow();
  });

  it('allows currentWave > totalWaves (no cross-field validation at schema layer)', () => {
    const ts = makeTimestamp();
    const uneven = {
      id: 'sw-uneven',
      projectId: 'p',
      workflowId: 'uneven',
      currentWave: 5,
      totalWaves: 2,
      lastActivity: ts,
      createdAt: ts,
      updatedAt: ts,
    };

    const parsed = SpecWorkflowSchema.parse(uneven);
    expect(parsed.currentWave).toBe(5);
    expect(parsed.totalWaves).toBe(2);
  });

  it('handles round-trip serialization for SpecWorkflow', () => {
    const ts = makeTimestamp();
    const original = {
      id: 'sw-rt',
      projectId: 'proj-rt',
      workflowId: 'roundtrip',
      mode: 'standard',
      depth: 'standard',
      phase: 'execute',
      status: 'running',
      autopilot: false,
      lazyAutopilot: false,
      specLocked: true,
      acceptanceConfirmed: false,
      interviewComplete: true,
      interviewCompletedAt: ts,
      currentWave: 3,
      totalWaves: 7,
      isActive: true,
      lastActivity: ts,
      createdAt: ts,
      updatedAt: ts,
    };

    const parsed1 = SpecWorkflowSchema.parse(original);
    const json = JSON.stringify(parsed1);
    const rehydrated = JSON.parse(json);
    const parsed2 = SpecWorkflowSchema.parse(rehydrated);

    expect(parsed2).toEqual(parsed1);
  });

  it('preserves multiple specModeWorkflows entries with different workflowIds', () => {
    const ts = makeTimestamp();
    const state = {
      version: 2,
      project: {
        id: 'proj-multi',
        name: 'Multi',
        path: '/tmp/multi',
        initialized: ts,
      },
      workflow: WorkflowEntrySchema.parse({ workflowId: 'default' }),
      workflows: {},
      specModeWorkflows: {
        'feat-auth': {
          id: 'sw-1', projectId: 'proj-multi', workflowId: 'feat-auth',
          mode: 'standard', depth: 'standard', phase: 'plan',
          status: 'active', autopilot: false, lazyAutopilot: false,
          specLocked: false, acceptanceConfirmed: false,
          interviewComplete: true, interviewCompletedAt: ts,
          currentWave: 0, totalWaves: 3, isActive: true,
          lastActivity: ts, createdAt: ts, updatedAt: ts,
        },
        'fix-bug': {
          id: 'sw-2', projectId: 'proj-multi', workflowId: 'fix-bug',
          mode: 'quick', depth: 'shallow', phase: 'execute',
          status: 'active', autopilot: true, lazyAutopilot: false,
          specLocked: true, acceptanceConfirmed: false,
          interviewComplete: true, interviewCompletedAt: ts,
          currentWave: 1, totalWaves: 1, isActive: false,
          lastActivity: ts, createdAt: ts, updatedAt: ts,
        },
      },
      execution: ExecutionStateSchema.parse({}),
    };

    const parsed = ElefantStateSchema.parse(state);
    expect(Object.keys(parsed.specModeWorkflows)).toHaveLength(2);
    expect(parsed.specModeWorkflows['feat-auth']?.workflowId).toBe('feat-auth');
    expect(parsed.specModeWorkflows['fix-bug']?.workflowId).toBe('fix-bug');
    expect(parsed.specModeWorkflows['fix-bug']?.mode).toBe('quick');
  });

  // --- Spec Mode: Coexistence with legacy workflows ---

  it('parses state with only legacy workflows — specModeWorkflows defaults to empty', () => {
    const state = {
      version: 2,
      project: {
        id: 'proj-legacy',
        name: 'Legacy',
        path: '/tmp/legacy',
        initialized: makeTimestamp(),
      },
      workflow: WorkflowEntrySchema.parse({ workflowId: 'default' }),
      workflows: {
        'default': WorkflowEntrySchema.parse({ workflowId: 'default' }),
      },
      execution: ExecutionStateSchema.parse({}),
    };

    const parsed = ElefantStateSchema.parse(state);
    expect(parsed.specModeWorkflows).toEqual({});
    expect(parsed.workflows).toEqual(state.workflows);
  });

  it('parses state with only specModeWorkflows (no legacy workflows field)', () => {
    const ts = makeTimestamp();
    const state = {
      version: 2,
      project: {
        id: 'proj-new',
        name: 'New',
        path: '/tmp/new',
        initialized: ts,
      },
      workflow: WorkflowEntrySchema.parse({ workflowId: 'default' }),
      workflows: {},
      specModeWorkflows: {
        'my-workflow': {
          id: 'sw-1', projectId: 'proj-new', workflowId: 'my-workflow',
          mode: 'standard', depth: 'standard', phase: 'discuss',
          status: 'active', autopilot: false, lazyAutopilot: false,
          specLocked: false, acceptanceConfirmed: false,
          interviewComplete: false, interviewCompletedAt: null,
          currentWave: 0, totalWaves: 0, isActive: true,
          lastActivity: ts, createdAt: ts, updatedAt: ts,
        },
      },
      execution: ExecutionStateSchema.parse({}),
    };

    const parsed = ElefantStateSchema.parse(state);
    expect(Object.keys(parsed.specModeWorkflows)).toHaveLength(1);
    expect(parsed.specModeWorkflows['my-workflow']?.phase).toBe('discuss');
    expect(parsed.workflows).toEqual({});
  });

  it('parses state with BOTH legacy workflows and specModeWorkflows — both preserved', () => {
    const ts = makeTimestamp();
    const state = {
      version: 2,
      project: {
        id: 'proj-mixed',
        name: 'Mixed',
        path: '/tmp/mixed',
        initialized: ts,
      },
      workflow: WorkflowEntrySchema.parse({ workflowId: 'default' }),
      workflows: {
        'default': WorkflowEntrySchema.parse({ workflowId: 'default' }),
      },
      specModeWorkflows: {
        'spec-feature': {
          id: 'sw-mix', projectId: 'proj-mixed', workflowId: 'spec-feature',
          mode: 'milestone', depth: 'deep', phase: 'execute',
          status: 'running', autopilot: true, lazyAutopilot: true,
          specLocked: true, acceptanceConfirmed: false,
          interviewComplete: true, interviewCompletedAt: ts,
          currentWave: 3, totalWaves: 8, isActive: true,
          lastActivity: ts, createdAt: ts, updatedAt: ts,
        },
      },
      execution: ExecutionStateSchema.parse({}),
    };

    const parsed = ElefantStateSchema.parse(state);
    expect(Object.keys(parsed.workflows)).toHaveLength(1);
    expect(Object.keys(parsed.specModeWorkflows)).toHaveLength(1);
    expect(parsed.workflows['default']?.phase).toBe('idle');
    expect(parsed.specModeWorkflows['spec-feature']?.mode).toBe('milestone');
    expect(parsed.specModeWorkflows['spec-feature']?.lazyAutopilot).toBe(true);
  });

  it('specModeWorkflows round-trip: parse → stringify → re-parse → deep equal', () => {
    const ts = makeTimestamp();
    const state = {
      version: 2,
      project: {
        id: 'proj-rt2',
        name: 'RT2',
        path: '/tmp/rt2',
        initialized: ts,
      },
      workflow: WorkflowEntrySchema.parse({ workflowId: 'default' }),
      workflows: {
        'default': WorkflowEntrySchema.parse({ workflowId: 'default' }),
      },
      specModeWorkflows: {
        'rt-feature': {
          id: 'sw-rt2', projectId: 'proj-rt2', workflowId: 'rt-feature',
          mode: 'standard', depth: 'standard', phase: 'audit',
          status: 'verifying', autopilot: false, lazyAutopilot: false,
          specLocked: true, acceptanceConfirmed: false,
          interviewComplete: true, interviewCompletedAt: ts,
          currentWave: 5, totalWaves: 5, isActive: true,
          lastActivity: ts, createdAt: ts, updatedAt: ts,
        },
      },
      execution: ExecutionStateSchema.parse({}),
    };

    const parsed1 = ElefantStateSchema.parse(state);
    const json = JSON.stringify(parsed1);
    const rehydrated = JSON.parse(json);
    const parsed2 = ElefantStateSchema.parse(rehydrated);

    expect(parsed2).toEqual(parsed1);
  });
});
