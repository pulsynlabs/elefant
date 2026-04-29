// PROJECT_KNOWLEDGE_BASE.md context injector
//
// Reads the project's PKB (if present) and pushes it onto the system prompt
// stack handed to every agent dispatch. Wired via the daemon's hookRegistry as
// a `context:transform` handler. No-op when the file is absent so projects
// without a PKB see zero behavior change (AVC10).
//
// Caching: PKB is read on every transform — most projects have small (<10KB)
// PKBs and dispatches are infrequent enough that disk reads are not a hot path.
// The 5s TTL described in the BLUEPRINT is deferred to a follow-up if profiling
// shows it matters.

import { join } from 'node:path';
import type { HookContextMap, HookHandler } from './types.ts';

export interface PkbHookOptions {
	/** Absolute path to the project root used to resolve PROJECT_KNOWLEDGE_BASE.md. */
	readonly projectPath: string;
	/** Override for tests; defaults to Bun's file API. */
	readonly readFile?: (path: string) => Promise<string | null>;
}

async function defaultReadFile(path: string): Promise<string | null> {
	const file = Bun.file(path);
	if (!(await file.exists())) return null;
	return file.text();
}

/**
 * Build a `context:transform` handler that injects PROJECT_KNOWLEDGE_BASE.md
 * content into the system prompt array. The handler mutates `ctx.system`
 * in place so the change survives without needing a return value.
 */
export function createPkbContextTransformHandler(
	options: PkbHookOptions,
): HookHandler<'context:transform'> {
	const read = options.readFile ?? defaultReadFile;
	const pkbPath = join(options.projectPath, '.goopspec', 'PROJECT_KNOWLEDGE_BASE.md');

	return async (ctx: HookContextMap['context:transform']) => {
		try {
			const content = await read(pkbPath);
			if (content === null || content.trim().length === 0) return;
			ctx.system.push(`## Project Knowledge Base\n\n${content.trim()}`);
		} catch {
			// PKB load failure should never block agent dispatch.
		}
	};
}
