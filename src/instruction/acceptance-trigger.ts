// Acceptance trigger — invokes the Writer subagent when a workflow is confirmed.
// Respects the agentsMd.autoUpdate config gate.

import type { HookRegistry } from '../hooks/registry.ts';
import type { ConfigManager } from '../config/loader.ts';
import { analyzeCodebase } from './codebase-analysis.ts';
import type { InstructionService } from './types.ts';

export interface AcceptanceTriggerDeps {
	hookRegistry: HookRegistry;
	configManager: ConfigManager;
	instructionService: InstructionService;
	projectRoot: string;
	/** Spawn a writer task (abstracted for testability) */
	spawnWriter: (prompt: {
		mode: 'update';
		projectRoot: string;
		codebaseDigest: unknown;
		priorContent: string | null;
		chronicleSummary?: string;
	}) => Promise<void>;
}

/**
 * Register the spec:acceptance_confirmed handler on the hook registry.
 * Returns a disposer to unregister.
 */
export function registerAcceptanceTrigger(deps: AcceptanceTriggerDeps): () => void {
	return deps.hookRegistry.on('spec:acceptance_confirmed', async (_ctx) => {
		// Check agentsMd.autoUpdate toggle
		try {
			const configResult = await deps.configManager.getConfig();
			if (configResult.ok) {
				const autoUpdate = configResult.data.agentsMd?.autoUpdate ?? true;
				if (!autoUpdate) return; // disabled, skip
			} else {
				// Config read failed → skip (fail-open for safety)
				return;
			}
		} catch {
			// Config read failure → skip (fail-open for safety)
			return;
		}

		// Run codebase analysis
		const codebaseDigest = await analyzeCodebase(deps.projectRoot);

		// Read existing AGENTS.md if present
		let priorContent: string | null = null;
		try {
			const existing = await deps.instructionService.resolveRoot();
			priorContent = existing?.content ?? null;
		} catch {
			// Ignore
		}

		// Spawn writer
		await deps.spawnWriter({
			mode: 'update',
			projectRoot: deps.projectRoot,
			codebaseDigest,
			priorContent,
		});
	});
}
