import { z } from 'zod';

export const WorkflowPhaseSchema = z.enum([
  'idle',
  'plan',
  'research',
  'specify',
  'execute',
  'accept',
]);

export const TaskModeSchema = z.enum([
  'quick',
  'standard',
  'comprehensive',
  'milestone',
]);

export const WorkflowDepthSchema = z.enum(['shallow', 'standard', 'deep']);

export const WorkflowEntrySchema = z.object({
  workflowId: z.string(),
  phase: WorkflowPhaseSchema.default('idle'),
  mode: TaskModeSchema.default('standard'),
  depth: WorkflowDepthSchema.default('standard'),
  specLocked: z.boolean().default(false),
  acceptanceConfirmed: z.boolean().default(false),
  interviewComplete: z.boolean().default(false),
  interviewCompletedAt: z.string().nullable().default(null),
  currentWave: z.number().int().default(0),
  totalWaves: z.number().int().default(0),
  lastActivity: z.string().default(() => new Date().toISOString()),
  autopilot: z.boolean().optional(),
  lazyAutopilot: z.boolean().optional(),
});
export type WorkflowEntry = z.infer<typeof WorkflowEntrySchema>;

export const ProjectInfoStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  initialized: z.string(),
});

export const ExecutionStateSchema = z.object({
  activeCheckpointId: z.string().nullable().default(null),
  completedPhases: z.array(z.string()).default([]),
  pendingTasks: z.array(z.unknown()).default([]),
});

export const ElefantStateSchema = z.object({
  version: z.literal(2),
  project: ProjectInfoStateSchema,
  workflow: WorkflowEntrySchema,
  workflows: z.record(z.string(), WorkflowEntrySchema).default({}),
  execution: ExecutionStateSchema.default({}),
});
export type ElefantState = z.infer<typeof ElefantStateSchema>;

export function createDefaultState(project: {
  id: string;
  name: string;
  path: string;
}): ElefantState {
  const now = new Date().toISOString();

  return {
    version: 2,
    project: {
      ...project,
      initialized: now,
    },
    workflow: WorkflowEntrySchema.parse({
      workflowId: 'default',
      lastActivity: now,
    }),
    workflows: {},
    execution: ExecutionStateSchema.parse({}),
  };
}
