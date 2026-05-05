import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getFieldNotesStatus, type ResearchStatus } from './status.js';
import { FieldNotesStore } from './store.js';
import type { EmbeddingProvider, EmbeddingProviderName } from './embeddings/provider.js';
import type { HardwareProfile, RecommendedTier } from './hardware.js';

// Mock embedding provider
function createMockProvider(config: {
  name: EmbeddingProviderName;
  isLocal: boolean;
  dim: number;
}): EmbeddingProvider {
  return {
    name: config.name,
    isLocal: config.isLocal,
    dim: () => config.dim,
    init: async () => ({ ok: true, data: undefined }),
    embed: async () => ({ ok: true, data: { vectors: [], dim: config.dim } }),
    dispose: async () => {},
  };
}

// Mock hardware profile
function createMockHardware(overrides?: Partial<HardwareProfile>): HardwareProfile {
  return {
    ramGB: 16,
    cpuCores: 8,
    hasGPU: true,
    hasNPU: false,
    platform: 'linux',
    gpuName: 'NVIDIA RTX 3070',
    ...overrides,
  };
}

describe('getFieldNotesStatus', () => {
  let tmpDir: string;
  let projectPath: string;
  let markdownDbDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'elefant-test-'));
    projectPath = tmpDir;
    markdownDbDir = join(projectPath, '.elefant', 'field-notes');
    mkdirSync(markdownDbDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('empty project (store=null, no DB file)', () => {
    it('returns indexExists=false when no DB file exists', async () => {
      const provider = createMockProvider({ name: 'ollama', isLocal: true, dim: 384 });
      
      const result = await getFieldNotesStatus({
        projectPath,
        projectId: 'test-project',
        store: null,
        provider,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.indexExists).toBe(false);
      expect(result.data.totalDocs).toBe(0);
      expect(result.data.totalChunks).toBe(0);
      expect(result.data.lastIndexedAt).toBeNull();
      expect(result.data.driftCount).toBe(0);
      expect(result.data.diskSizeBytes).toBe(0);
    });

    it('returns correct provider info', async () => {
      const provider = createMockProvider({ name: 'ollama', isLocal: true, dim: 384 });
      
      const result = await getFieldNotesStatus({
        projectPath,
        projectId: 'test-project',
        store: null,
        provider,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.provider).toBe('ollama');
      expect(result.data.providerIsLocal).toBe(true);
      expect(result.data.embeddingDim).toBe(384);
      expect(result.data.vectorEnabled).toBe(true);
    });

    it('returns null hardware when not provided', async () => {
      const provider = createMockProvider({ name: 'ollama', isLocal: true, dim: 384 });
      
      const result = await getFieldNotesStatus({
        projectPath,
        projectId: 'test-project',
        store: null,
        provider,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.hardware).toBeNull();
      expect(result.data.recommendedTier).toBeNull();
    });
  });

  describe('populated store', () => {
    it('returns correct metrics from store', async () => {
      const storeResult = FieldNotesStore.open(projectPath);
      expect(storeResult.ok).toBe(true);
      if (!storeResult.ok) return;
      
      const store = storeResult.data;
      const provider = createMockProvider({ name: 'ollama', isLocal: true, dim: 384 });

      // Add a document and chunks
      const docResult = store.upsertDocument({
        id: 'doc-1',
        filePath: 'test.md',
        section: '01-domain',
        title: 'Test Document',
        summary: 'A test document',
        confidence: 'high',
        tags: ['test'],
        sources: [],
        author_agent: 'researcher',
        workflow: null,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        bodyHash: 'abc123',
      });
      expect(docResult.ok).toBe(true);

      const chunksResult = store.upsertChunks('doc-1', [
        {
          chunkIndex: 0,
          text: 'Test chunk content',
          tokens: 10,
          updated: new Date().toISOString(),
        },
      ]);
      expect(chunksResult.ok).toBe(true);

      const result = await getFieldNotesStatus({
        projectPath,
        projectId: 'test-project',
        store,
        provider,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.indexExists).toBe(true);
      expect(result.data.totalDocs).toBe(1);
      expect(result.data.totalChunks).toBe(1);
      expect(result.data.diskSizeBytes).toBeGreaterThan(0);
      expect(result.data.lastIndexedAt).not.toBeNull();

      store.close();
    });
  });

  describe('disabled provider', () => {
    it('returns vectorEnabled=false and embeddingDim=0', async () => {
      const provider = createMockProvider({ name: 'disabled', isLocal: true, dim: 0 });
      
      const result = await getFieldNotesStatus({
        projectPath,
        projectId: 'test-project',
        store: null,
        provider,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.vectorEnabled).toBe(false);
      expect(result.data.embeddingDim).toBe(0);
      expect(result.data.provider).toBe('disabled');
    });
  });

  describe('drift detection', () => {
    it('returns driftCount > 0 when files have mtime > lastIndexedAt', async () => {
      const storeResult = FieldNotesStore.open(projectPath);
      expect(storeResult.ok).toBe(true);
      if (!storeResult.ok) return;
      
      const store = storeResult.data;
      const provider = createMockProvider({ name: 'ollama', isLocal: true, dim: 384 });

      // Create a markdown file first
      const testFile = join(markdownDbDir, 'test.md');
      writeFileSync(testFile, '# Test Content');

      // Wait a bit to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 50));

      // Add document and chunks (this sets lastIndexedAt)
      const now = new Date().toISOString();
      store.upsertDocument({
        id: 'doc-1',
        filePath: testFile,
        section: '01-domain',
        title: 'Test',
        summary: 'Test',
        confidence: 'high',
        tags: [],
        sources: [],
        author_agent: 'user',
        workflow: null,
        created: now,
        updated: now,
        bodyHash: 'hash',
      });

      store.upsertChunks('doc-1', [
        {
          chunkIndex: 0,
          text: 'Content',
          tokens: 5,
          updated: now,
        },
      ]);

      // Wait again
      await new Promise(resolve => setTimeout(resolve, 50));

      // Modify the file after indexing
      writeFileSync(testFile, '# Modified Content');

      const result = await getFieldNotesStatus({
        projectPath,
        projectId: 'test-project',
        store,
        provider,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.driftCount).toBeGreaterThan(0);

      store.close();
    });

    it('returns driftCount = 0 when all files are older than lastIndexedAt', async () => {
      const storeResult = FieldNotesStore.open(projectPath);
      expect(storeResult.ok).toBe(true);
      if (!storeResult.ok) return;
      
      const store = storeResult.data;
      const provider = createMockProvider({ name: 'ollama', isLocal: true, dim: 384 });

      // Create a markdown file
      const testFile = join(markdownDbDir, 'test.md');
      writeFileSync(testFile, '# Test Content');

      // Wait to ensure file is older than our index time
      await new Promise(resolve => setTimeout(resolve, 100));

      // Add document and chunks
      const now = new Date().toISOString();
      store.upsertDocument({
        id: 'doc-1',
        filePath: testFile,
        section: '01-domain',
        title: 'Test',
        summary: 'Test',
        confidence: 'high',
        tags: [],
        sources: [],
        author_agent: 'user',
        workflow: null,
        created: now,
        updated: now,
        bodyHash: 'hash',
      });

      store.upsertChunks('doc-1', [
        {
          chunkIndex: 0,
          text: 'Content',
          tokens: 5,
          updated: now,
        },
      ]);

      const result = await getFieldNotesStatus({
        projectPath,
        projectId: 'test-project',
        store,
        provider,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.driftCount).toBe(0);

      store.close();
    });

    it('returns driftCount = 0 when lastIndexedAt is null', async () => {
      const provider = createMockProvider({ name: 'ollama', isLocal: true, dim: 384 });

      // Create a markdown file
      const testFile = join(markdownDbDir, 'test.md');
      writeFileSync(testFile, '# Test Content');

      const result = await getFieldNotesStatus({
        projectPath,
        projectId: 'test-project',
        store: null,
        provider,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.lastIndexedAt).toBeNull();
      expect(result.data.driftCount).toBe(0);
    });
  });

  describe('hardware provided', () => {
    it('returns provided hardware without re-profiling', async () => {
      const hardware = createMockHardware({
        ramGB: 32,
        hasGPU: true,
        hasNPU: true,
      });

      const provider = createMockProvider({ name: 'ollama', isLocal: true, dim: 384 });
      
      const result = await getFieldNotesStatus({
        projectPath,
        projectId: 'test-project',
        store: null,
        provider,
        hardware,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.hardware).toEqual(hardware);
      expect(result.data.recommendedTier).toBe('bundled-large');
    });

    it('recommends bundled-gpu for GPU-only systems', async () => {
      const hardware = createMockHardware({
        ramGB: 8,
        hasGPU: true,
        hasNPU: false,
      });

      const provider = createMockProvider({ name: 'ollama', isLocal: true, dim: 384 });
      
      const result = await getFieldNotesStatus({
        projectPath,
        projectId: 'test-project',
        store: null,
        provider,
        hardware,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.recommendedTier).toBe('bundled-gpu');
    });

    it('recommends bundled-cpu for CPU-only systems', async () => {
      const hardware = createMockHardware({
        ramGB: 8,
        hasGPU: false,
        hasNPU: false,
      });

      const provider = createMockProvider({ name: 'ollama', isLocal: true, dim: 384 });
      
      const result = await getFieldNotesStatus({
        projectPath,
        projectId: 'test-project',
        store: null,
        provider,
        hardware,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.recommendedTier).toBe('bundled-cpu');
    });
  });

  describe('error handling', () => {
    it('does not throw on invalid paths', async () => {
      const provider = createMockProvider({ name: 'ollama', isLocal: true, dim: 384 });
      
      const result = await getFieldNotesStatus({
        projectPath: '/nonexistent/path/that/does/not/exist',
        projectId: 'test-project',
        store: null,
        provider,
      });

      // Should return a Result, not throw
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.indexExists).toBe(false);
      expect(result.data.totalDocs).toBe(0);
      expect(result.data.totalChunks).toBe(0);
    });
  });

  describe('ResearchStatus interface', () => {
    it('has all required fields', async () => {
      const hardware = createMockHardware();
      const provider = createMockProvider({ name: 'openai', isLocal: false, dim: 1536 });
      
      const result = await getFieldNotesStatus({
        projectPath,
        projectId: 'test-project',
        store: null,
        provider,
        hardware,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const status: ResearchStatus = result.data;
      
      // Verify all required fields exist and have correct types
      expect(typeof status.projectId).toBe('string');
      expect(typeof status.provider).toBe('string');
      expect(typeof status.providerIsLocal).toBe('boolean');
      expect(typeof status.embeddingDim).toBe('number');
      expect(typeof status.vectorEnabled).toBe('boolean');
      expect(typeof status.totalDocs).toBe('number');
      expect(typeof status.totalChunks).toBe('number');
      expect(typeof status.driftCount).toBe('number');
      expect(typeof status.diskSizeBytes).toBe('number');
      expect(typeof status.indexExists).toBe('boolean');
      
      // Nullable fields
      if (status.lastIndexedAt !== null) {
        expect(typeof status.lastIndexedAt).toBe('string');
      }
      if (status.recommendedTier !== null) {
        expect(['bundled-large', 'bundled-gpu', 'bundled-cpu']).toContain(status.recommendedTier);
      }
      if (status.hardware !== null) {
        expect(typeof status.hardware.ramGB).toBe('number');
        expect(typeof status.hardware.cpuCores).toBe('number');
        expect(typeof status.hardware.hasGPU).toBe('boolean');
        expect(typeof status.hardware.hasNPU).toBe('boolean');
        expect(typeof status.hardware.platform).toBe('string');
      }
    });
  });
});
