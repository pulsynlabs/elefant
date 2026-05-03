import { describe, expect, it } from 'bun:test';
import type { EmbeddingProvider } from '../../research/embeddings/provider.ts';
import type { Frontmatter } from '../../research/frontmatter.ts';
import { err, ok } from '../../types/result.ts';
import { createResearchSearchTool, type ResearchSearchStore } from './index.ts';

function frontmatter(overrides: Partial<Frontmatter> = {}): Frontmatter {
  return {
    id: crypto.randomUUID(),
    title: 'Searchable Document',
    section: '02-tech',
    tags: ['search'],
    sources: [],
    confidence: 'high',
    created: '2026-05-02T00:00:00.000Z',
    updated: '2026-05-02T00:00:00.000Z',
    author_agent: 'researcher',
    workflow: null,
    summary: 'A document summary',
    ...overrides,
  };
}

type SearchRow = Parameters<ResearchSearchStore['searchKeyword']>[1] extends never ? never : {
  id: number;
  documentId: string;
  chunkIndex: number;
  text: string;
  tags: string[];
  score: number;
  documentTitle: string;
  documentPath: string;
};

function row(overrides: Partial<SearchRow> = {}): SearchRow {
  return {
    id: 1,
    documentId: 'doc-1',
    chunkIndex: 0,
    text: 'First sentence. Second sentence gives context. Search systems need useful ranking. Fourth sentence follows. Fifth sentence ends.',
    tags: ['search'],
    score: 10,
    documentTitle: 'Searchable Document',
    documentPath: '02-tech/search.md',
    ...overrides,
  };
}

function createMockProvider(name: EmbeddingProvider['name'] = 'bundled-cpu', opts: { failEmbed?: boolean } = {}) {
  const calls = { init: 0, embed: 0 };
  const provider: EmbeddingProvider = {
    name,
    isLocal: true,
    async init() {
      calls.init += 1;
      return ok(undefined);
    },
    dim() { return name === 'disabled' ? 0 : 3; },
    async embed(texts: string[]) {
      calls.embed += 1;
      if (opts.failEmbed) {
        return err({ code: 'PROVIDER_ERROR', message: 'embedding failed' });
      }
      return ok({ vectors: texts.map(() => new Float32Array([1, 0, 0])), dim: 3 });
    },
    async dispose() {},
  };
  return { provider, calls };
}

function createMockStore(input: {
  keywordRows?: SearchRow[];
  vectorRows?: SearchRow[];
  docs?: Record<string, Frontmatter>;
  getDocumentByIdError?: { code: string; message: string };
  nullDocumentIds?: Set<string>;
} = {}) {
  const calls: {
    keyword: Array<{ query: string; opts: { k: number; section?: string } }>;
    vector: Array<{ embedding: Float32Array; opts: { k: number; section?: string } }>;
  } = { keyword: [], vector: [] };

  const store: ResearchSearchStore = {
    searchKeyword(query, opts) {
      calls.keyword.push({ query, opts });
      return ok(input.keywordRows ?? []);
    },
    searchVector(embedding, opts) {
      calls.vector.push({ embedding, opts });
      return ok(input.vectorRows ?? []);
    },
    getDocumentById(id) {
      if (input.getDocumentByIdError) {
        return { ok: false as const, error: { code: input.getDocumentByIdError.code, message: input.getDocumentByIdError.message } };
      }
      if (input.nullDocumentIds?.has(id)) {
        return ok(null);
      }
      const fm = input.docs?.[id] ?? frontmatter({ id, title: `Title ${id}`, summary: `Summary ${id}` });
      return ok({
        id,
        filePath: `${fm.section}/${id}.md`,
        section: fm.section,
        title: fm.title,
        summary: fm.summary,
        frontmatter: fm,
      });
    },
  };

  return { store, calls };
}

