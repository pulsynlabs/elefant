import { describe, expect, test } from 'bun:test';
import { ok, err } from '../types/result.ts';
import type { Result } from '../types/result.ts';
import type { ElefantError } from '../types/errors.ts';
import type { EmbeddingProvider, EmbeddingProviderConfig, EmbedResult } from './embeddings/provider.ts';
import type { FieldNotesStore } from './store.ts';
import type { IndexerService, IndexerOptions, BulkIndexSummary } from './indexer.ts';
import { switchProvider, type ProviderSwitchedEvent } from './provider-switch.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface MockStoreState {
  maxDim: number;
  chunkCount: number;
  deleteAllChunksCalled: boolean;
  clearAllEmbeddingsCalled: boolean;
}

function createMockStore(state: MockStoreState): FieldNotesStore {
  return {
    getMaxEmbeddingDim: () => state.maxDim,
    totalChunks: () => state.chunkCount,
    deleteAllChunks: () => {
      state.deleteAllChunksCalled = true;
      return ok<undefined>(undefined);
    },
    clearAllEmbeddings: () => {
      state.clearAllEmbeddingsCalled = true;
      return ok<undefined>(undefined);
    },
  } as unknown as FieldNotesStore;
}

function createMockProvider(name: string, dim: number): EmbeddingProvider {
  return {
    name: name as EmbeddingProvider['name'],
    isLocal: true,
    init: async (): Promise<Result<void, ElefantError>> => ok(undefined),
    dim: () => dim,
    embed: async (_texts: string[]): Promise<Result<EmbedResult, ElefantError>> =>
      ok({ vectors: [], dim }),
    dispose: async () => {},
  };
}

function createFailingInitProvider(name: string): EmbeddingProvider {
  return {
    name: name as EmbeddingProvider['name'],
    isLocal: true,
    init: async (): Promise<Result<void, ElefantError>> =>
      err({ code: 'PROVIDER_ERROR', message: 'init failed' }),
    dim: () => 0,
    embed: async (_texts: string[]): Promise<Result<EmbedResult, ElefantError>> =>
      err({ code: 'PROVIDER_ERROR', message: 'not initialized' }),
    dispose: async () => {},
  };
}

interface CapturedIndexerOptions {
  projectPath: string;
  projectId: string;
  providerName: string;
  providerDim: number;
  bulkIndexCalled: boolean;
}

