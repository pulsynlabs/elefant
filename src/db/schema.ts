import { z } from 'zod';

// ─── projects ───────────────────────────────────────────────────────────────

export const ProjectRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  path: z.string().min(1),
  description: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ProjectRow = z.infer<typeof ProjectRowSchema>;

export const InsertProjectSchema = ProjectRowSchema.extend({
  id: z.string().uuid().optional().default(() => crypto.randomUUID()),
  description: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});
export type InsertProject = z.infer<typeof InsertProjectSchema>;

export const UpdateProjectSchema = ProjectRowSchema.partial().required({ id: true });
export type UpdateProject = z.infer<typeof UpdateProjectSchema>;

// ─── sessions ───────────────────────────────────────────────────────────────

export const SessionStatusSchema = z.enum([
  'pending',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);

export const SessionRowSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  workflow_id: z.string().nullable(),
  phase: z.string().default('idle'),
  status: SessionStatusSchema,
  started_at: z.string(),
  completed_at: z.string().nullable(),
  updated_at: z.string(),
});
export type SessionRow = z.infer<typeof SessionRowSchema>;

export const InsertSessionSchema = SessionRowSchema.extend({
  id: z.string().uuid().optional().default(() => crypto.randomUUID()),
  workflow_id: z.string().nullable().optional(),
  phase: z.string().optional(),
  status: SessionStatusSchema.optional(),
  started_at: z.string().optional(),
  completed_at: z.string().nullable().optional(),
  updated_at: z.string().optional(),
});
export type InsertSession = z.infer<typeof InsertSessionSchema>;

export const UpdateSessionSchema = SessionRowSchema.partial().required({ id: true });
export type UpdateSession = z.infer<typeof UpdateSessionSchema>;

// ─── events ─────────────────────────────────────────────────────────────────

export const EventDataSchema = z.record(z.string(), z.unknown());

export const EventRowSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  type: z.string().min(1),
  data: z.string().default('{}'),
  timestamp: z.string(),
});
export type EventRow = z.infer<typeof EventRowSchema>;

export const InsertEventSchema = EventRowSchema.extend({
  id: z.string().uuid().optional().default(() => crypto.randomUUID()),
  data: z.string().optional(),
  timestamp: z.string().optional(),
});
export type InsertEvent = z.infer<typeof InsertEventSchema>;

export function parseEventData(data: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(data);
    return EventDataSchema.parse(parsed);
  } catch {
    return {};
  }
}

// ─── work_items ─────────────────────────────────────────────────────────────

export const WorkItemTypeSchema = z.enum(['feature', 'bug', 'chore']);
export const WorkItemStatusSchema = z.enum([
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
]);
export const WorkItemPrioritySchema = z.enum(['low', 'medium', 'high', 'critical']);

export const WorkItemRowSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().nullable(),
  type: WorkItemTypeSchema,
  status: WorkItemStatusSchema,
  priority: WorkItemPrioritySchema,
  tags: z.string().default('[]'),
  order_index: z.number().int().default(0),
  created_at: z.string(),
  updated_at: z.string(),
});
export type WorkItemRow = z.infer<typeof WorkItemRowSchema>;

export const InsertWorkItemSchema = WorkItemRowSchema.extend({
  id: z.string().uuid().optional().default(() => crypto.randomUUID()),
  description: z.string().nullable().optional(),
  type: WorkItemTypeSchema.optional(),
  status: WorkItemStatusSchema.optional(),
  priority: WorkItemPrioritySchema.optional(),
  tags: z.string().optional(),
  order_index: z.number().int().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});
export type InsertWorkItem = z.infer<typeof InsertWorkItemSchema>;

export const UpdateWorkItemSchema = WorkItemRowSchema.partial().required({ id: true });
export type UpdateWorkItem = z.infer<typeof UpdateWorkItemSchema>;

// ─── checkpoints ────────────────────────────────────────────────────────────

export const CheckpointRowSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  data: z.string().default('{}'),
  created_at: z.string(),
});
export type CheckpointRow = z.infer<typeof CheckpointRowSchema>;

export const InsertCheckpointSchema = CheckpointRowSchema.extend({
  id: z.string().uuid().optional().default(() => crypto.randomUUID()),
  data: z.string().optional(),
  created_at: z.string().optional(),
});
export type InsertCheckpoint = z.infer<typeof InsertCheckpointSchema>;

// ─── memory_entries ──────────────────────────────────────────────────────────

export const MemoryTypeSchema = z.enum([
  'observation',
  'decision',
  'note',
  'todo',
  'session_summary',
]);

export const MemoryEntryRowSchema = z.object({
  id: z.number().int(),
  type: MemoryTypeSchema,
  title: z.string().min(1),
  content: z.string().min(1),
  importance: z.number().int().min(1).max(10),
  concepts: z.string().default('[]'),
  source_files: z.string().default('[]'),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});
export type MemoryEntryRow = z.infer<typeof MemoryEntryRowSchema>;

export const InsertMemoryEntrySchema = MemoryEntryRowSchema.omit({ id: true }).extend({
  type: MemoryTypeSchema.optional(),
  importance: z.number().int().min(1).max(10).optional(),
  concepts: z.string().optional(),
  source_files: z.string().optional(),
  created_at: z.number().int().optional(),
  updated_at: z.number().int().optional(),
});
export type InsertMemoryEntry = z.infer<typeof InsertMemoryEntrySchema>;

export const UpdateMemoryEntrySchema = MemoryEntryRowSchema.partial().required({ id: true });
export type UpdateMemoryEntry = z.infer<typeof UpdateMemoryEntrySchema>;

export function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
