import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';
import { researchIndexPath } from '../project/paths.js';
import { ResearchStore, type UpsertDocumentInput } from './store.js';

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'elefant-research-store-'));
}

function cleanup(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

function doc(overrides: Partial<UpsertDocumentInput> = {}): UpsertDocumentInput {
  const now = new Date().toISOString();
  return {
    id: '11111111-1111-4111-8111-111111111111',
    filePath: '02-tech/vector-search.md',
    section: '02-tech',
    title: 'Vector Search Notes',
    summary: 'Notes about vector search.',
    confidence: 'high',
    tags: ['sqlite', 'search'],
    sources: ['https://example.com/source'],
    author_agent: 'researcher',
    workflow: 'research-base-system',
    created: now,
    updated: now,
    bodyHash: 'a'.repeat(64),
    ...overrides,
  };
}

function openStore(project: string): ResearchStore {
  const result = ResearchStore.open(project);
  expect(result.ok).toBe(true);
  if (result.ok === false) throw new Error(result.error.message);
  return result.data;
}

describe('ResearchStore', () => {
  test('open creates the DB and initializes all schema objects', () => {
    const project = tempProject();
    const store = openStore(project);
    store.close();

    const db = new Database(researchIndexPath(project));
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type IN ('table', 'trigger') ORDER BY name")
      .all()
      .map((row) => String((row as { name: string }).name));
    expect(tables).toContain('research_documents');
    expect(tables).toContain('research_chunks');
    expect(tables).toContain('research_chunks_fts');
    expect(tables).toContain('research_chunks_ai');
    db.close();
    cleanup(project);
  });

  test('upsertDocument round-trips by path and id', () => {
    const project = tempProject();
    const store = openStore(project);
    const input = doc();

    expect(store.upsertDocument(input).ok).toBe(true);
    const byPath = store.getDocumentByPath(input.filePath);
    expect(byPath.ok).toBe(true);
    if (byPath.ok) {
      expect(byPath.data?.id).toBe(input.id);
      expect(byPath.data?.tags).toEqual(['sqlite', 'search']);
    }

    const byId = store.getDocumentById(input.id);
    expect(byId.ok).toBe(true);
    if (byId.ok) expect(byId.data?.filePath).toBe(input.filePath);
    store.close();
    cleanup(project);
  });

  test('upsertChunks atomically replaces chunks for a document', () => {
    const project = tempProject();
    const store = openStore(project);
    const input = doc();
    expect(store.upsertDocument(input).ok).toBe(true);
    expect(store.upsertChunks(input.id, [
      { chunkIndex: 0, text: 'first chunk', tokens: 2 },
      { chunkIndex: 1, text: 'second chunk', tokens: 2 },
    ]).ok).toBe(true);
    expect(store.totalChunks()).toBe(2);

    expect(store.upsertChunks(input.id, [{ chunkIndex: 0, text: 'replacement chunk', tokens: 2 }]).ok).toBe(true);
    expect(store.totalChunks()).toBe(1);
    const hit = store.searchKeyword('replacement', { k: 5 });
    expect(hit.ok).toBe(true);
    if (hit.ok) expect(hit.data[0]?.text).toBe('replacement chunk');
    store.close();
    cleanup(project);
  });

  test('FTS5 keyword search returns expected hit with document metadata', () => {
    const project = tempProject();
    const store = openStore(project);
    const input = doc();
    expect(store.upsertDocument(input).ok).toBe(true);
    expect(store.upsertChunks(input.id, [
      { chunkIndex: 0, text: 'bananas and apples', tokens: 3 },
      { chunkIndex: 1, text: 'sqlite vector embeddings and bm25 search', tokens: 6 },
    ]).ok).toBe(true);

    const result = store.searchKeyword('embeddings', { k: 3, section: '02-tech' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].documentTitle).toBe('Vector Search Notes');
      expect(result.data[0].documentPath).toBe(input.filePath);
      expect(result.data[0].score).toBeGreaterThan(0);
    }
    store.close();
    cleanup(project);
  });

  test('searchVector returns cosine-ranked Float32Array results', () => {
    const project = tempProject();
    const store = openStore(project);
    const input = doc();
    expect(store.upsertDocument(input).ok).toBe(true);
    expect(store.upsertChunks(input.id, [
      { chunkIndex: 0, text: 'near', tokens: 1, embedding: new Float32Array([1, 0, 0]) },
      { chunkIndex: 1, text: 'far', tokens: 1, embedding: new Float32Array([0, 1, 0]) },
    ]).ok).toBe(true);

    const result = store.searchVector(new Float32Array([1, 0.1, 0]), { k: 2 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data[0].text).toBe('near');
      expect(result.data[0].embedding).toBeInstanceOf(Float32Array);
      expect(result.data[0].score).toBeGreaterThan(result.data[1].score);
    }
    store.close();
    cleanup(project);
  });

  test('searchVector returns VECTOR_DIM_MISMATCH when indexed dims differ', () => {
    const project = tempProject();
    const store = openStore(project);
    const input = doc();
    expect(store.upsertDocument(input).ok).toBe(true);
    expect(store.upsertChunks(input.id, [
      { chunkIndex: 0, text: 'vector', tokens: 1, embedding: new Float32Array([1, 0, 0]) },
    ]).ok).toBe(true);

    const result = store.searchVector(new Float32Array([1, 0]), { k: 2 });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error.code).toBe('VECTOR_DIM_MISMATCH');
    store.close();
    cleanup(project);
  });

  test('deleteDocument cascades to chunks and FTS entries', () => {
    const project = tempProject();
    const store = openStore(project);
    const input = doc();
    expect(store.upsertDocument(input).ok).toBe(true);
    expect(store.upsertChunks(input.id, [{ chunkIndex: 0, text: 'cascade keyword', tokens: 2 }]).ok).toBe(true);
    expect(store.totalChunks()).toBe(1);

    expect(store.deleteDocument(input.id).ok).toBe(true);
    expect(store.totalDocs()).toBe(0);
    expect(store.totalChunks()).toBe(0);
    const result = store.searchKeyword('cascade', { k: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveLength(0);
    store.close();
    cleanup(project);
  });

  test('listDocuments filters by section and total/disk metrics work', () => {
    const project = tempProject();
    const store = openStore(project);
    expect(store.upsertDocument(doc()).ok).toBe(true);
    expect(store.upsertDocument(doc({
      id: '22222222-2222-4222-8222-222222222222',
      filePath: '03-decisions/choice.md',
      section: '03-decisions',
      title: 'Choice',
    })).ok).toBe(true);
    expect(store.totalDocs()).toBe(2);
    expect(store.diskSizeBytes()).toBeGreaterThan(0);
    const tech = store.listDocuments({ section: '02-tech' });
    expect(tech.ok).toBe(true);
    if (tech.ok) expect(tech.data).toHaveLength(1);
    store.close();
    cleanup(project);
  });

  test('close is idempotent', () => {
    const project = tempProject();
    const store = openStore(project);
    expect(() => store.close()).not.toThrow();
    expect(() => store.close()).not.toThrow();
    cleanup(project);
  });
});
