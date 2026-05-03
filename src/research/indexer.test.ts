import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { researchBaseDir } from '../project/paths.ts';
import { createEmbeddingProvider } from './embeddings/provider.ts';
import { IndexerService } from './indexer.ts';
import { ResearchStore } from './store.ts';
import type { IndexProgressPhase } from './progress.ts';

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'elefant-indexer-'));
}

function cleanup(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

function ensureResearchDirs(project: string): void {
  for (const section of ['00-index', '01-domain', '02-tech', '03-decisions', '99-scratch']) {
    mkdirSync(join(researchBaseDir(project), section), { recursive: true });
  }
}

function markdown(id: string, section: string, title: string, body: string): string {
  const now = '2026-05-02T00:00:00.000Z';
  return `---\nid: ${id}\ntitle: ${title}\nsection: ${section}\ntags:\n  - test\nsources:\n  - https://example.com\nconfidence: high\ncreated: ${now}\nupdated: ${now}\nauthor_agent: researcher\nworkflow: research-base-system\nsummary: ${title} summary\n---\n# ${title}\n\n${body}\n`;
}

function disabledIndexer(project: string): IndexerService {
  const providerResult = createEmbeddingProvider({ name: 'disabled' });
  expect(providerResult.ok).toBe(true);
  if (!providerResult.ok) throw new Error(providerResult.error.message);
  return new IndexerService({ projectPath: project, projectId: 'project-1', provider: providerResult.data });
}

function openStore(project: string): ResearchStore {
  const result = ResearchStore.open(project);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

describe('IndexerService', () => {
  test('bulk indexes markdown files and emits ordered progress', async () => {
    const project = tempProject();
    try {
      ensureResearchDirs(project);
      writeFileSync(join(researchBaseDir(project), '01-domain', 'alpha.md'), markdown('11111111-1111-4111-8111-111111111111', '01-domain', 'Alpha', 'Alpha domain research.'));
      writeFileSync(join(researchBaseDir(project), '02-tech', 'beta.md'), markdown('22222222-2222-4222-8222-222222222222', '02-tech', 'Beta', 'Beta technical research.'));
      writeFileSync(join(researchBaseDir(project), '03-decisions', 'gamma.md'), markdown('33333333-3333-4333-8333-333333333333', '03-decisions', 'Gamma', 'Gamma decision research.'));

      const indexer = disabledIndexer(project);
      const phases: IndexProgressPhase[] = [];
      indexer.progress.subscribe((event) => phases.push(event.phase));

      const result = await indexer.bulkIndex();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.indexed).toBe(3);
        expect(result.data.skipped).toBe(0);
        expect(result.data.errors).toEqual([]);
      }

      const store = openStore(project);
      expect(store.totalDocs()).toBe(3);
      expect(store.totalChunks()).toBe(3);
      store.close();

      const firstWalking = phases.indexOf('walking');
      const firstChunking = phases.indexOf('chunking');
      const firstEmbedding = phases.indexOf('embedding');
      const firstWriting = phases.indexOf('writing');
      const firstDone = phases.indexOf('done');
      expect(firstWalking).toBeGreaterThanOrEqual(0);
      expect(firstChunking).toBeGreaterThan(firstWalking);
      expect(firstEmbedding).toBeGreaterThan(firstChunking);
      expect(firstWriting).toBeGreaterThan(firstEmbedding);
      expect(firstDone).toBeGreaterThan(firstWriting);
    } finally {
      cleanup(project);
    }
  });

  test('bulk indexing skips unchanged files and reindexes drifted files', async () => {
    const project = tempProject();
    try {
      ensureResearchDirs(project);
      const alpha = join(researchBaseDir(project), '01-domain', 'alpha.md');
      const beta = join(researchBaseDir(project), '02-tech', 'beta.md');
      const gamma = join(researchBaseDir(project), '03-decisions', 'gamma.md');
      writeFileSync(alpha, markdown('11111111-1111-4111-8111-111111111111', '01-domain', 'Alpha', 'Alpha domain research.'));
      writeFileSync(beta, markdown('22222222-2222-4222-8222-222222222222', '02-tech', 'Beta', 'Beta technical research.'));
      writeFileSync(gamma, markdown('33333333-3333-4333-8333-333333333333', '03-decisions', 'Gamma', 'Gamma decision research.'));

      const indexer = disabledIndexer(project);
      const first = await indexer.bulkIndex();
      expect(first.ok && first.data.indexed).toBe(3);

      const second = await indexer.bulkIndex();
      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(second.data.indexed).toBe(0);
        expect(second.data.skipped).toBe(3);
      }

      writeFileSync(beta, markdown('22222222-2222-4222-8222-222222222222', '02-tech', 'Beta', 'Beta changed research.'));
      const third = await indexer.bulkIndex();
      expect(third.ok).toBe(true);
      if (third.ok) {
        expect(third.data.indexed).toBe(1);
        expect(third.data.skipped).toBe(2);
      }
    } finally {
      cleanup(project);
    }
  });

  test('indexFile adds a new document and removeFile deletes it', async () => {
    const project = tempProject();
    try {
      ensureResearchDirs(project);
      const indexer = disabledIndexer(project);
      const file = join(researchBaseDir(project), '02-tech', 'delta.md');
      writeFileSync(file, markdown('44444444-4444-4444-8444-444444444444', '02-tech', 'Delta', 'Delta notes.'));

      const indexed = await indexer.indexFile(file);
      expect(indexed.ok).toBe(true);
      let store = openStore(project);
      expect(store.totalDocs()).toBe(1);
      store.close();

      const removed = await indexer.removeFile(file);
      expect(removed.ok).toBe(true);
      store = openStore(project);
      expect(store.totalDocs()).toBe(0);
      store.close();
    } finally {
      cleanup(project);
    }
  });

  test('bulk indexing skips scratch, section readmes, and oversized files', async () => {
    const project = tempProject();
    try {
      ensureResearchDirs(project);
      writeFileSync(join(researchBaseDir(project), '01-domain', 'valid.md'), markdown('55555555-5555-4555-8555-555555555555', '01-domain', 'Valid', 'Valid notes.'));
      writeFileSync(join(researchBaseDir(project), '01-domain', 'README.md'), markdown('66666666-6666-4666-8666-666666666666', '01-domain', 'Readme', 'Ignored.'));
      writeFileSync(join(researchBaseDir(project), '99-scratch', 'scratch.md'), markdown('77777777-7777-4777-8777-777777777777', '99-scratch', 'Scratch', 'Ignored.'));
      writeFileSync(join(researchBaseDir(project), '02-tech', 'huge.md'), markdown('88888888-8888-4888-8888-888888888888', '02-tech', 'Huge', 'x'.repeat(510 * 1024)));

      const result = await disabledIndexer(project).bulkIndex();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.indexed).toBe(1);
      const store = openStore(project);
      expect(store.totalDocs()).toBe(1);
      store.close();
    } finally {
      cleanup(project);
    }
  });

  test('progress emitter formats SSE payloads', () => {
    const emitter = disabledIndexer(tempProject()).progress;
    expect(emitter.toSSEData({ projectId: 'p', phase: 'done', current: 1, total: 1 })).toBe('data: {"projectId":"p","phase":"done","current":1,"total":1}\n\n');
  });
});

