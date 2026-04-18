import { describe, expect, it } from 'bun:test';
import { detectVersion, migrateToV2 } from './migrate.ts';
import {
  createDefaultState,
  ElefantStateSchema,
  ExecutionStateSchema,
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
});