function createMockIndexerFactory(captured: CapturedIndexerOptions): (opts: IndexerOptions) => IndexerService {
  return (opts: IndexerOptions): IndexerService => {
    captured.projectPath = opts.projectPath;
    captured.projectId = opts.projectId;
    captured.providerName = opts.provider.name;
    captured.providerDim = opts.provider.dim();
    return {
      bulkIndex: async (): Promise<Result<BulkIndexSummary, ElefantError>> => {
        captured.bulkIndexCalled = true;
        return ok({ indexed: 0, skipped: 0, errors: [] });
      },
    } as unknown as IndexerService;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('switchProvider', () => {
  test('no chunks exist — requiresReindex=false, bulkIndex triggered', async () => {
    const storeState: MockStoreState = {
      maxDim: 0,
      chunkCount: 0,
      deleteAllChunksCalled: false,
      clearAllEmbeddingsCalled: false,
    };
    const store = createMockStore(storeState);
    const newProvider = createMockProvider('disabled', 0);
    const captured: CapturedIndexerOptions = {
      projectPath: '', projectId: '', providerName: '', providerDim: 0, bulkIndexCalled: false,
    };
    const factory = createMockIndexerFactory(captured);

    let emitted: ProviderSwitchedEvent | null = null;
    const result = await switchProvider({
      projectPath: '/tmp/test',
      projectId: 'project-1',
      store,
      currentProviderName: 'disabled',
      newConfig: { name: 'disabled' },
      onEvent: (e) => { emitted = e; },
      indexerFactory: factory,
      createProvider: (_config: EmbeddingProviderConfig): Result<EmbeddingProvider, ElefantError> =>
        ok(newProvider),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.reindexStarted).toBe(true);

    // Event
    expect(emitted).not.toBeNull();
    expect(emitted!.type).toBe('fieldnotes:provider-changed');
    expect(emitted!.previousDim).toBe(0);
    expect(emitted!.newDim).toBe(0);
    expect(emitted!.requiresReindex).toBe(false);

    // Store calls
    expect(storeState.deleteAllChunksCalled).toBe(false);
    expect(storeState.clearAllEmbeddingsCalled).toBe(false);

    // Indexer
    expect(captured.bulkIndexCalled).toBe(true);
    expect(captured.providerName).toBe('disabled');
  });

  test('chunks exist, same dim — requiresReindex=false, embeddings cleared', async () => {
    const storeState: MockStoreState = {
      maxDim: 384,
      chunkCount: 50,
      deleteAllChunksCalled: false,
      clearAllEmbeddingsCalled: false,
    };
    const store = createMockStore(storeState);
    const newProvider = createMockProvider('bundled-cpu', 384);
    const captured: CapturedIndexerOptions = {
      projectPath: '', projectId: '', providerName: '', providerDim: 0, bulkIndexCalled: false,
    };
    const factory = createMockIndexerFactory(captured);

    let emitted: ProviderSwitchedEvent | null = null;
    const result = await switchProvider({
      projectPath: '/tmp/test',
      projectId: 'project-2',
      store,
      currentProviderName: 'ollama',
      newConfig: { name: 'bundled-cpu' },
      onEvent: (e) => { emitted = e; },
      indexerFactory: factory,
      createProvider: (_config: EmbeddingProviderConfig): Result<EmbeddingProvider, ElefantError> =>
        ok(newProvider),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(emitted!.requiresReindex).toBe(false);
    expect(emitted!.previousDim).toBe(384);
    expect(emitted!.newDim).toBe(384);
    expect(emitted!.previousProvider).toBe('ollama');
    expect(emitted!.newProvider).toBe('bundled-cpu');

    expect(storeState.deleteAllChunksCalled).toBe(false);
    expect(storeState.clearAllEmbeddingsCalled).toBe(true);
    expect(captured.bulkIndexCalled).toBe(true);
  });

  test('chunks exist, dim mismatch — requiresReindex=true, chunks cleared', async () => {
    const storeState: MockStoreState = {
      maxDim: 384,
      chunkCount: 50,
      deleteAllChunksCalled: false,
      clearAllEmbeddingsCalled: false,
    };
    const store = createMockStore(storeState);
    const newProvider = createMockProvider('bundled-large', 768);
    const captured: CapturedIndexerOptions = {
      projectPath: '', projectId: '', providerName: '', providerDim: 0, bulkIndexCalled: false,
    };
    const factory = createMockIndexerFactory(captured);

    let emitted: ProviderSwitchedEvent | null = null;
    const result = await switchProvider({
      projectPath: '/tmp/test',
      projectId: 'project-3',
      store,
      currentProviderName: 'bundled-cpu',
      newConfig: { name: 'bundled-large' },
      onEvent: (e) => { emitted = e; },
      indexerFactory: factory,
      createProvider: (_config: EmbeddingProviderConfig): Result<EmbeddingProvider, ElefantError> =>
        ok(newProvider),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(emitted!.requiresReindex).toBe(true);
    expect(emitted!.previousDim).toBe(384);
    expect(emitted!.newDim).toBe(768);
    expect(emitted!.previousProvider).toBe('bundled-cpu');
    expect(emitted!.newProvider).toBe('bundled-large');

    expect(storeState.deleteAllChunksCalled).toBe(true);
    expect(storeState.clearAllEmbeddingsCalled).toBe(false);
    expect(captured.bulkIndexCalled).toBe(true);
  });

  test('provider init fails — returns error, no event emitted, store untouched', async () => {
    const storeState: MockStoreState = {
      maxDim: 384,
      chunkCount: 50,
      deleteAllChunksCalled: false,
      clearAllEmbeddingsCalled: false,
    };
    const store = createMockStore(storeState);
    const failingProvider = createFailingInitProvider('bundled-cpu');
    const captured: CapturedIndexerOptions = {
      projectPath: '', projectId: '', providerName: '', providerDim: 0, bulkIndexCalled: false,
    };
    const factory = createMockIndexerFactory(captured);

    let eventCount = 0;
    const result = await switchProvider({
      projectPath: '/tmp/test',
      projectId: 'project-4',
      store,
      currentProviderName: 'disabled',
      newConfig: { name: 'bundled-cpu' },
      onEvent: () => { eventCount += 1; },
      indexerFactory: factory,
      createProvider: (_config: EmbeddingProviderConfig): Result<EmbeddingProvider, ElefantError> =>
        ok(failingProvider),
    });

    expect(result.ok).toBe(false);
    expect(eventCount).toBe(0);
    expect(storeState.deleteAllChunksCalled).toBe(false);
    expect(storeState.clearAllEmbeddingsCalled).toBe(false);
    expect(captured.bulkIndexCalled).toBe(false);
  });

  test('createProvider returns error — returns error, no event emitted', async () => {
    const storeState: MockStoreState = {
      maxDim: 384,
      chunkCount: 50,
      deleteAllChunksCalled: false,
      clearAllEmbeddingsCalled: false,
    };
    const store = createMockStore(storeState);
    const captured: CapturedIndexerOptions = {
      projectPath: '', projectId: '', providerName: '', providerDim: 0, bulkIndexCalled: false,
    };
    const factory = createMockIndexerFactory(captured);

    let eventCount = 0;
    const result = await switchProvider({
      projectPath: '/tmp/test',
      projectId: 'project-5',
      store,
      currentProviderName: 'disabled',
      newConfig: { name: 'bundled-cpu' },
      onEvent: () => { eventCount += 1; },
      indexerFactory: factory,
      createProvider: (_config: EmbeddingProviderConfig): Result<EmbeddingProvider, ElefantError> =>
        err({ code: 'CONFIG_INVALID', message: 'bad config' }),
    });

    expect(result.ok).toBe(false);
    expect(eventCount).toBe(0);
    expect(storeState.deleteAllChunksCalled).toBe(false);
    expect(captured.bulkIndexCalled).toBe(false);
  });

  test('onEvent is called exactly once', async () => {
    const storeState: MockStoreState = {
      maxDim: 384,
      chunkCount: 10,
      deleteAllChunksCalled: false,
      clearAllEmbeddingsCalled: false,
    };
    const store = createMockStore(storeState);
    const newProvider = createMockProvider('bundled-cpu', 384);
    const captured: CapturedIndexerOptions = {
      projectPath: '', projectId: '', providerName: '', providerDim: 0, bulkIndexCalled: false,
    };
    const factory = createMockIndexerFactory(captured);

    let eventCount = 0;
    await switchProvider({
      projectPath: '/tmp/test',
      projectId: 'project-6',
      store,
      currentProviderName: 'disabled',
      newConfig: { name: 'bundled-cpu' },
      onEvent: () => { eventCount += 1; },
      indexerFactory: factory,
      createProvider: (_config: EmbeddingProviderConfig): Result<EmbeddingProvider, ElefantError> =>
        ok(newProvider),
    });

    expect(eventCount).toBe(1);
  });

  test('indexerFactory receives the new provider', async () => {
    const storeState: MockStoreState = {
      maxDim: 0,
      chunkCount: 0,
      deleteAllChunksCalled: false,
      clearAllEmbeddingsCalled: false,
    };
    const store = createMockStore(storeState);
    const newProvider = createMockProvider('ollama', 768);
    const captured: CapturedIndexerOptions = {
      projectPath: '', projectId: '', providerName: '', providerDim: 0, bulkIndexCalled: false,
    };
    const factory = createMockIndexerFactory(captured);

    await switchProvider({
      projectPath: '/tmp/test',
      projectId: 'project-7',
      store,
      currentProviderName: 'disabled',
      newConfig: { name: 'ollama' },
      onEvent: () => {},
      indexerFactory: factory,
      createProvider: (_config: EmbeddingProviderConfig): Result<EmbeddingProvider, ElefantError> =>
        ok(newProvider),
    });

    expect(captured.projectPath).toBe('/tmp/test');
    expect(captured.projectId).toBe('project-7');
    expect(captured.providerName).toBe('ollama');
    expect(captured.providerDim).toBe(768);
  });

  test('uses default IndexerService constructor when no indexerFactory provided', async () => {
    // This test verifies the default factory path works by using the disabled
    // provider (which doesn't need any real FS or network).
    // We create a minimal mock store and let the real createEmbeddingProvider
    // handle the disabled provider.
    const storeState: MockStoreState = {
      maxDim: 0,
      chunkCount: 0,
      deleteAllChunksCalled: false,
      clearAllEmbeddingsCalled: false,
    };
    const store = createMockStore(storeState);
    const newProvider = createMockProvider('disabled', 0);

    let emitted: ProviderSwitchedEvent | null = null;
    const result = await switchProvider({
      projectPath: '/tmp/test-empty',
      projectId: 'project-default',
      store,
      currentProviderName: 'disabled',
      newConfig: { name: 'disabled' },
      onEvent: (e) => { emitted = e; },
      createProvider: (_config: EmbeddingProviderConfig): Result<EmbeddingProvider, ElefantError> =>
        ok(newProvider),
    });

    // The default IndexerService constructor requires a real projectPath
    // and will try to walk the filesystem. Since we use createProvider to inject
    // a mock, the IndexerService's bulkIndex will still run, but with our mock
    // store. The test verifies the event was emitted and no errors.
    expect(result.ok).toBe(true);
    expect(emitted).not.toBeNull();
  });
});
