import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DaemonContext } from '../daemon/context.ts';
import type { HookContextMap } from '../hooks/types.ts';
import { Database } from '../db/database.ts';
import { HookRegistry } from '../hooks/registry.ts';
import { StateManager } from '../state/manager.ts';
import type { Message } from '../types/providers.ts';
import { CompactionManager } from './manager.ts';

interface CompactionFixture {
  tempDir: string;
  db: Database;
  state: StateManager;
  hooks: HookRegistry;
  manager: CompactionManager;
  config?: TestConfig;
  sessionId: string;
}

interface TestConfig {
  compactionThreshold?: number;
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

function createFixture(options: { config?: TestConfig | null } = {}): CompactionFixture {
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
  const config = options.config === undefined ? {} : options.config;
  const context = {
    ...(config === null ? {} : { config }),
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
    config: config ?? undefined,
    manager: new CompactionManager(context),
    sessionId,
  };
}

function createMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message-${index}-${'x'.repeat(200)}`,
  }));
}

describe('CompactionManager', () => {
  const fixtures: CompactionFixture[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.db.close();
      rmSync(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it('shouldCompact returns true when token count is above the default threshold', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    expect(fixture.manager.shouldCompact(160_001, 200_000)).toBe(true);
  });

  it('shouldCompact returns false when token count is below the default threshold', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    expect(fixture.manager.shouldCompact(159_999, 200_000)).toBe(false);
  });

  it('shouldCompact reads the configured threshold on every call', () => {
    const config = { compactionThreshold: 0.5 };
    const fixture = createFixture({ config });
    fixtures.push(fixture);

    expect(fixture.manager.shouldCompact(5001, 10000)).toBe(true);

    config.compactionThreshold = 0.9;

    expect(fixture.manager.shouldCompact(5001, 10000)).toBe(false);
  });

  it('shouldCompact falls back to 80% when config is unavailable', () => {
    const fixture = createFixture({ config: null });
    fixtures.push(fixture);

    expect(fixture.manager.shouldCompact(8001, 10000)).toBe(true);
    expect(fixture.manager.shouldCompact(7999, 10000)).toBe(false);
  });

  it('compact returns fewer messages and includes surviving blocks', async () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const messages = createMessages(20);

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
    expect(result.didCompact).toBe(true);
  });

  it('compact uses checkpoint handoff format when no hook provides a summary', async () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = await fixture.manager.compact({
      messages: createMessages(12),
      tokenCount: 180_000,
      contextWindow: 200_000,
      sessionId: fixture.sessionId,
      conversationId: 'conv-checkpoint-format',
    });

    const summaryMessage = result.messages[0];

    expect(typeof summaryMessage?.content).toBe('string');
    expect(summaryMessage?.content).toContain('[Context Checkpoint');
    expect(summaryMessage?.content).toContain('Immediate next actions');
  });

  it('compact references a prior compaction summary retained in recent messages', async () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const priorCompactionSummary: Message = {
      role: 'user',
      content: '[Context Checkpoint — 2026-05-02T00:00:00.000Z]\n\nPrevious work summary.',
    };
    const messages: Message[] = [
      ...createMessages(7),
      priorCompactionSummary,
      { role: 'assistant', content: 'recent assistant message' },
      { role: 'user', content: 'recent user message' },
    ];

    const result = await fixture.manager.compact({
      messages,
      tokenCount: 180_000,
      contextWindow: 200_000,
      sessionId: fixture.sessionId,
      conversationId: 'conv-iterative-summary',
    });

    const summaryMessage = result.messages[0];

    expect(summaryMessage?.content).toContain('<previous-summary>');
    expect(summaryMessage?.content).toContain(priorCompactionSummary.content);
  });

  it('compact skips and returns original messages when transcript ends mid-tool-call', async () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const messages = [
      { role: 'user', content: 'Inspect the repo' },
      {
        role: 'assistant',
        content: 'Calling a tool',
        toolCalls: [{ id: 'call-1', name: 'read', arguments: { file: 'README.md' } }],
      },
    ] satisfies Message[];

    const postCompactEvents: HookContextMap['session:post_compact'][] = [];
    fixture.hooks.register('session:post_compact', (context) => {
      postCompactEvents.push(context);
    });

    const result = await fixture.manager.compact({
      messages,
      tokenCount: 180_000,
      contextWindow: 200_000,
      sessionId: fixture.sessionId,
      conversationId: 'conv-pending-tool-call',
    });

    expect(result.messages).toBe(messages);
    expect(result.messages.length).toBe(messages.length);
    expect(result.summary).toContain('Compaction skipped');
    expect(result.didCompact).toBe(false);
    expect(result.skipReason).toBe('pending_tool_call');
    expect(postCompactEvents).toHaveLength(1);
    expect(postCompactEvents[0]!.messagesBefore.length).toBe(messages.length);
    expect(postCompactEvents[0]!.messagesAfter.length).toBe(messages.length);
    expect(postCompactEvents[0]!.didCompact).toBe(false);
    expect(postCompactEvents[0]!.skipReason).toBe('pending_tool_call');
  });

  it('compact does not skip when a tool call has a paired tool result', async () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const messages: Message[] = [
      { role: 'user', content: 'Inspect the repo' },
      {
        role: 'assistant',
        content: 'Calling a tool',
        toolCalls: [{ id: 'call-1', name: 'read', arguments: { file: 'README.md' } }],
      },
      { role: 'tool', content: 'README contents', toolCallId: 'call-1' },
      ...createMessages(17),
    ];

    const result = await fixture.manager.compact({
      messages,
      tokenCount: 180_000,
      contextWindow: 200_000,
      sessionId: fixture.sessionId,
      conversationId: 'conv-paired-tool-call',
    });

    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.didCompact).toBe(true);
    expect(result.summary).not.toContain('Compaction skipped');
  });

  it('emits session:pre_compact before session:compact', async () => {
    const fixture = createFixture();
    fixtures.push(fixture);
    const events: string[] = [];

    fixture.hooks.register('session:pre_compact', () => {
      events.push('session:pre_compact');
    });
    fixture.hooks.register('session:compact', () => {
      events.push('session:compact');
    });

    await fixture.manager.compact({
      messages: createMessages(12),
      tokenCount: 180_000,
      contextWindow: 200_000,
      sessionId: fixture.sessionId,
      conversationId: 'conv-order',
    });

    expect(events).toEqual(['session:pre_compact', 'session:compact']);
  });

  it('emits session:post_compact after successful compaction', async () => {
    const fixture = createFixture();
    fixtures.push(fixture);
    const messages = createMessages(12);
    const postCompactEvents: HookContextMap['session:post_compact'][] = [];

    fixture.hooks.register('session:post_compact', (context) => {
      postCompactEvents.push(context);
    });

    const result = await fixture.manager.compact({
      messages,
      tokenCount: 180_000,
      contextWindow: 200_000,
      sessionId: fixture.sessionId,
      conversationId: 'conv-post-success',
    });

    expect(postCompactEvents).toHaveLength(1);
    expect(postCompactEvents[0]!.didCompact).toBe(true);
    expect(postCompactEvents[0]!.messagesBefore.length).toBe(messages.length);
    expect(postCompactEvents[0]!.messagesAfter.length).toBe(result.messages.length);
    expect(postCompactEvents[0]!.tokenCountBefore).toBe(180_000);
    expect(postCompactEvents[0]!.tokenCountAfter).toBe(result.tokenCountAfter);
    expect(postCompactEvents[0]!.summary).toBe(result.summary);
  });

  it('pre_compact cancel skips session:compact and emits post_compact skip', async () => {
    const fixture = createFixture();
    fixtures.push(fixture);
    const events: string[] = [];
    const messages = createMessages(12);
    const postCompactEvents: HookContextMap['session:post_compact'][] = [];

    fixture.hooks.register('session:pre_compact', () => {
      events.push('session:pre_compact');
      return { cancel: true };
    });
    fixture.hooks.register('session:compact', () => {
      events.push('session:compact');
    });
    fixture.hooks.register('session:post_compact', (context) => {
      events.push('session:post_compact');
      postCompactEvents.push(context);
    });

    const result = await fixture.manager.compact({
      messages,
      tokenCount: 180_000,
      contextWindow: 200_000,
      sessionId: fixture.sessionId,
      conversationId: 'conv-pre-cancel',
    });

    expect(events).toEqual(['session:pre_compact', 'session:post_compact']);
    expect(result.messages).toBe(messages);
    expect(result.summary).toContain('Compaction skipped');
    expect(result.didCompact).toBe(false);
    expect(result.skipReason).toBe('hook_cancelled');
    expect(postCompactEvents).toHaveLength(1);
    expect(postCompactEvents[0]!.didCompact).toBe(false);
    expect(postCompactEvents[0]!.skipReason).toBe('hook_cancelled');
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
