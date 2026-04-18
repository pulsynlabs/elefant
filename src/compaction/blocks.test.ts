import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../db/database.ts';
import { insertEvent } from '../db/repo/events.ts';
import { createDefaultState } from '../state/schema.ts';
import {
  buildAdlBlock,
  buildStateBlock,
  buildToolInstructionsBlock,
} from './blocks.ts';

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

describe('compaction blocks', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const directory of tempDirs.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('buildStateBlock returns workflow state details', () => {
    const state = createDefaultState({
      id: crypto.randomUUID(),
      name: 'elefant',
      path: '/tmp/project',
    });

    const block = buildStateBlock(state);

    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain('Phase: idle');
    expect(block).toContain('Mode: standard');
  });

  it('buildAdlBlock returns empty string when no decisions exist', () => {
    const directory = mkdtempSync(join(tmpdir(), 'elefant-compaction-blocks-empty-'));
    tempDirs.push(directory);

    const db = new Database(join(directory, 'db.sqlite'));
    const block = buildAdlBlock(db);

    expect(block).toBe('');
    db.close();
  });

  it('buildAdlBlock returns entries for decision events', () => {
    const directory = mkdtempSync(join(tmpdir(), 'elefant-compaction-blocks-adl-'));
    tempDirs.push(directory);

    const db = new Database(join(directory, 'db.sqlite'));
    const projectId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    seedProjectAndSession(db, projectId, directory, sessionId);

    const inserted = insertEvent(db, {
      id: crypto.randomUUID(),
      session_id: sessionId,
      type: 'decision',
      data: JSON.stringify({
        description: 'Use WAL mode',
        action: 'Applied pragmas',
      }),
    });
    expect(inserted.ok).toBe(true);

    const block = buildAdlBlock(db);
    expect(block).toContain('Recent Decisions (ADL)');
    expect(block).toContain('Use WAL mode');
    expect(block).toContain('Applied pragmas');

    db.close();
  });

  it('buildToolInstructionsBlock returns empty string for empty tool list', () => {
    const block = buildToolInstructionsBlock([]);
    expect(block).toBe('');
  });

  it('buildToolInstructionsBlock includes registered tool names', () => {
    const block = buildToolInstructionsBlock(['read', 'write']);
    expect(block).toContain('read, write');
  });
});
