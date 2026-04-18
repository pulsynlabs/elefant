import type { ElefantState } from './schema.ts';
import {
  createDefaultState,
  ElefantStateSchema,
  WorkflowPhaseSchema,
} from './schema.ts';

export function detectVersion(raw: unknown): 1 | 2 | 'unknown' {
  if (!raw || typeof raw !== 'object') {
    return 'unknown';
  }

  const obj = raw as Record<string, unknown>;
  if (obj.version === 2) {
    return 2;
  }

  if (!obj.version || obj.version === 1) {
    return 1;
  }

  return 'unknown';
}

export function migrateToV2(
  raw: unknown,
  fallbackProject: { id: string; name: string; path: string },
): ElefantState {
  const version = detectVersion(raw);

  if (version === 2) {
    return ElefantStateSchema.parse(raw);
  }

  if (version === 1) {
    const defaults = createDefaultState(fallbackProject);
    const v1 = raw as Record<string, unknown>;
    const candidatePhase = WorkflowPhaseSchema.safeParse(v1.phase);

    const migrated: ElefantState = {
      ...defaults,
      workflow: {
        ...defaults.workflow,
        ...(candidatePhase.success ? { phase: candidatePhase.data } : {}),
      },
    };

    return ElefantStateSchema.parse(migrated);
  }

  return createDefaultState(fallbackProject);
}
