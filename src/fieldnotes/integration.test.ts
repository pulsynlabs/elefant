import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fieldNotesDir } from '../project/paths.ts';
import { createEmbeddingProvider, type EmbeddingProvider } from './embeddings/provider.ts';
import { FieldNotesStore } from './store.ts';
import { IndexerService } from './indexer.ts';
import { switchProvider } from './provider-switch.ts';
import { getFieldNotesStatus } from './status.ts';
import { createFieldNotesWriteTool } from '../tools/field_notes_write/index.ts';
import { createFieldNotesSearchTool } from '../tools/field_notes_search/index.ts';
import { FIELD_NOTES_SECTIONS } from '../project/paths.ts';

/** Minimal context object used throughout the test. */
const mockCtx = { agentName: 'researcher', projectPath: '', projectId: 'test-project' };

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'elefant-rbs-integration-'));
}

function cleanup(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

function ensureFieldNotesDirs(projectPath: string): void {
  for (const section of FIELD_NOTES_SECTIONS) {
    const dir = join(fieldNotesDir(projectPath), section);
    const { mkdirSync } = require('node:fs') as typeof import('node:fs');
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Attempt to create and init a 'bundled-cpu' provider.
 * Falls back to 'disabled' if init fails (e.g. model not cached in CI).
 * Returns which path was taken so tests can assert accordingly.
 */
async function resolveProvider(): Promise<{ provider: EmbeddingProvider; mode: 'bundled-cpu' | 'disabled' }> {
  const cpuResult = createEmbeddingProvider({ name: 'bundled-cpu' as const });
  if (cpuResult.ok) {
    const initResult = await cpuResult.data.init();
    if (initResult.ok) {
      return { provider: cpuResult.data, mode: 'bundled-cpu' };
    }
  }
  const disabledResult = createEmbeddingProvider({ name: 'disabled' as const });
  if (!disabledResult.ok) throw new Error('Failed to create disabled provider: ' + disabledResult.error.message);
  return { provider: disabledResult.data, mode: 'disabled' };
}

/**
 * Resolve the secondary provider used for the degradation test.
 * Always returns 'disabled' since that is the target of the switch.
 */
function resolveSecondaryProvider(): EmbeddingProvider {
  const result = createEmbeddingProvider({ name: 'disabled' as const });
  if (!result.ok) throw new Error('Failed to create disabled provider: ' + result.error.message);
  return result.data;
}

describe('Research Base integration', () => {
  let projectPath: string;
  let store: FieldNotesStore;
  let provider: EmbeddingProvider;
  let providerMode: 'bundled-cpu' | 'disabled';
  let indexer: IndexerService;

  beforeAll(async () => {
    projectPath = tempProject();
    ensureFieldNotesDirs(projectPath);

    const storeResult = FieldNotesStore.open(projectPath);
    if (!storeResult.ok) throw new Error('Failed to open store: ' + storeResult.error.message);
    store = storeResult.data;

    const resolved = await resolveProvider();
    provider = resolved.provider;
    providerMode = resolved.mode;
    console.log(`[integration] Provider: ${providerMode} (bundled-cpu fallback: ${provider.name === 'disabled' ? 'yes' : 'no'})`);

    indexer = new IndexerService({ projectPath, projectId: 'test-project', provider });
  });

  afterAll(() => {
    store?.close();
    cleanup(projectPath);
  });

  // ── Test 1: write files ─────────────────────────────────────────────────────

  test('writes 3 research files with distinct topics', async () => {
    const writeTool = createFieldNotesWriteTool({ projectPath, indexerService: indexer });

    const results = await Promise.all([
      writeTool.execute({
        path: '02-tech/sqlite-vec.md',
        title: 'sqlite-vec: Vector Search Extension for SQLite',
        summary: 'sqlite-vec is a SQLite extension that enables vector similarity search using a page-encoded storage format.',
        section: '02-tech',
        body: 'sqlite-vec is a vector search extension for SQLite that stores embeddings in a page-encoded format. It supports HNSW indexing for approximate nearest neighbour search. The extension loads as a SQLite run-time extension and exposes a SQL API for inserting, querying, and managing vector data. Chunked vectors are stored in virtual tables backed by in-memory or memory-mapped pages. The index supports filtering by metadata columns and can be combined with FTS5 for full-text search.',
        tags: ['sqlite', 'vector-db', 'embeddings'],
        confidence: 'high',
        workflow: 'field-notes-system',
      }, mockCtx),

      writeTool.execute({
        path: '02-tech/transformers-js.md',
        title: 'Transformers.js: ONNX-powered ML in the Browser',
        summary: 'Transformers.js is a JavaScript library that runs ONNX models directly in the browser using WebAssembly and Web Workers.',
        section: '02-tech',
        body: 'Transformers.js is an open-source library that brings transformer models to the browser and Node.js using ONNX Runtime. It achieves near-native performance by running inference in Web Workers and leveraging WebAssembly. The library ships with quantized models that work without a GPU. Supported tasks include text classification, named entity recognition, question answering, text generation, and embedding creation. Embedding outputs are returned as dense Float32 arrays suitable for vector store ingestion.',
        tags: ['embeddings', 'onnx', 'browser'],
        confidence: 'high',
        workflow: 'field-notes-system',
      }, mockCtx),

      writeTool.execute({
        path: '03-decisions/provider-choice.md',
        title: 'Embedding Provider Architecture Decision',
        summary: 'Elected to support multiple embedding backends with a unified interface, defaulting to bundled ONNX models for zero-config operation.',
        section: '03-decisions',
        body: 'We selected a provider abstraction that supports openai, ollama, lm-studio, vllm, google, and bundled ONNX models. The primary constraint is zero-config defaults: users should get working embeddings without an API key or external server. The bundled-cpu provider uses Transformers.js with quantized models stored in the agent binary. The bundled-gpu and bundled-large variants target machines with GPU memory headroom. The disabled provider stores no vectors and degrades search to keyword-only FTS5 matching.',
        tags: ['embeddings', 'architecture'],
        confidence: 'medium',
        workflow: 'field-notes-system',
      }, mockCtx),
    ]);

    for (const result of results) {
      expect(result.ok).toBe(true);
    }

    // Give the async indexer a moment to process the triggered reindex calls
    await new Promise((r) => setTimeout(r, 200));

    expect(store.totalDocs()).toBe(3);
  });

  // ── Test 2: hybrid search returns the most relevant hit ────────────────────

  test('hybrid search returns the most relevant hit', async () => {
    const searchTool = createFieldNotesSearchTool({ projectPath, store, embeddingProvider: provider });

    // "sqlite" and "vector" are explicitly in the sqlite-vec document
    const result = await searchTool.execute({ query: 'sqlite vector', k: 3, mode: 'hybrid' }, mockCtx);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // With 3 documents, we expect at least one result back
    expect(result.data.results.length).toBeGreaterThan(0);

    // The sqlite-vec document should rank first for a sqlite+vector query
    const topPath = result.data.results[0]?.path ?? '';
    expect(topPath).toContain('sqlite-vec');

    // Mode used: if provider is disabled we degrade to keyword; otherwise hybrid
    const expectedMode = provider.name === 'disabled' ? 'keyword' : 'hybrid';
    expect(result.data.mode_used).toBe(expectedMode);
  });

  // ── Test 3: switch to disabled and verify keyword fallback returns same top hit ─

  test('switching to disabled provider degrades search to keyword mode', async () => {
    const events: Parameters<typeof switchProvider>[0]['onEvent'][] = [];
    const collectedEvents: ReturnType<typeof events[number]>[] = [];

    await switchProvider({
      projectPath,
      projectId: 'test-project',
      store,
      currentProviderName: provider.name,
      newConfig: { name: 'disabled' as const },
      onEvent: (e) => collectedEvents.push(e),
    });

    // switchProvider deleted all chunks (dim 384 → 0 triggers requiresReindex=true).
    // Re-write the files so the store is populated for the keyword search.
    // Each write triggers an async reindex via the old indexer (bundled-cpu).
    const writeTool = createFieldNotesWriteTool({ projectPath, indexerService: indexer });
    for (const [path, title, summary, body, tags] of [
      ['02-tech/sqlite-vec.md', 'sqlite-vec', 'sqlite vector db', 'sqlite-vec stores vector embeddings in SQLite using a page-encoded format.', ['sqlite', 'vector-db']],
      ['02-tech/transformers-js.md', 'Transformers.js', 'ONNX in browser', 'Transformers.js runs ONNX models in the browser via WebAssembly.', ['embeddings', 'onnx']],
      ['03-decisions/provider-choice.md', 'Provider Choice', 'embedding architecture', 'We support multiple backends: openai, ollama, bundled ONNX, and disabled.', ['embeddings', 'architecture']],
    ] as const) {
      const r = await writeTool.execute({ path, title, summary, section: path.startsWith('03') ? '03-decisions' : '02-tech', body, tags, confidence: 'high' }, mockCtx);
      expect(r.ok).toBe(true);
    }
    // Wait for triggered reindex to complete before searching.
    await new Promise((r) => setTimeout(r, 400));

    const disabledProvider = resolveSecondaryProvider();
    const initResult = await disabledProvider.init();
    expect(initResult.ok).toBe(true);

    const searchTool = createFieldNotesSearchTool({ projectPath, store, embeddingProvider: disabledProvider });

    // Request semantic mode explicitly — should degrade to keyword
    const result = await searchTool.execute({ query: 'sqlite vector', k: 3, mode: 'semantic' }, mockCtx);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.mode_used).toBe('keyword');
    expect(result.data.results.length).toBeGreaterThan(0);
    expect(result.data.results[0]?.path).toContain('sqlite-vec');
  });

  // ── Test 4: status reports correct metrics ─────────────────────────────────

  test('status reports correct metrics after writes', async () => {
    const disabledProviderResult = createEmbeddingProvider({ name: 'disabled' });
    expect(disabledProviderResult.ok).toBe(true);
    if (!disabledProviderResult.ok) return;

    const statusResult = await getFieldNotesStatus({
      projectPath,
      projectId: 'test-project',
      store,
      provider: disabledProviderResult.data,
    });

    expect(statusResult.ok).toBe(true);
    if (!statusResult.ok) return;

    expect(statusResult.data.totalDocs).toBe(3);
    expect(statusResult.data.vectorEnabled).toBe(false); // disabled provider
    expect(statusResult.data.driftCount).toBe(0);        // all just indexed, no drift
    expect(statusResult.data.provider).toBe('disabled');
  });
});