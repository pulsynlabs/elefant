import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Elysia } from 'elysia';

import { Database } from '../db/database.ts';
import { insertProject } from '../db/repo/projects.ts';
import { researchBaseDir } from '../project/paths.ts';
import { ProgressEmitter } from '../research/progress.ts';
import type { SearchResult } from '../tools/research_search/index.ts';
import { mountResearchRoutes } from './routes-research.ts';
import { RESEARCH_WS_EVENT_TYPES, isRegisteredWsEventType } from './routes-ws.ts';

const frontmatter = `---
id: 11111111-1111-4111-8111-111111111111
title: Research Routing Notes
section: 02-tech
tags:
  - routes
  - research
sources:
  - https://example.com
confidence: high
created: 2026-05-03T00:00:00.000Z
updated: 2026-05-03T01:00:00.000Z
author_agent: researcher
workflow: research-base-system
summary: Notes about research route wiring.
---
# Routing

This **document** verifies *markdown* rendering and \`inline code\`.

<script>alert('xss')</script>

| Key | Value |
| --- | --- |
| route | /v1/research |
`;

interface TestAppOptions {
  searchResult?: SearchResult[];
  openResult?: { editor: string; launched: boolean };
}

describe('mountResearchRoutes', () => {
  let db: Database;
  let app: Elysia;
  let tempRoot: string;
  let projectPath: string;
  let projectId: string;
  let searchCalls: unknown[];
  let openCalls: string[];
  let reindexCalls: number;

  async function createResearchFile(): Promise<void> {
    await mkdir(join(researchBaseDir(projectPath), '02-tech'), { recursive: true });
    await writeFile(join(researchBaseDir(projectPath), '02-tech', 'routing.md'), frontmatter);
    await writeFile(join(researchBaseDir(projectPath), '02-tech', 'README.md'), '# Ignore me');
  }

  function createApp(options: TestAppOptions = {}): Elysia {
    searchCalls = [];
    openCalls = [];
    reindexCalls = 0;
    const progress = new ProgressEmitter();
    const result = options.searchResult ?? [{
      path: '02-tech/routing.md',
      section: '02-tech',
      title: 'Research Routing Notes',
      summary: 'Notes about research route wiring.',
      score: 0.92,
      snippet: 'research route wiring',
      frontmatter: {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Research Routing Notes',
        section: '02-tech',
        tags: ['routes'],
        sources: [],
        confidence: 'high',
        created: '2026-05-03T00:00:00.000Z',
        updated: '2026-05-03T01:00:00.000Z',
        author_agent: 'researcher',
        workflow: 'research-base-system',
        summary: 'Notes about research route wiring.',
      },
      research_link: 'research://research-base-system/02-tech/routing.md',
    }];

    const testApp = new Elysia();
    mountResearchRoutes(testApp, db, {
      search: async (_ctx, input) => {
        searchCalls.push(input);
        return result;
      },
      getStatus: async (ctx) => ({
        projectId: ctx.projectId,
        provider: 'disabled',
        providerIsLocal: true,
        embeddingDim: 0,
        vectorEnabled: false,
        recommendedTier: 'bundled-cpu',
        hardware: null,
        totalDocs: 1,
        totalChunks: 2,
        lastIndexedAt: '2026-05-03T01:00:00.000Z',
        driftCount: 0,
        diskSizeBytes: 1234,
        indexExists: true,
      }),
      createIndexer: () => ({
        progress,
        async bulkIndex() {
          reindexCalls += 1;
          progress.emit({ projectId, phase: 'done', current: 1, total: 1 });
          return { ok: true, data: { indexed: 1, skipped: 0, errors: [] } };
        },
      }),
      progressEmitter: () => progress,
      launchEditor: async (absolutePath) => {
        openCalls.push(absolutePath);
        return options.openResult ?? { editor: 'mock-editor', launched: true };
      },
    });
    return testApp;
  }

  beforeEach(async () => {
    db = new Database(':memory:');
    tempRoot = await mkdtemp(join(tmpdir(), 'elefant-research-route-'));
    projectPath = join(tempRoot, 'project');
    projectId = crypto.randomUUID();
    await mkdir(projectPath, { recursive: true });
    const inserted = insertProject(db, { id: projectId, name: 'Research Project', path: projectPath });
    expect(inserted.ok).toBe(true);
    await createResearchFile();
    app = createApp();
  });

  afterEach(async () => {
    db.close();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('GET /v1/research/tree returns sections and skips index files', async () => {
    const response = await app.handle(new Request(`http://localhost/v1/research/tree?projectId=${projectId}`));
    const body = (await response.json()) as { sections: { name: string; files: { path: string; title: string }[] }[]; lastRefreshed: string };

    expect(response.status).toBe(200);
    expect(body.lastRefreshed).toBeString();
    expect(body.sections.map((section) => section.name)).toEqual(['02-tech']);
    expect(body.sections[0].files).toHaveLength(1);
    expect(body.sections[0].files[0]).toMatchObject({ path: '02-tech/routing.md', title: 'Research Routing Notes' });
  });

  it('GET /v1/research/tree returns 404 for an unknown project', async () => {
    const response = await app.handle(new Request('http://localhost/v1/research/tree?projectId=missing'));
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(404);
    expect(body.code).toBe('FILE_NOT_FOUND');
  });

  it('GET /v1/research/file returns html, raw body, frontmatter, and research link', async () => {
    const response = await app.handle(new Request(`http://localhost/v1/research/file?projectId=${projectId}&path=02-tech/routing.md`));
    const body = (await response.json()) as { html: string; rawBody: string; frontmatter: { title: string }; research_link: string };

    expect(response.status).toBe(200);
    expect(body.frontmatter.title).toBe('Research Routing Notes');
    expect(body.rawBody).toContain('# Routing');
    expect(body.html).toContain('<h1>Routing</h1>');
    expect(body.html).toContain('<strong>document</strong>');
    expect(body.html).not.toContain('<script>');
    expect(body.research_link).toBe('research://research-base-system/02-tech/routing.md');
  });

  it('GET /v1/research/file meta=true skips html render and returns raw body', async () => {
    const response = await app.handle(new Request(`http://localhost/v1/research/file?projectId=${projectId}&path=02-tech/routing.md&meta=true`));
    const body = (await response.json()) as { html: string; rawBody: string };

    expect(response.status).toBe(200);
    expect(body.html).toBe('');
    expect(body.rawBody).toContain('markdown');
  });

  it('GET /v1/research/file rejects traversal paths with a validation error', async () => {
    const response = await app.handle(new Request(`http://localhost/v1/research/file?projectId=${projectId}&path=${encodeURIComponent('../../etc/passwd')}`));
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe('PERMISSION_DENIED');
  });

  it('POST /v1/research/search delegates and returns search results', async () => {
    const response = await app.handle(new Request('http://localhost/v1/research/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, query: 'routing', k: 3, section: '02-tech', tags: ['routes'], mode: 'keyword' }),
    }));
    const body = (await response.json()) as SearchResult[];

    expect(response.status).toBe(200);
    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0]).toMatchObject({ projectId, query: 'routing', k: 3 });
    expect(body).toHaveLength(1);
    expect(body[0].title).toBe('Research Routing Notes');
  });

  it('GET /v1/research/status returns status fields', async () => {
    const response = await app.handle(new Request(`http://localhost/v1/research/status?projectId=${projectId}`));
    const body = (await response.json()) as { provider: string; totalDocs: number; totalChunks: number; diskSizeBytes: number };

    expect(response.status).toBe(200);
    expect(body.provider).toBe('disabled');
    expect(body.totalDocs).toBe(1);
    expect(body.totalChunks).toBe(2);
    expect(body.diskSizeBytes).toBe(1234);
  });

  it('POST /v1/research/reindex starts indexing in the background', async () => {
    const response = await app.handle(new Request('http://localhost/v1/research/reindex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    }));
    const body = (await response.json()) as { started: boolean };

    expect(response.status).toBe(200);
    expect(body).toEqual({ started: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reindexCalls).toBe(1);
  });

  it('GET /v1/research/index/progress returns an SSE stream', async () => {
    const response = await app.handle(new Request(`http://localhost/v1/research/index/progress?projectId=${projectId}`));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    await response.body?.cancel();
  });

  it('POST /v1/research/open-in-editor validates path and launches editor', async () => {
    const response = await app.handle(new Request('http://localhost/v1/research/open-in-editor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, path: '02-tech/routing.md' }),
    }));
    const body = (await response.json()) as { launched: boolean; editor: string };

    expect(response.status).toBe(200);
    expect(body).toEqual({ launched: true, editor: 'mock-editor' });
    expect(openCalls).toHaveLength(1);
    expect(openCalls[0]).toEndWith(join('.elefant', 'markdown-db', '02-tech', 'routing.md'));
  });

  it('requires valid project membership on write-like research endpoints', async () => {
    const response = await app.handle(new Request('http://localhost/v1/research/open-in-editor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'wrong-project', path: '02-tech/routing.md' }),
    }));
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(404);
    expect(body.code).toBe('FILE_NOT_FOUND');
  });

  it('registers research event types for the WebSocket event channel', () => {
    expect(RESEARCH_WS_EVENT_TYPES).toEqual([
      'research:indexed',
      'research:provider-changed',
      'research:reindex-progress',
    ]);
    expect(isRegisteredWsEventType('research:indexed')).toBe(true);
    expect(isRegisteredWsEventType('chat:message')).toBe(false);
  });
});
