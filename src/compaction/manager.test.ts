import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DaemonContext } from '../daemon/context.ts';
import { Database } from '../db/database.ts';
import { HookRegistry } from '../hooks/registry.ts';
import { StateManager } from '../state/manager.ts';
import { CompactionManager } from './manager.ts';

interface CompactionFixture {
  tempDir: string;
  db: Database;
  state: StateManager;
  hooks: HookRegistry;
  manager: CompactionManager;
  sessionId: string;
}

function seedProjectAndSession(
  db: Database,
  projectId: string,
  projectPath: string,
  sessionId: string,
): void {
  db.db.run(
    'INSERT INTO projects (id, name, path, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [projectId, 'elefant', projectPath, null, new Date().toISOString(), new Date().toISOString()],
  );
  db.db.run(
    'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      sessionId,
      projectId,
      'workflow-1',
      'execute',
      'running',
      new Date().toISOString(),
      null,
      new Date().toISOString(),
    ],
  );
}

function createFixture(): CompactionFixture {
  const tempDir = mkdtempSync(join(tmpdir(), 'elefant-compaction-manager-'));
  mkdirSync(join(tempDir, '.goopspec', 'workflow-1'), { recursive: true });

  const db = new Database(join(tempDir, 'db.sqlite'));
  const projectId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  seedProjectAndSession(db, projectId, tempDir, sessionId);

  const state = new StateManager(tempDir, {
    id: projectId,
    name: 'elefant',
    path: tempDir,
  });

  const hooks = new HookRegistry();
  const context = {
    hooks,
    db,
    state,
    tools: {
      getAll: () => [{ name: 'read' }, { name: 'write' }],
    },
  } as unknown as DaemonContext;

  return {
    tempDir,
    db,
    state,
    hooks,
    manager: new CompactionManager(context),
    sessionId,
  };
}

describe('CompactionManager', () => {
  const fixtures: CompactionFixture[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.db.close();
      rmSync(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it('shouldCompact returns true when token count is above 70%', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    expect(fixture.manager.shouldCompact(140_001, 200_000)).toBe(true);
  });

  it('shouldCompact returns false when token count is below 70%', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    expect(fixture.manager.shouldCompact(139_999, 200_000)).toBe(false);
  });

  it('compact returns fewer messages and includes surviving blocks', async () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const messages = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message-${index}-${'x'.repeat(200)}`,
    }));

    const result = await fixture.manager.compact({
      messages,
      tokenCount: 180_000,
      contextWindow: 200_000,
      sessionId: fixture.sessionId,
      conversationId: 'conv-1',
    });

    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.blocks.some((block) => block.includes('Workflow State'))).toBe(true);
    expect(result.blocks.some((block) => block.includes('Available Tools'))).toBe(true);
  });

  it('compact uses session:compact hook summary override when provided', async () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    fixture.hooks.register('session:compact', () => ({
      summary: 'custom compacted summary',
    }));

    const result = await fixture.manager.compact({
      messages: [
        { role: 'user', content: 'alpha' },
        { role: 'assistant', content: 'beta' },
      ],
      tokenCount: 170_000,
      contextWindow: 200_000,
      sessionId: fixture.sessionId,
      conversationId: 'conv-override',
    });

    expect(result.summary).toBe('custom compacted summary');
  });

  it('compact records a compaction event in the database', async () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = await fixture.manager.compact({
      messages: [
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'two' },
        { role: 'user', content: 'three' },
        { role: 'assistant', content: 'four' },
      ],
      tokenCount: 150_000,
      contextWindow: 200_000,
      sessionId: fixture.sessionId,
      conversationId: 'conv-db',
    });

    const rows = fixture.db.db
      .query('SELECT type, data FROM events WHERE session_id = ? AND type = ?')
      .all(fixture.sessionId, 'compaction') as Array<{
      type: string;
      data: string;
    }>;

    expect(rows.length).toBe(1);
    expect(rows[0].type).toBe('compaction');

    const payload = JSON.parse(rows[0].data) as {
      tokenCountBefore: number;
      tokenCountAfter: number;
    };
    expect(payload.tokenCountBefore).toBe(150_000);
    expect(payload.tokenCountAfter).toBe(result.tokenCountAfter);
  });
});
