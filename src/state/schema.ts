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

// --- Spec Mode schemas (coexist alongside legacy WorkflowEntrySchema) ---

export const SpecWorkflowPhase = z.enum([
  'idle',
  'discuss',
  'plan',
  'research',
  'specify',
  'execute',
  'audit',
  'accept',
]);
export type SpecWorkflowPhase = z.infer<typeof SpecWorkflowPhase>;

export const SpecWorkflowMode = z.enum([
  'quick',
  'standard',
  'comprehensive',
  'milestone',
]);
export type SpecWorkflowMode = z.infer<typeof SpecWorkflowMode>;

export const SpecWorkflowDepth = z.enum(['shallow', 'standard', 'deep']);
export type SpecWorkflowDepth = z.infer<typeof SpecWorkflowDepth>;

export const SpecWorkflowSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  workflowId: z.string(),
  mode: SpecWorkflowMode.default('standard'),
  depth: SpecWorkflowDepth.default('standard'),
  phase: SpecWorkflowPhase.default('idle'),
  status: z.string().default('idle'),
  autopilot: z.boolean().default(false),
  lazyAutopilot: z.boolean().default(false),
  specLocked: z.boolean().default(false),
  acceptanceConfirmed: z.boolean().default(false),
  interviewComplete: z.boolean().default(false),
  interviewCompletedAt: z.string().nullable().default(null),
  currentWave: z.number().int().nonnegative().default(0),
  totalWaves: z.number().int().nonnegative().default(0),
  isActive: z.boolean().default(false),
  lastActivity: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SpecWorkflow = z.infer<typeof SpecWorkflowSchema>;

// ---

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
  specModeWorkflows: z.record(z.string(), SpecWorkflowSchema).optional().default({}),
  execution: ExecutionStateSchema.default({
    activeCheckpointId: null,
    completedPhases: [],
    pendingTasks: [],
  }),
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
    specModeWorkflows: {},
    execution: ExecutionStateSchema.parse({}),
  };
}
