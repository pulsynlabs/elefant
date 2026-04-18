import { describe, it, expect, afterEach } from 'bun:test';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { Database } from './database.ts';
import {
  insertProject,
  getProjectById,
  getProjectByPath,
  listProjects,
  updateProject,
  deleteProject,
  insertSession,
  getSessionById,
  listSessionsByProject,
  updateSession,
  deleteSession,
  insertEvent,
  getEventById,
  listEventsBySession,
  listEventsByType,
  deleteEvent,
  insertWorkItem,
  getWorkItemById,
  listWorkItemsByProject,
  updateWorkItem,
  deleteWorkItem,
  insertCheckpoint,
  getCheckpointById,
  listCheckpointsBySession,
  deleteCheckpoint,
  insertMemoryEntry,
  getMemoryEntryById,
  listMemoryEntries,
  updateMemoryEntry,
  deleteMemoryEntry,
} from './repo/index.ts';

function createTestDb(): Database {
  const dir = join(tmpdir(), `elefant-test-${crypto.randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return new Database(join(dir, 'test.db'));
}

function cleanupDb(db: Database): void {
  const dbPath = (db.db as unknown as { filename: string }).filename;
  db.close();
  const dir = dbPath.replace('/test.db', '');
  rmSync(dir, { recursive: true, force: true });
}

// ─── Projects ────────────────────────────────────────────────────────────────

describe('projects repo', () => {
  let db: Database;

  afterEach(() => cleanupDb(db));

  it('inserts, gets, updates, lists, and deletes a project', () => {
    db = createTestDb();

    // Insert
    const inserted = insertProject(db, {
      id: crypto.randomUUID(),
      name: 'Test Project',
      path: '/tmp/test-project',
    });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    const project = inserted.data;
    expect(project.name).toBe('Test Project');
    expect(project.path).toBe('/tmp/test-project');
    expect(project.description).toBeNull();

    // Get by ID
    const byId = getProjectById(db, project.id);
    expect(byId.ok).toBe(true);
    if (!byId.ok) return;
    expect(byId.data.id).toBe(project.id);

    // Get by path
    const byPath = getProjectByPath(db, '/tmp/test-project');
    expect(byPath.ok).toBe(true);
    if (!byPath.ok) return;
    expect(byPath.data?.id).toBe(project.id);

    // Get by missing path returns null
    const missing = getProjectByPath(db, '/nonexistent');
    expect(missing.ok).toBe(true);
    if (!missing.ok) return;
    expect(missing.data).toBeNull();

    // Update
    const updated = updateProject(db, {
      id: project.id,
      name: 'Updated Project',
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.name).toBe('Updated Project');

    // List
    const listed = listProjects(db);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.data.length).toBe(1);
    expect(listed.data[0].name).toBe('Updated Project');

    // Delete
    const deleted = deleteProject(db, project.id);
    expect(deleted.ok).toBe(true);

    // Verify deleted
    const afterDelete = getProjectById(db, project.id);
    expect(afterDelete.ok).toBe(false);
    if (afterDelete.ok) return;
    expect(afterDelete.error.code).toBe('FILE_NOT_FOUND');
  });
});

// ─── Sessions ────────────────────────────────────────────────────────────────

describe('sessions repo', () => {
  let db: Database;
  let projectId: string;

  afterEach(() => cleanupDb(db));

  it('inserts, gets, updates, lists, and deletes a session', () => {
    db = createTestDb();
    projectId = crypto.randomUUID();
    insertProject(db, { id: projectId, name: 'Proj', path: '/tmp/proj' });

    // Insert
    const inserted = insertSession(db, {
      id: crypto.randomUUID(),
      project_id: projectId,
      status: 'running',
    });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    const session = inserted.data;
    expect(session.project_id).toBe(projectId);
    expect(session.status).toBe('running');
    expect(session.phase).toBe('idle');

    // Get by ID
    const byId = getSessionById(db, session.id);
    expect(byId.ok).toBe(true);
    if (!byId.ok) return;
    expect(byId.data.id).toBe(session.id);

    // Update
    const updated = updateSession(db, {
      id: session.id,
      status: 'completed',
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.status).toBe('completed');

    // List by project
    const listed = listSessionsByProject(db, projectId);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.data.length).toBe(1);

    // Delete
    const deleted = deleteSession(db, session.id);
    expect(deleted.ok).toBe(true);

    // Verify deleted
    const afterDelete = getSessionById(db, session.id);
    expect(afterDelete.ok).toBe(false);
    if (afterDelete.ok) return;
    expect(afterDelete.error.code).toBe('FILE_NOT_FOUND');
  });
});

// ─── Events ──────────────────────────────────────────────────────────────────

describe('events repo', () => {
  let db: Database;
  let sessionId: string;

  afterEach(() => cleanupDb(db));

  it('inserts, gets, lists by session, lists by type, and deletes an event', () => {
    db = createTestDb();
    const projectId = crypto.randomUUID();
    insertProject(db, { id: projectId, name: 'Proj', path: '/tmp/proj' });
    sessionId = crypto.randomUUID();
    insertSession(db, { id: sessionId, project_id: projectId, status: 'running' });

    // Insert
    const inserted = insertEvent(db, {
      id: crypto.randomUUID(),
      session_id: sessionId,
      type: 'tool_call',
      data: '{"tool": "bash"}',
    });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    const event = inserted.data;
    expect(event.session_id).toBe(sessionId);
    expect(event.type).toBe('tool_call');
    expect(event.data).toBe('{"tool": "bash"}');

    // Get by ID
    const byId = getEventById(db, event.id);
    expect(byId.ok).toBe(true);
    if (!byId.ok) return;
    expect(byId.data.id).toBe(event.id);

    // List by session
    const bySession = listEventsBySession(db, sessionId);
    expect(bySession.ok).toBe(true);
    if (!bySession.ok) return;
    expect(bySession.data.length).toBe(1);

    // List by type
    const byType = listEventsByType(db, sessionId, 'tool_call');
    expect(byType.ok).toBe(true);
    if (!byType.ok) return;
    expect(byType.data.length).toBe(1);

    // List by wrong type returns empty
    const wrongType = listEventsByType(db, sessionId, 'nonexistent');
    expect(wrongType.ok).toBe(true);
    if (!wrongType.ok) return;
    expect(wrongType.data.length).toBe(0);

    // Delete
    const deleted = deleteEvent(db, event.id);
    expect(deleted.ok).toBe(true);

    // Verify deleted
    const afterDelete = getEventById(db, event.id);
    expect(afterDelete.ok).toBe(false);
    if (afterDelete.ok) return;
    expect(afterDelete.error.code).toBe('FILE_NOT_FOUND');
  });
});

// ─── Work Items ──────────────────────────────────────────────────────────────

describe('work items repo', () => {
  let db: Database;
  let projectId: string;

  afterEach(() => cleanupDb(db));

  it('inserts, gets, updates, lists, and deletes a work item', () => {
    db = createTestDb();
    projectId = crypto.randomUUID();
    insertProject(db, { id: projectId, name: 'Proj', path: '/tmp/proj' });

    // Insert
    const inserted = insertWorkItem(db, {
      id: crypto.randomUUID(),
      project_id: projectId,
      title: 'Fix login bug',
      type: 'bug',
      status: 'todo',
      priority: 'high',
    });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    const item = inserted.data;
    expect(item.title).toBe('Fix login bug');
    expect(item.type).toBe('bug');
    expect(item.priority).toBe('high');

    // Get by ID
    const byId = getWorkItemById(db, item.id);
    expect(byId.ok).toBe(true);
    if (!byId.ok) return;
    expect(byId.data.id).toBe(item.id);

    // Update
    const updated = updateWorkItem(db, {
      id: item.id,
      status: 'in_progress',
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.status).toBe('in_progress');

    // List by project
    const listed = listWorkItemsByProject(db, projectId);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.data.length).toBe(1);

    // Delete
    const deleted = deleteWorkItem(db, item.id);
    expect(deleted.ok).toBe(true);

    // Verify deleted
    const afterDelete = getWorkItemById(db, item.id);
    expect(afterDelete.ok).toBe(false);
    if (afterDelete.ok) return;
    expect(afterDelete.error.code).toBe('FILE_NOT_FOUND');
  });
});

// ─── Checkpoints ─────────────────────────────────────────────────────────────

describe('checkpoints repo', () => {
  let db: Database;
  let sessionId: string;

  afterEach(() => cleanupDb(db));

  it('inserts, gets, lists, and deletes a checkpoint', () => {
    db = createTestDb();
    const projectId = crypto.randomUUID();
    insertProject(db, { id: projectId, name: 'Proj', path: '/tmp/proj' });
    sessionId = crypto.randomUUID();
    insertSession(db, { id: sessionId, project_id: projectId, status: 'running' });

    // Insert
    const inserted = insertCheckpoint(db, {
      id: crypto.randomUUID(),
      session_id: sessionId,
      data: '{"wave": 1}',
    });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    const checkpoint = inserted.data;
    expect(checkpoint.session_id).toBe(sessionId);
    expect(checkpoint.data).toBe('{"wave": 1}');

    // Get by ID
    const byId = getCheckpointById(db, checkpoint.id);
    expect(byId.ok).toBe(true);
    if (!byId.ok) return;
    expect(byId.data.id).toBe(checkpoint.id);

    // List by session
    const listed = listCheckpointsBySession(db, sessionId);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.data.length).toBe(1);

    // Delete
    const deleted = deleteCheckpoint(db, checkpoint.id);
    expect(deleted.ok).toBe(true);

    // Verify deleted
    const afterDelete = getCheckpointById(db, checkpoint.id);
    expect(afterDelete.ok).toBe(false);
    if (afterDelete.ok) return;
    expect(afterDelete.error.code).toBe('FILE_NOT_FOUND');
  });
});

// ─── Memory Entries ──────────────────────────────────────────────────────────

describe('memory entries repo', () => {
  let db: Database;

  afterEach(() => cleanupDb(db));

  it('inserts, gets, updates, lists, and deletes a memory entry', () => {
    db = createTestDb();

    // Insert
    const inserted = insertMemoryEntry(db, {
      type: 'observation',
      title: 'Test observation',
      content: 'Some content here',
      importance: 7,
      concepts: JSON.stringify(['test', 'memory']),
      source_files: JSON.stringify(['src/test.ts']),
    });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    const entry = inserted.data;
    expect(entry.type).toBe('observation');
    expect(entry.title).toBe('Test observation');
    expect(entry.importance).toBe(7);
    expect(typeof entry.id).toBe('number');

    // Get by ID
    const byId = getMemoryEntryById(db, entry.id);
    expect(byId.ok).toBe(true);
    if (!byId.ok) return;
    expect(byId.data.id).toBe(entry.id);

    // Update
    const updated = updateMemoryEntry(db, {
      id: entry.id,
      title: 'Updated title',
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.title).toBe('Updated title');

    // List all
    const listed = listMemoryEntries(db);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.data.length).toBe(1);

    // List by type
    const byType = listMemoryEntries(db, { type: 'observation' });
    expect(byType.ok).toBe(true);
    if (!byType.ok) return;
    expect(byType.data.length).toBe(1);

    // List by min importance (too high = empty)
    const highMin = listMemoryEntries(db, { minImportance: 9 });
    expect(highMin.ok).toBe(true);
    if (!highMin.ok) return;
    expect(highMin.data.length).toBe(0);

    // List by limit
    const limited = listMemoryEntries(db, { limit: 1 });
    expect(limited.ok).toBe(true);
    if (!limited.ok) return;
    expect(limited.data.length).toBe(1);

    // Delete
    const deleted = deleteMemoryEntry(db, entry.id);
    expect(deleted.ok).toBe(true);

    // Verify deleted
    const afterDelete = getMemoryEntryById(db, entry.id);
    expect(afterDelete.ok).toBe(false);
    if (afterDelete.ok) return;
    expect(afterDelete.error.code).toBe('FILE_NOT_FOUND');
  });
});

// ─── Validation Errors ───────────────────────────────────────────────────────

describe('validation errors', () => {
  let db: Database;

  afterEach(() => cleanupDb(db));

  it('returns VALIDATION_ERROR for invalid project input', () => {
    db = createTestDb();
    const result = insertProject(db, {
      id: crypto.randomUUID(),
      name: '',
      path: '/tmp/test',
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns VALIDATION_ERROR for invalid session input', () => {
    db = createTestDb();
    const result = insertSession(db, {
      id: crypto.randomUUID(),
      project_id: 'not-a-uuid',
      status: 'running',
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns VALIDATION_ERROR for invalid memory entry input', () => {
    db = createTestDb();
    const result = insertMemoryEntry(db, {
      type: 'observation',
      title: '',
      content: 'test',
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });
});
