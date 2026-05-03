import { ok, err, type Result } from '../types/result.ts';
import type { ElefantError } from '../types/errors.ts';
import { createEmbeddingProvider, type EmbeddingProvider, type EmbeddingProviderConfig } from './embeddings/provider.ts';
import type { ResearchStore } from './store.ts';
import type { IndexerOptions } from './indexer.ts';
import { IndexerService } from './indexer.ts';

export type ProviderSwitchEventType = 'research:provider-changed';

export interface ProviderSwitchedEvent {
  type: ProviderSwitchEventType;
  projectId: string;
  previousProvider: string;
  newProvider: string;
  previousDim: number;
  newDim: number;
  requiresReindex: boolean;
}

function elefantError(error: unknown): ElefantError {
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    return error as ElefantError;
  }
  return { code: 'TOOL_EXECUTION_FAILED', message: String(error), details: error };
}

/**
 * Switches the embedding provider for a project's research base.
 *
 * Reads the current chunk embedding dimension from the store, creates and
 * initializes the new provider, then compares dimensions. If dimensions
 * differ, all chunk rows are deleted (source markdown files and document
 * rows are preserved) and a full reindex is triggered. If dimensions match,
 * existing chunk embeddings are cleared so they are re-embedded in the
 * background. In all cases a {@link ProviderSwitchedEvent} is emitted before
 * the reindex begins.
 */
export async function switchProvider(opts: {
  projectPath: string;
  projectId: string;
  store: ResearchStore;
  currentProviderName: string;
  newConfig: EmbeddingProviderConfig;
  onEvent: (e: ProviderSwitchedEvent) => void;
  indexerFactory?: (opts: IndexerOptions) => IndexerService;
  createProvider?: (config: EmbeddingProviderConfig) => Result<EmbeddingProvider, ElefantError>;
}): Promise<Result<{ event: ProviderSwitchedEvent; reindexStarted: boolean }, ElefantError>> {
  // 1. Read current dimension from existing chunks (0 if no chunks exist).
  const previousDim = opts.store.getMaxEmbeddingDim();

  // 2. Create and init the new provider to learn its output dimension.
  const providerFactory = opts.createProvider ?? createEmbeddingProvider;
  const providerResult = providerFactory(opts.newConfig);
  if (!providerResult.ok) return providerResult;
  const newProvider = providerResult.data;

  const initResult = await newProvider.init();
  if (!initResult.ok) return initResult;
  const newDim = newProvider.dim();

  // 3. Determine whether a destructive reindex is required.
  //    requiresReindex is true ONLY when existing chunks have a
  //    non-zero dimension that differs from the new provider.
  const hasChunks = opts.store.totalChunks() > 0;
  const requiresReindex = previousDim > 0 && previousDim !== newDim;

  // 4. Emit the event before mutating state.
  const event: ProviderSwitchedEvent = {
    type: 'research:provider-changed',
    projectId: opts.projectId,
    previousProvider: opts.currentProviderName,
    newProvider: opts.newConfig.name,
    previousDim,
    newDim,
    requiresReindex,
  };
  opts.onEvent(event);

  // 5. Update the store. Source markdown files are never deleted.
  try {
    if (requiresReindex) {
      // Dimension changed — wipe the chunk table. Document rows and their
      // source markdown files are preserved.
      const deleteResult = opts.store.deleteAllChunks();
      if (!deleteResult.ok) return deleteResult;
    } else if (hasChunks) {
      // Same dimension — mark all chunks as dirty so the reindex
      // re-embeds every chunk in the background.
      const clearResult = opts.store.clearAllEmbeddings();
      if (!clearResult.ok) return clearResult;
    }
  } catch (error) {
    return err(elefantError(error));
  }

  // 6. Trigger reindex (fire-and-forget — the caller may await or ignore).
  const factory = opts.indexerFactory ?? ((ixOpts: IndexerOptions) => new IndexerService(ixOpts));
  const indexer = factory({
    projectPath: opts.projectPath,
    projectId: opts.projectId,
    provider: newProvider,
  });
  void indexer.bulkIndex();

  return ok({ event, reindexStarted: true });
}
