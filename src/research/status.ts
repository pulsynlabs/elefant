import { existsSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { researchIndexPath, researchBaseDir } from '../project/paths.js';
import { ok, err, type Result } from '../types/result.js';
import type { ElefantError } from '../types/errors.js';
import type { ResearchStore } from './store.js';
import type { EmbeddingProvider, EmbeddingProviderName } from './embeddings/provider.js';
import type { HardwareProfile, RecommendedTier } from './hardware.js';

export interface ResearchStatus {
  projectId: string;
  provider: EmbeddingProviderName;
  providerIsLocal: boolean;
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
 * Get the latest updated timestamp from research_chunks.
 */
function getLastIndexedAt(store: ResearchStore): string | null {
  try {
    // Access the private db through the store instance
    // We need to use a query method on the store
    const result = (store as unknown as { 
      db: { query: (sql: string) => { get: () => unknown } } 
    }).db.query('SELECT MAX(updated) as latest FROM research_chunks').get();
    
    if (result && typeof result === 'object' && result !== null) {
      const latest = (result as { latest: string | null }).latest;
      return latest ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getResearchStatus(opts: {
  projectPath: string;
  projectId: string;
  store: ResearchStore | null;
  provider: EmbeddingProvider;
  hardware?: HardwareProfile;
}): Promise<Result<ResearchStatus, ElefantError>> {
  try {
    const { projectPath, projectId, store, provider, hardware } = opts;

    // Check if index exists
    const indexPath = researchIndexPath(projectPath);
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
      const markdownDir = researchBaseDir(projectPath);
      const { files, exceeded } = collectMarkdownFiles(markdownDir, DRIFT_SCAN_MAX_FILES);
      
      if (exceeded) {
        driftCount = -1;
        console.warn(`[getResearchStatus] Drift scan exceeded ${DRIFT_SCAN_MAX_FILES} files; returning -1 for driftCount`);
      } else {
        driftCount = countDriftedFiles(files, lastIndexedAt);
      }
    }

    // Build status object
    const status: ResearchStatus = {
      projectId,
      provider: provider.name,
      providerIsLocal: provider.isLocal,
      embeddingDim: provider.dim(),
      vectorEnabled: provider.name !== 'disabled',
      recommendedTier: hardware ? recommendTier(hardware) : null,
      hardware: hardware ?? null,
      totalDocs,
      totalChunks,
      lastIndexedAt,
      driftCount,
      diskSizeBytes,
      indexExists,
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