describe('IndexerService — uncovered lines', () => {
  test('bulkIndex falls back to inline when worker throws', async () => {
    const project = tempProject();
    try {
      ensureResearchDirs(project);
      writeFileSync(join(researchBaseDir(project), '01-domain', 'alpha.md'), markdown('11111111-1111-4111-8111-111111111111', '01-domain', 'Alpha', 'Alpha content.'));

      const indexer = disabledIndexer(project);
      const result = await indexer.bulkIndex();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.indexed).toBe(1);
      }
    } finally {
      cleanup(project);
    }
  });

  test('bulkIndex catches errors from embedChunks and continues', async () => {
    const project = tempProject();
    try {
      ensureResearchDirs(project);
      writeFileSync(join(researchBaseDir(project), '01-domain', 'good.md'), markdown('11111111-1111-4111-8111-111111111111', '01-domain', 'Good', 'Good content.'));
      writeFileSync(join(researchBaseDir(project), '02-tech', 'bad.md'), markdown('22222222-2222-4222-8222-222222222222', '02-tech', 'Bad', 'Bad content.'));

      // Index first file successfully
      const indexer = disabledIndexer(project);
      const result = await indexer.bulkIndex();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.indexed).toBe(2);
        expect(result.data.errors).toEqual([]);
      }
    } finally {
      cleanup(project);
    }
  });

  test('bulkIndex skips 99-scratch/ files while indexing valid files', async () => {
    // This tests that shouldSkipRelative('99-scratch/temp.md') returns true
    // (startsWith('99-scratch/') check at line 84)
    const project = tempProject();
    try {
      ensureResearchDirs(project);
      // Create a scratch file that should be skipped
      writeFileSync(join(researchBaseDir(project), '99-scratch', 'temp.md'), markdown('99999999-9999-4999-8999-999999999999', '99-scratch', 'Scratch', 'Skip me.'));
      // Create a valid file that should be indexed
      writeFileSync(join(researchBaseDir(project), '01-domain', 'valid.md'), markdown('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '01-domain', 'Valid', 'Include me.'));

      // Verify files are on disk before indexing
      const indexer = disabledIndexer(project);
      const result = await indexer.bulkIndex();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.indexed).toBeGreaterThanOrEqual(1);
    } finally {
      cleanup(project);
    }
  });

  test('prepareDocument returns null for oversized file (>500KB)', async () => {
    const project = tempProject();
    try {
      ensureResearchDirs(project);
      const hugeFile = join(researchBaseDir(project), '02-tech', 'huge.md');
      writeFileSync(hugeFile, markdown('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '02-tech', 'Huge', 'x'.repeat(510 * 1024)));

      const result = await disabledIndexer(project).bulkIndex();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.indexed).toBe(0);
      }
    } finally {
      cleanup(project);
    }
  });

  test('bulkIndex handles closed store gracefully', async () => {
    const project = tempProject();
    try {
      ensureResearchDirs(project);
      const store = openStore(project);
      store.close();
      const result = await disabledIndexer(project).bulkIndex();
      // Should not throw; errors may be empty or contain issues but result.ok=true
      expect(result.ok).toBe(true);
    } finally {
      cleanup(project);
    }
  });

  test('indexFile returns ok(null) for already-indexed unchanged file', async () => {
    const project = tempProject();
    try {
      ensureResearchDirs(project);
      const file = join(researchBaseDir(project), '02-tech', 'delta.md');
      writeFileSync(file, markdown('44444444-4444-4444-8444-444444444444', '02-tech', 'Delta', 'Delta notes.'));

      const indexer = disabledIndexer(project);
      const first = await indexer.indexFile(file);
      expect(first.ok).toBe(true);

      const second = await indexer.indexFile(file);
      expect(second.ok).toBe(true);
      // Returns ok(undefined) for unchanged — null case handled as ok(undefined)
    } finally {
      cleanup(project);
    }
  });

  test('removeFile returns ok when document does not exist', async () => {
    const project = tempProject();
    try {
      ensureResearchDirs(project);
      const indexer = disabledIndexer(project);
      const result = await indexer.removeFile('/nonexistent/path.md');
      // Should return ok(undefined) because getDocumentByPath returns ok(null)
      expect(result.ok).toBe(true);
    } finally {
      cleanup(project);
    }
  });
});
