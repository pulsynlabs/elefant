import { existsSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fieldNotesIndexPath, fieldNotesDir } from '../project/paths.js';
import { ok, err, type Result } from '../types/result.js';
import type { ElefantError } from '../types/errors.js';
import type { FieldNotesStore } from './store.js';
import type { EmbeddingProvider, EmbeddingProviderName, EmbeddingProviderConfig } from './embeddings/provider.js';
import type { HardwareProfile, RecommendedTier } from './hardware.js';
import { fieldNotesLog } from './log.js';

export interface FieldNotesStatus {
  projectId: string;
  provider: EmbeddingProviderName;
  providerIsLocal: boolean;
  embeddingProviderIsLocal: boolean;
  embeddingModelId: string | null;
  embeddingDim: number;
  vectorEnabled: boolean;
  recommendedTier: RecommendedTier | null;
  hardware: HardwareProfile | null;
  totalDocs: number;
  totalChunks: number;
  lastIndexedAt: string | null;
  driftCount: number;
  diskSizeBytes: number;
  indexExists: boolean;
  warnings: string[];
}

const DRIFT_SCAN_MAX_FILES = 10000;

function toError(error: unknown): ElefantError {
  return { code: 'TOOL_EXECUTION_FAILED', message: String(error), details: error };
}

/**
 * Recursively collect all .md files under a directory.
 * Returns null if the scan exceeds the file limit.
 */
function collectMarkdownFiles(dir: string, maxFiles: number, currentCount: number = 0): { files: string[]; exceeded: boolean } {
  const files: string[] = [];
  let count = currentCount;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      
      if (entry.isDirectory()) {
        const result = collectMarkdownFiles(fullPath, maxFiles, count);
        if (result.exceeded) {
          return { files: [], exceeded: true };
        }
        files.push(...result.files);
        count += result.files.length;
        if (count > maxFiles) {
          return { files: [], exceeded: true };
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
        count += 1;
        if (count > maxFiles) {
          return { files: [], exceeded: true };
        }
      }
    }
  } catch {
    // Directory might not exist or be accessible; skip silently
  }

  return { files, exceeded: false };
}

/**
 * Count files modified after the given timestamp.
 */
function countDriftedFiles(files: string[], lastIndexedAt: string): number {
  const lastIndexed = new Date(lastIndexedAt).getTime();
  let count = 0;

  for (const file of files) {
    try {
      const stats = statSync(file);
      if (stats.mtime.getTime() > lastIndexed) {
        count += 1;
      }
    } catch {
      // Skip files we can't stat
    }
  }

  return count;
}

/**
 * Get the latest updated timestamp from field_notes_chunks.
 */
function getLastIndexedAt(store: FieldNotesStore): string | null {
  try {
    // Access the private db through the store instance
    // We need to use a query method on the store
    const result = (store as unknown as { 
      db: { query: (sql: string) => { get: () => unknown } } 
    }).db.query('SELECT MAX(updated) as latest FROM field_notes_chunks').get();
    
    if (result && typeof result === 'object' && result !== null) {
      const latest = (result as { latest: string | null }).latest;
      return latest ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getFieldNotesStatus(opts: {
  projectPath: string;
  projectId: string;
  store: FieldNotesStore | null;
  provider: EmbeddingProvider;
  hardware?: HardwareProfile;
}): Promise<Result<FieldNotesStatus, ElefantError>> {
  try {
    const { projectPath, projectId, store, provider, hardware } = opts;

    // Check if index exists
    const indexPath = fieldNotesIndexPath(projectPath);
    const indexExists = existsSync(indexPath);

    // Get store metrics
    const totalDocs = store?.totalDocs() ?? 0;
    const totalChunks = store?.totalChunks() ?? 0;
    const diskSizeBytes = store?.diskSizeBytes() ?? 0;

    // Get last indexed timestamp
    const lastIndexedAt = store ? getLastIndexedAt(store) : null;

    // Calculate drift
    let driftCount = 0;
    if (lastIndexedAt !== null) {
      const markdownDir = fieldNotesDir(projectPath);
      const { files, exceeded } = collectMarkdownFiles(markdownDir, DRIFT_SCAN_MAX_FILES);
      
      if (exceeded) {
        driftCount = -1;
        fieldNotesLog.warn('Drift scan exceeded max files; returning -1 for driftCount', { maxFiles: DRIFT_SCAN_MAX_FILES });
      } else {
        driftCount = countDriftedFiles(files, lastIndexedAt);
      }
    }

    // Build warnings
    const warnings: string[] = [];
    const vectorEnabled = provider.name !== 'disabled';
    if (vectorEnabled && !provider.isLocal) {
      warnings.push('Embeddings are sent to an external service');
    }
    if (driftCount > 0) {
      warnings.push(`${driftCount} file(s) modified since last index — consider reindexing`);
    }
    if (diskSizeBytes > 500_000_000) {
      const mb = Math.round(diskSizeBytes / (1024 * 1024));
      warnings.push(`Field notes index is large (${mb}MB) — consider running VACUUM`);
    }

    // Determine embedding model ID (for bundled providers, use the default model; for remote, null)
    const embeddingModelId = getEmbeddingModelId(provider);

    // Build status object
    const status: FieldNotesStatus = {
      projectId,
      provider: provider.name,
      providerIsLocal: provider.isLocal,
      embeddingProviderIsLocal: provider.isLocal,
      embeddingModelId,
      embeddingDim: provider.dim(),
      vectorEnabled,
      recommendedTier: hardware ? recommendTier(hardware) : null,
      hardware: hardware ?? null,
      totalDocs,
      totalChunks,
      lastIndexedAt,
      driftCount,
      diskSizeBytes,
      indexExists,
      warnings,
    };

    return ok(status);
  } catch (error) {
    return err(toError(error));
  }
}

// Import recommendTier from hardware module to avoid circular dependency issues
function recommendTier(profile: HardwareProfile): RecommendedTier {
  if (profile.ramGB >= 16 && (profile.hasGPU || profile.hasNPU)) {
    return 'bundled-large';
  }
  if (profile.hasGPU) {
    return 'bundled-gpu';
  }
  return 'bundled-cpu';
}

/**
 * Get the embedding model ID for the provider.
 * For bundled providers, returns the default model ID.
 * For remote providers, returns null (model is configurable but not exposed here).
 */
function getEmbeddingModelId(provider: EmbeddingProvider): string | null {
  // Bundled providers use specific models
  if (provider.name === 'bundled-cpu') {
    return 'Xenova/all-MiniLM-L6-v2';
  }
  if (provider.name === 'bundled-gpu') {
    return 'Xenova/all-MiniLM-L6-v2';
  }
  if (provider.name === 'bundled-large') {
    return 'Xenova/bge-base-en-v1.5';
  }
  // Remote providers don't expose their model ID through the provider interface
  // The caller should use config.model if needed
  return null;
}
