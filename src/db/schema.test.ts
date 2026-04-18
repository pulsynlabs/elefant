import { describe, it, expect } from 'bun:test';
import {
  ProjectRowSchema,
  InsertProjectSchema,
  UpdateProjectSchema,
  SessionRowSchema,
  InsertSessionSchema,
  UpdateSessionSchema,
  EventRowSchema,
  InsertEventSchema,
  parseEventData,
  WorkItemRowSchema,
  InsertWorkItemSchema,
  UpdateWorkItemSchema,
  CheckpointRowSchema,
  InsertCheckpointSchema,
  MemoryEntryRowSchema,
  InsertMemoryEntrySchema,
  UpdateMemoryEntrySchema,
  parseJsonArray,
} from './schema.ts';

// ─── helpers ────────────────────────────────────────────────────────────────

function validProjectRow() {
  return {
    id: crypto.randomUUID(),
    name: 'My Project',
    path: '/home/user/project',
    description: 'A test project',
    created_at: '2026-04-18T00:00:00Z',
    updated_at: '2026-04-18T00:00:00Z',
  };
}

function validSessionRow() {
  return {
    id: crypto.randomUUID(),
    project_id: crypto.randomUUID(),
    workflow_id: 'wf-123',
    phase: 'execute',
    status: 'running' as const,
    started_at: '2026-04-18T00:00:00Z',
    completed_at: null,
    updated_at: '2026-04-18T00:00:00Z',
  };
}

function validEventRow() {
  return {
    id: crypto.randomUUID(),
    session_id: crypto.randomUUID(),
    type: 'tool.execute.before',
    data: '{"tool":"read_file"}',
    timestamp: '2026-04-18T00:00:00Z',
  };
}

function validWorkItemRow() {
  return {
    id: crypto.randomUUID(),
    project_id: crypto.randomUUID(),
    title: 'Fix login bug',
    description: 'Users cannot log in',
    type: 'bug' as const,
    status: 'todo' as const,
    priority: 'high' as const,
    tags: '["urgent"]',
    order_index: 0,
    created_at: '2026-04-18T00:00:00Z',
    updated_at: '2026-04-18T00:00:00Z',
  };
}

function validCheckpointRow() {
  return {
    id: crypto.randomUUID(),
    session_id: crypto.randomUUID(),
    data: '{"phase":"execute"}',
    created_at: '2026-04-18T00:00:00Z',
  };
}

function validMemoryEntryRow() {
  return {
    id: 1,
    type: 'observation' as const,
    title: 'Test observation',
    content: 'Some content here',
    importance: 7,
    concepts: '["test"]',
    source_files: '["src/test.ts"]',
    created_at: 1713400000,
    updated_at: 1713400000,
  };
}

// ─── projects ───────────────────────────────────────────────────────────────

describe('ProjectRowSchema', () => {
  it('parses a valid row', () => {
    const row = validProjectRow();
    const result = ProjectRowSchema.parse(row);
    expect(result.id).toBe(row.id);
    expect(result.name).toBe(row.name);
  });

  it('rejects missing required field', () => {
    const { name, ...rest } = validProjectRow();
    expect(() => ProjectRowSchema.parse(rest)).toThrow();
  });

  it('rejects invalid UUID', () => {
    const row = { ...validProjectRow(), id: 'not-a-uuid' };
    expect(() => ProjectRowSchema.parse(row)).toThrow();
  });

  it('rejects empty name', () => {
    const row = { ...validProjectRow(), name: '' };
    expect(() => ProjectRowSchema.parse(row)).toThrow();
  });
});

