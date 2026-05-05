import { resolve } from 'node:path';

import { MAX_BYTES } from './types.ts';
import type { InstructionService, LoadedInstruction } from './types.ts';
import { resolveForFile as findForFile, resolveRoot as findRoot } from './resolver.ts';

// ---------------------------------------------------------------------------
// Module-level mtime-keyed content cache (singleton per process)
// ---------------------------------------------------------------------------

interface CacheEntry {
	mtimeMs: number;
	content: string;
}

const cache = new Map<string, CacheEntry>();

/**
 * Read an instruction file with mtime-keyed caching.
 *
 * Creates a BunFile handle for fresh mtime retrieval, compares against the
 * module-level cache, and re-reads only when the mtime has changed.
 *
 * Content is capped at {@link MAX_BYTES} (32 KiB) with a clear truncation
 * marker appended when exceeded.  Returns an empty string if the file is
 * missing or unreadable — callers never see an exception from this function.
 */
export async function loadContent(absPath: string): Promise<string> {
	try {
		const file = Bun.file(absPath);
		const stat = await file.stat();
		const mtimeMs = stat.mtimeMs;

		const cached = cache.get(absPath);
		if (cached && cached.mtimeMs === mtimeMs) return cached.content;

		const raw = await file.text();
		const content =
			raw.length > MAX_BYTES
				? raw.slice(0, MAX_BYTES) + '\n…[truncated]…\n'
				: raw;

		cache.set(absPath, { mtimeMs, content });
		return content;
	} catch {
		return '';
	}
}

/**
 * Drop a single cached entry so the next read for `absPath` hits disk.
 * The path is resolved before deletion to match the key used by loadContent.
 */
export function invalidate(absPath: string): void {
	cache.delete(resolve(absPath));
}

/** Clear the entire in-memory cache (for tests / config reload). */
export function invalidateAll(): void {
	cache.clear();
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

/**
 * Create an {@link InstructionService} bound to a specific project root.
 *
 * The returned service uses the mtime-keyed cache for content reads and
 * delegates path resolution to the hierarchical resolver from T1.2.
 *
 * The `Instructions from: <path>\n` prefix on loaded content matches the
 * OpenCode convention for system-prompt / system-reminder injection.
 */
export function createInstructionService(projectRoot: string): InstructionService {
	const root = resolve(projectRoot);

	return {
		async resolveRoot() {
			const found = await findRoot(root);
			if (!found) return null;

			const content = await loadContent(found.filepath);
			if (!content) return null;

			return {
				filepath: found.filepath,
				content: `Instructions from: ${found.filepath}\n${content}`,
			};
		},

		async resolveForFile(filepath, alreadyLoaded) {
			const entries = await findForFile(filepath, root, alreadyLoaded);
			const results: LoadedInstruction[] = [];

			for (const entry of entries) {
				const content = await loadContent(entry.filepath);
				if (content) {
					results.push({
						filepath: entry.filepath,
						content: `Instructions from: ${entry.filepath}\n${content}`,
					});
				}
			}

			return results;
		},

		invalidate(absPath) {
			invalidate(absPath);
		},

		invalidateAll() {
			invalidateAll();
		},
	};
}
