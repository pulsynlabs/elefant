// AGENTS.md / CLAUDE.md instruction context types
//
// Defines the contract surface for lazy hierarchical instruction-file loading.
// T1.2 (resolver.ts) and T1.3 (loader.ts) implement these interfaces.

export const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md'] as const;

/** Maximum bytes allowed for any single instruction file (per Codex). */
export const MAX_BYTES = 32 * 1024; // 32KiB

/** Target line count for writer-generated AGENTS.md (per Claude Code guidance). */
export const LINE_TARGET = 200;

/** A loaded instruction file ready for injection. */
export interface LoadedInstruction {
	readonly filepath: string;
	readonly content: string;
}

/** Service contract for hierarchical instruction-file loading. */
export interface InstructionService {
	/**
	 * Load the root instruction file for a project.
	 * Called at session start. Returns null if neither AGENTS.md nor CLAUDE.md
	 * is found at the project root.
	 */
	resolveRoot(): Promise<LoadedInstruction | null>;

	/**
	 * Walk ancestors of `filepath` up to projectRoot, returning newly-found
	 * instruction files that are not in `alreadyLoaded`.
	 *
	 * Files closer to `filepath` (leaf) appear later in the returned array
	 * so positional-recency overrides work correctly.
	 */
	resolveForFile(
		filepath: string,
		alreadyLoaded: ReadonlySet<string>,
	): Promise<LoadedInstruction[]>;

	/**
	 * Invalidate cached content for a specific absolute path.
	 * Called after the writer subagent updates an AGENTS.md / CLAUDE.md file.
	 */
	invalidate(absPath: string): void;

	/** Clear the entire loader cache (for tests / config reload). */
	invalidateAll(): void;
}

export interface ManifestInfo {
	name?: string;
	description?: string;
	scripts?: Record<string, string>;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	workspaces?: string[];
}

export interface CodebaseDigest {
	/** Absolute project root path */
	projectRoot: string;
	/** Parsed package.json / equivalent manifest, if present */
	manifest: ManifestInfo | null;
	/** Scripts from manifest (build, test, lint, etc.) */
	scripts: Record<string, string>;
	/** Whether this appears to be a monorepo (has workspaces) */
	isMonorepo: boolean;
	/** Monorepo package paths if detected */
	monorepoPackages: string[];
	/** Existing instruction file content (AGENTS.md or CLAUDE.md), if any */
	existingInstruction: { filepath: string; content: string } | null;
	/** Key config file paths present (tsconfig, vite.config, playwright.config, etc.) */
	configFiles: string[];
	/** CI workflow files present (.github/workflows/*.yml) */
	ciFiles: string[];
	/** README content (first 500 chars), if any */
	readmeSummary: string | null;
	/** Language/runtime signals */
	stack: {
		typescript: boolean;
		bun: boolean;
		node: boolean;
		hasTests: boolean;
		testFramework: 'playwright' | 'vitest' | 'jest' | 'bun' | 'unknown';
	};
}