describe('InsertProjectSchema', () => {
  it('generates default UUID when id omitted', () => {
    const { id, ...rest } = validProjectRow();
    const result = InsertProjectSchema.parse(rest);
    expect(result.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('accepts explicit id', () => {
    const row = validProjectRow();
    const result = InsertProjectSchema.parse(row);
    expect(result.id).toBe(row.id);
  });
});

describe('UpdateProjectSchema', () => {
  it('accepts partial update with only id', () => {
    const result = UpdateProjectSchema.parse({ id: crypto.randomUUID(), name: 'New Name' });
    expect(result.name).toBe('New Name');
  });

  it('rejects update without id', () => {
    expect(() => UpdateProjectSchema.parse({ name: 'No ID' })).toThrow();
  });
});

// ─── sessions ───────────────────────────────────────────────────────────────

describe('SessionRowSchema', () => {
  it('parses a valid row', () => {
    const row = validSessionRow();
    const result = SessionRowSchema.parse(row);
    expect(result.status).toBe('running');
  });

  it('rejects invalid enum value', () => {
    const row = { ...validSessionRow(), status: 'invalid_status' };
    expect(() => SessionRowSchema.parse(row)).toThrow();
  });

  it('rejects missing project_id', () => {
    const { project_id, ...rest } = validSessionRow();
    expect(() => SessionRowSchema.parse(rest)).toThrow();
  });
});

describe('InsertSessionSchema', () => {
  it('generates default UUID when id omitted', () => {
    const { id, ...rest } = validSessionRow();
    const result = InsertSessionSchema.parse(rest);
    expect(result.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('accepts nullable workflow_id', () => {
    const row = { ...validSessionRow(), workflow_id: null };
    const result = InsertSessionSchema.parse(row);
    expect(result.workflow_id).toBeNull();
  });
});

describe('UpdateSessionSchema', () => {
  it('accepts partial update with id + one field', () => {
    const result = UpdateSessionSchema.parse({
      id: crypto.randomUUID(),
      status: 'paused',
    });
    expect(result.status).toBe('paused');
  });

  it('rejects update without id', () => {
    expect(() => UpdateSessionSchema.parse({ status: 'paused' })).toThrow();
  });
});

// ─── events ─────────────────────────────────────────────────────────────────

describe('EventRowSchema', () => {
  it('parses a valid row', () => {
    const row = validEventRow();
    const result = EventRowSchema.parse(row);
    expect(result.type).toBe('tool.execute.before');
  });

  it('rejects empty type', () => {
    const row = { ...validEventRow(), type: '' };
    expect(() => EventRowSchema.parse(row)).toThrow();
  });
});

describe('InsertEventSchema', () => {
  it('generates default UUID when id omitted', () => {
    const { id, ...rest } = validEventRow();
    const result = InsertEventSchema.parse(rest);
    expect(result.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
});

describe('parseEventData', () => {
  it('parses valid JSON string', () => {
    const result = parseEventData('{"tool":"read_file","path":"src/index.ts"}');
    expect(result).toEqual({ tool: 'read_file', path: 'src/index.ts' });
  });

  it('returns empty object for invalid JSON', () => {
    const result = parseEventData('not json');
    expect(result).toEqual({});
  });

  it('returns empty object for non-object JSON', () => {
    const result = parseEventData('"just a string"');
    expect(result).toEqual({});
  });
});

// ─── work_items ─────────────────────────────────────────────────────────────

describe('WorkItemRowSchema', () => {
  it('parses a valid row', () => {
    const row = validWorkItemRow();
    const result = WorkItemRowSchema.parse(row);
    expect(result.type).toBe('bug');
    expect(result.priority).toBe('high');
  });

  it('rejects invalid type enum', () => {
    const row = { ...validWorkItemRow(), type: 'story' };
    expect(() => WorkItemRowSchema.parse(row)).toThrow();
  });

  it('rejects invalid status enum', () => {
    const row = { ...validWorkItemRow(), status: 'blocked' };
    expect(() => WorkItemRowSchema.parse(row)).toThrow();
  });

  it('rejects invalid priority enum', () => {
    const row = { ...validWorkItemRow(), priority: 'urgent' };
    expect(() => WorkItemRowSchema.parse(row)).toThrow();
  });

  it('rejects empty title', () => {
    const row = { ...validWorkItemRow(), title: '' };
    expect(() => WorkItemRowSchema.parse(row)).toThrow();
  });
});

describe('InsertWorkItemSchema', () => {
  it('generates default UUID when id omitted', () => {
    const { id, ...rest } = validWorkItemRow();
    const result = InsertWorkItemSchema.parse(rest);
    expect(result.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('accepts minimal insert with only title', () => {
    const result = InsertWorkItemSchema.parse({
      project_id: crypto.randomUUID(),
      title: 'Minimal item',
    });
    expect(result.title).toBe('Minimal item');
  });
});

describe('UpdateWorkItemSchema', () => {
  it('accepts partial update with id + one field', () => {
    const result = UpdateWorkItemSchema.parse({
      id: crypto.randomUUID(),
      status: 'in_progress',
    });
    expect(result.status).toBe('in_progress');
  });

  it('rejects update without id', () => {
    expect(() => UpdateWorkItemSchema.parse({ status: 'done' })).toThrow();
  });
});

// ─── checkpoints ────────────────────────────────────────────────────────────

describe('CheckpointRowSchema', () => {
  it('parses a valid row', () => {
    const row = validCheckpointRow();
    const result = CheckpointRowSchema.parse(row);
    expect(result.data).toBe('{"phase":"execute"}');
  });

  it('rejects missing session_id', () => {
    const { session_id, ...rest } = validCheckpointRow();
    expect(() => CheckpointRowSchema.parse(rest)).toThrow();
  });
});

describe('InsertCheckpointSchema', () => {
  it('generates default UUID when id omitted', () => {
    const { id, ...rest } = validCheckpointRow();
    const result = InsertCheckpointSchema.parse(rest);
    expect(result.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
});

// ─── memory_entries ──────────────────────────────────────────────────────────

describe('MemoryEntryRowSchema', () => {
  it('parses a valid row', () => {
    const row = validMemoryEntryRow();
    const result = MemoryEntryRowSchema.parse(row);
    expect(result.type).toBe('observation');
    expect(result.importance).toBe(7);
  });

  it('rejects invalid type enum', () => {
    const row = { ...validMemoryEntryRow(), type: 'invalid' };
    expect(() => MemoryEntryRowSchema.parse(row)).toThrow();
  });

  it('rejects importance out of range', () => {
    const row = { ...validMemoryEntryRow(), importance: 0 };
    expect(() => MemoryEntryRowSchema.parse(row)).toThrow();
  });

  it('rejects importance above max', () => {
    const row = { ...validMemoryEntryRow(), importance: 11 };
    expect(() => MemoryEntryRowSchema.parse(row)).toThrow();
  });

  it('rejects empty title', () => {
    const row = { ...validMemoryEntryRow(), title: '' };
    expect(() => MemoryEntryRowSchema.parse(row)).toThrow();
  });
});

describe('InsertMemoryEntrySchema', () => {
  it('accepts insert without id (auto-increment)', () => {
    const { id, ...rest } = validMemoryEntryRow();
    const result = InsertMemoryEntrySchema.parse(rest);
    expect(result).not.toHaveProperty('id');
  });

  it('accepts minimal insert with title + content', () => {
    const result = InsertMemoryEntrySchema.parse({
      title: 'Minimal entry',
      content: 'Some content',
    });
    expect(result.title).toBe('Minimal entry');
  });
});

describe('UpdateMemoryEntrySchema', () => {
  it('accepts partial update with id + one field', () => {
    const result = UpdateMemoryEntrySchema.parse({
      id: 1,
      title: 'Updated title',
    });
    expect(result.title).toBe('Updated title');
  });

  it('rejects update without id', () => {
    expect(() => UpdateMemoryEntrySchema.parse({ title: 'No ID' })).toThrow();
  });
});

// ─── parseJsonArray ─────────────────────────────────────────────────────────

describe('parseJsonArray', () => {
  it('parses valid JSON array of strings', () => {
    const result = parseJsonArray('["a", "b", "c"]');
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('returns empty array for invalid JSON', () => {
    const result = parseJsonArray('not json');
    expect(result).toEqual([]);
  });

  it('returns empty array for non-array JSON', () => {
    const result = parseJsonArray('{"key":"value"}');
    expect(result).toEqual([]);
  });

  it('filters out non-string values', () => {
    const result = parseJsonArray('["valid", 123, null, "also-valid"]');
    expect(result).toEqual(['valid', 'also-valid']);
  });

  it('returns empty array for empty array', () => {
    const result = parseJsonArray('[]');
    expect(result).toEqual([]);
  });
});