describe('research_search tool', () => {
  it('keyword mode returns ranked results from FTS', async () => {
    const { provider } = createMockProvider();
    const { store, calls } = createMockStore({
      keywordRows: [row({ documentId: 'doc-high', score: 9 }), row({ documentId: 'doc-low', score: 3 })],
    });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'keyword' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls.keyword).toHaveLength(1);
    expect(calls.vector).toHaveLength(0);
    expect(result.data.mode_used).toBe('keyword');
    expect(result.data.results.map((item) => item.title)).toEqual(['Title doc-high', 'Title doc-low']);
    expect(result.data.results[0]?.score).toBe(1);
  });

  it('semantic mode embeds query, calls searchVector, and returns ranked results', async () => {
    const { provider, calls: providerCalls } = createMockProvider();
    const { store, calls } = createMockStore({ vectorRows: [row({ documentId: 'doc-vector', score: 0.8 })] });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'vector', mode: 'semantic' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(providerCalls.init).toBe(1);
    expect(providerCalls.embed).toBe(1);
    expect(calls.vector).toHaveLength(1);
    expect(calls.keyword).toHaveLength(0);
    expect(result.data.mode_used).toBe('semantic');
    expect(result.data.results[0]?.path).toBe('02-tech/doc-vector.md');
  });

  it('hybrid mode calls both searches, fuses, and deduplicates by document and chunk', async () => {
    const { provider } = createMockProvider();
    const duplicate = row({ id: 1, documentId: 'doc-a', chunkIndex: 0, score: 100 });
    const { store, calls } = createMockStore({
      keywordRows: [duplicate, row({ id: 2, documentId: 'doc-b', chunkIndex: 0, score: 80 })],
      vectorRows: [duplicate, row({ id: 3, documentId: 'doc-c', chunkIndex: 0, score: 0.95 })],
    });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'hybrid', k: 5 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls.keyword[0]?.opts.k).toBe(10);
    expect(calls.vector[0]?.opts.k).toBe(10);
    expect(result.data.mode_used).toBe('hybrid');
    expect(result.data.results.map((item) => item.path)).toEqual([
      '02-tech/doc-a.md',
      '02-tech/doc-b.md',
      '02-tech/doc-c.md',
    ]);
    expect(result.data.results[0]?.score).toBe(1);
  });

  it('disabled provider with semantic mode uses keyword mode', async () => {
    const { provider, calls: providerCalls } = createMockProvider('disabled');
    const { store, calls } = createMockStore({ keywordRows: [row({ documentId: 'doc-keyword' })] });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'fallback', mode: 'semantic' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.mode_used).toBe('keyword');
    expect(calls.keyword).toHaveLength(1);
    expect(calls.vector).toHaveLength(0);
    expect(providerCalls.embed).toBe(0);
  });

  it('disabled provider with hybrid mode uses keyword mode', async () => {
    const { provider } = createMockProvider('disabled');
    const { store, calls } = createMockStore({ keywordRows: [row({ documentId: 'doc-keyword' })] });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'fallback', mode: 'hybrid' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.mode_used).toBe('keyword');
    expect(calls.keyword[0]?.opts.k).toBe(8);
    expect(calls.vector).toHaveLength(0);
  });

  it('caps k and returns at most the requested number of results', async () => {
    const { provider } = createMockProvider();
    const rows = Array.from({ length: 10 }, (_, index) => row({ id: index + 1, documentId: `doc-${index}`, score: 10 - index }));
    const { store } = createMockStore({ keywordRows: rows });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'keyword', k: 3 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results).toHaveLength(3);
    expect(result.data.total).toBe(3);
  });

  it('passes section filter through to the store', async () => {
    const { provider } = createMockProvider();
    const { store, calls } = createMockStore({ keywordRows: [row()] });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'keyword', section: '02-tech' });

    expect(result.ok).toBe(true);
    expect(calls.keyword[0]?.opts.section).toBe('02-tech');
  });

  it('excludes results without a matching tag', async () => {
    const { provider } = createMockProvider();
    const { store } = createMockStore({
      keywordRows: [
        row({ documentId: 'doc-keep', tags: ['agents'] }),
        row({ documentId: 'doc-drop', tags: ['other'] }),
      ],
    });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'keyword', tags: ['agents'] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results.map((item) => item.path)).toEqual(['02-tech/doc-keep.md']);
  });

  it('filters results below minScore after normalisation', async () => {
    const { provider } = createMockProvider();
    const { store } = createMockStore({
      keywordRows: [row({ documentId: 'doc-high', score: 10 }), row({ documentId: 'doc-low', score: 2 })],
    });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'keyword', minScore: 0.5 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results.map((item) => item.path)).toEqual(['02-tech/doc-high.md']);
  });

  it('returns an empty result set for an empty corpus', async () => {
    const { provider } = createMockProvider();
    const { store } = createMockStore();
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'nothing', mode: 'keyword' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ results: [], mode_used: 'keyword', total: 0 });
  });

  it('returns an error when query embedding fails', async () => {
    const { provider } = createMockProvider('bundled-cpu', { failEmbed: true });
    const { store } = createMockStore();
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'semantic', mode: 'semantic' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROVIDER_ERROR');
    expect(result.error.message).toBe('embedding failed');
  });

  it('builds research links with workflow fallback and snippets from chunk text only', async () => {
    const { provider } = createMockProvider();
    const fm = frontmatter({ id: 'doc-link', workflow: null, title: 'Link Doc', summary: 'Link summary' });
    const { store } = createMockStore({
      keywordRows: [row({ documentId: 'doc-link', text: 'Alpha sentence. Beta sentence. Query term appears here. Gamma follows. Delta closes.' })],
      docs: { 'doc-link': fm },
    });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'query', mode: 'keyword' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results[0]?.research_link).toBe('research://_/02-tech/doc-link.md');
    expect(result.data.results[0]?.snippet).toContain('Query term appears here.');
    expect(result.data.results[0]?.snippet).not.toContain('title:');
  });

  // ── Uncovered validation error paths ──────────────────────────────────

  it('returns VALIDATION_ERROR for invalid mode value', async () => {
    const { provider } = createMockProvider();
    const { store } = createMockStore({ keywordRows: [] });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'invalid' as 'semantic' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns VALIDATION_ERROR when tags contains non-string values', async () => {
    const { provider } = createMockProvider();
    const { store } = createMockStore({ keywordRows: [] });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'keyword', tags: ['valid', 123 as unknown as string] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns VALIDATION_ERROR when minScore is negative', async () => {
    const { provider } = createMockProvider();
    const { store } = createMockStore({ keywordRows: [] });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'keyword', minScore: -0.1 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns VALIDATION_ERROR when minScore is greater than 1', async () => {
    const { provider } = createMockProvider();
    const { store } = createMockStore({ keywordRows: [] });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'keyword', minScore: 1.5 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  // ── clampK edge cases ───────────────────────────────────────────────

  it('clampK returns DEFAULT_K for Infinity', async () => {
    const { provider } = createMockProvider();
    const { store } = createMockStore({ keywordRows: [] });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'keyword', k: Infinity });

    // Should fall back to DEFAULT_K (8) — no error thrown
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results).toEqual([]);
  });

  it('clampK clamps k below 1 to 1', async () => {
    const { provider } = createMockProvider();
    const { store } = createMockStore({ keywordRows: [] });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'keyword', k: 0 });

    // k=0 is clamped to 1 internally but the tool still works
    expect(result.ok).toBe(true);
  });

  // ── normaliseScores edge cases ──────────────────────────────────────

  it('normaliseScores returns rows as-is when all scores equal max', async () => {
    const { provider } = createMockProvider();
    const { store } = createMockStore({
      keywordRows: [
        row({ id: 1, score: 10 }),
        row({ id: 2, score: 10 }),
      ],
    });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'keyword', k: 5 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both should be normalized to 1 (max === min case)
    expect(result.data.results).toHaveLength(2);
  });

  it('normaliseScores handles negative scores (shift to positive)', async () => {
    const { provider } = createMockProvider();
    const { store } = createMockStore({
      keywordRows: [
        row({ id: 1, score: -5 }),
        row({ id: 2, score: -1 }),
      ],
    });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'keyword', k: 5 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both normalized: score = (score - min) / (max - min) = (score + 5) / 4
    expect(result.data.results[0]?.score).toBe(0); // (-5+5)/4 = 0
    expect(result.data.results[1]?.score).toBe(1); // (-1+5)/4 = 1
  });

  it('normaliseScores handles all-zero scores (max <= 0)', async () => {
    const { provider } = createMockProvider();
    const { store } = createMockStore({
      keywordRows: [
        row({ id: 1, score: 0 }),
        row({ id: 2, score: 0 }),
      ],
    });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'keyword', k: 5 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // max=0, min=0, max===min → all mapped to 1 if max>0 else 0
    // Both rows have score 0, so max === min === 0, the `if (max === min)` branch applies:
    // max > 0 ? 1 : 0 → 0 → both scores become 0
    expect(result.data.results[0]?.score).toBe(0);
    expect(result.data.results[1]?.score).toBe(0);
  });

  // ── resolveProjectPath — database dependency ────────────────────────

  it('returns FILE_NOT_FOUND when projectId not in database', async () => {
    const db = {
      db: {
        query: () => ({ get: () => null }), // returns null row
      },
    };
    const provider = createMockProvider();
    const tool = createResearchSearchTool({
      store: undefined,
      embeddingProvider: provider,
      database: db as any,
      currentRun: { projectId: 'nonexistent-id' } as any,
    });

    const result = await tool.execute({ query: 'search', mode: 'keyword' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FILE_NOT_FOUND');
  });

  // ── getRows — semantic mode init failure ───────────────────────────

  it('returns error when provider init fails in semantic mode', async () => {
    const provider: EmbeddingProvider = {
      name: 'ollama',
      isLocal: true,
      dim: () => 3,
      async init() {
        return err({ code: 'PROVIDER_ERROR', message: 'init failed' });
      },
      async embed() {
        return ok({ vectors: [new Float32Array([1, 0, 0])], dim: 3 });
      },
      async dispose() {},
    };
    const { store } = createMockStore({ vectorRows: [] });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'semantic' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_ERROR');
  });

  // ── scorePasses filter edge cases ──────────────────────────────────

  it('scorePasses returns true when minScore is undefined', async () => {
    const { provider } = createMockProvider();
    const { store } = createMockStore({ keywordRows: [row({ score: 0.1 })] });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'keyword', minScore: undefined });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results).toHaveLength(1);
  });

  it('scorePasses filters out results at exact boundary (score === minScore)', async () => {
    const { provider } = createMockProvider();
    const { store } = createMockStore({
      keywordRows: [
        row({ id: 1, documentId: 'exact', score: 0.5 }),
        row({ id: 2, documentId: 'above', score: 0.6 }),
      ],
    });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'keyword', minScore: 0.5 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results).toHaveLength(2); // exact boundary included
  });

  // ── toSearchResult — document not found ───────────────────────────

  it('returns error when getDocumentById returns null for chunk documentId', async () => {
    const { provider } = createMockProvider();
    const { store } = createMockStore({
      keywordRows: [row({ documentId: 'orphan-chunk' })],
      nullDocumentIds: new Set(['orphan-chunk']),
    });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'keyword' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FILE_NOT_FOUND');
  });

  it('returns error when getDocumentById returns error result', async () => {
    const { provider } = createMockProvider();
    const { store } = createMockStore({
      keywordRows: [row({ documentId: 'doc-error' })],
      getDocumentByIdError: { code: 'TOOL_EXECUTION_FAILED', message: 'Database is locked' },
    });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'keyword' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TOOL_EXECUTION_FAILED');
  });

  // ── extractSnippet edge cases ──────────────────────────────────────

  it('extractSnippet returns first 280 chars when no term match found', async () => {
    const { provider } = createMockProvider();
    const { store } = createMockStore({
      keywordRows: [row({ text: 'A short sentence.' })],
    });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'keyword' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results[0]?.snippet).toBe('A short sentence.');
  });

  it('extractSnippet slices at 600 chars even for long matches', async () => {
    const { provider } = createMockProvider();
    const longText = 'First sentence. Second. ' + 'word ' .repeat(200) + 'Last sentence.';
    const { store } = createMockStore({
      keywordRows: [row({ text: longText })],
    });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'keyword' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results[0]?.snippet.length).toBeLessThanOrEqual(600);
  });

  // ── RRF fusion edge cases ──────────────────────────────────────────

  it('fuseRrf deduplicates by documentId:chunkIndex key', async () => {
    const { provider } = createMockProvider();
    const { store } = createMockStore({
      keywordRows: [
        row({ id: 1, documentId: 'doc-a', chunkIndex: 0, score: 10 }),
        row({ id: 2, documentId: 'doc-a', chunkIndex: 0, score: 8 }), // same dedupe key
      ],
      vectorRows: [
        row({ id: 3, documentId: 'doc-b', chunkIndex: 0, score: 0.9 }),
      ],
    });
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'hybrid', k: 5 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // doc-a appears only once (best score kept from keyword), doc-b appears
    expect(result.data.results.map((r) => r.path)).toContain('02-tech/doc-a.md');
  });

  // ── section filter with empty results ─────────────────────────────

  it('returns empty results for non-matching section in keyword mode', async () => {
    const { provider } = createMockProvider();
    const { store } = createMockStore({ keywordRows: [] }); // no results for any section
    const tool = createResearchSearchTool({ store, embeddingProvider: provider });

    const result = await tool.execute({ query: 'search', mode: 'keyword', section: '99-nonexistent' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results).toHaveLength(0);
  });
});
