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
import { createInstructionService } from '../instruction/loader.ts';
import type { InstructionService } from '../instruction/types.ts';

export interface PkbHookOptions {
	/** Absolute path to the project root used to resolve PROJECT_KNOWLEDGE_BASE.md. */
	readonly projectPath: string;
	/** Override for tests; defaults to Bun's file API. */
	readonly readFile?: (path: string) => Promise<string | null>;
	/** Optional pre-created instruction service for root AGENTS.md/CLAUDE.md loading. */
	readonly instructionService?: InstructionService;
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
	const instruction =
		options.instructionService ?? createInstructionService(options.projectPath);

	return async (ctx: HookContextMap['context:transform']) => {
		try {
			const content = await read(pkbPath);
			if (content !== null && content.trim().length > 0) {
				ctx.system.push(`## Project Knowledge Base\n\n${content.trim()}`);
			}
		} catch {
			// PKB load failure should never block agent dispatch.
		}

		try {
			const rootInstruction = await instruction.resolveRoot();
			if (rootInstruction) {
				ctx.system.push(rootInstruction.content);
			}
		} catch {
			// Root instruction load failure should never block agent dispatch.
		}
	};
}
