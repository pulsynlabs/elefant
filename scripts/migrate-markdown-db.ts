#!/usr/bin/env bun
/**
 * Migration script: Rewrite prescriptive references from legacy `markdown-db/`
 * to new per-project `.elefant/markdown-db/` location.
 *
 * Leaves the Elefant monorepo's own legacy seed at `markdown-db/` untouched.
 *
 * Usage:
 *   bun run scripts/migrate-markdown-db.ts --dry-run
 *   bun run scripts/migrate-markdown-db.ts --apply
 *   bun run scripts/migrate-markdown-db.ts --root /path/to/repo --dry-run
 */

import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { ok, err, type Result } from "../src/types/result.js";
import type { ElefantError } from "../src/types/errors.js";

export interface PlannedChange {
	file: string;
	line: number;
	before: string;
	after: string;
	reason: string;
}

interface MigrationOptions {
	root: string;
	verbose?: boolean;
}

// Files to scan for migration
const SCAN_PATTERNS = [
	{ path: "src/agents/prompts", recursive: true, extension: ".md" },
	{ path: "docs", recursive: true, extension: ".md", exclude: /^docs\/adr\// },
	{ path: "README.md", recursive: false, extension: null },
	{ path: "AGENTS.md", recursive: false, extension: null },
];

// Patterns that indicate prescriptive references (should be rewritten)
// Note: No global flag (g) to avoid lastIndex state issues across tests
const PRESCRIPTIVE_PATTERNS = [
	// Phrases that prescribe where research should go
	/save\s+(?:your\s+)?(?:research\s+)?(?:findings|notes)?\s*(?:to|in)\s+[`']?markdown-db\//i,
	/research\s+(?:is\s+)?stored\s+(?:in|at)\s+[`']?markdown-db\//i,
	/(?:see|check|refer\s+to)\s+[`']?markdown-db\//i,
	/(?:place|put|write)\s+(?:your\s+)?(?:findings|research)\s+(?:in|to)\s+[`']?markdown-db\//i,
	/(?:create|add)\s+(?:files?|research)\s+(?:in|under)\s+[`']?markdown-db\//i,
	/(?:documentation|docs?)\s+(?:goes?|belongs?)\s+(?:in|under)\s+[`']?markdown-db\//i,
];

// Patterns that indicate descriptive/historical references (should NOT be rewritten)
// Note: No global flag (g) to avoid lastIndex state issues across tests
const DESCRIPTIVE_PATTERNS = [
	/legacy\s+seed/i,
	/this\s+repo(?:'s)?\s+research\s+seed/i,
	/elefant(?:-)?monorepo/i,
	/historical\s+reference/i,
	/original\s+research\s+base/i,
];

// Regex to match markdown-db/ references (for replacement)
const MARKDOWN_DB_REGEX = /markdown-db\//g;

function createError(code: string, message: string, details?: unknown): ElefantError {
	return {
		code: code as ElefantError["code"],
		message,
		details,
	};
}

/**
 * Check if a line contains prescriptive language about markdown-db/
 */
function isPrescriptiveReference(line: string): boolean {
	return PRESCRIPTIVE_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Check if a line contains descriptive/historical language (should not rewrite)
 */
function isDescriptiveReference(line: string): boolean {
	return DESCRIPTIVE_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Check if a markdown-db/ reference in this line points to an actual file
 */
async function resolvesToRealFile(
	line: string,
	rootDir: string,
): Promise<boolean> {
	// Extract potential file paths from the line
	const matches = line.match(/markdown-db\/[^\s`'"\]\)]+/g);
	if (!matches) return false;

	for (const match of matches) {
		const potentialPath = join(rootDir, match);
		try {
			const stats = await statSync(potentialPath);
			if (stats.isFile()) {
				return true;
			}
		} catch {
			// File doesn't exist, continue checking other matches
		}
	}

	return false;
}

/**
 * Determine if a line should be rewritten
 */
async function shouldRewriteLine(
	line: string,
	filePath: string,
	rootDir: string,
	verbose?: boolean,
): Promise<{ shouldRewrite: boolean; reason: string }> {
	// Must contain markdown-db/ reference
	if (!line.includes("markdown-db/")) {
		return { shouldRewrite: false, reason: "No markdown-db/ reference" };
	}

	// Skip ADR files entirely (they're historical records)
	if (filePath.includes("/adr/") || filePath.includes("\\adr\\")) {
		return { shouldRewrite: false, reason: "ADR file (historical record)" };
	}

	// Check for descriptive/historical language
	if (isDescriptiveReference(line)) {
		return { shouldRewrite: false, reason: "Descriptive/historical reference" };
	}

	// Check if it resolves to a real file in the legacy seed
	if (await resolvesToRealFile(line, rootDir)) {
		return { shouldRewrite: false, reason: "Resolves to real file in legacy seed" };
	}

	// Check for prescriptive language
	if (isPrescriptiveReference(line)) {
		return { shouldRewrite: true, reason: "Prescriptive reference" };
	}

	// Default: conservative - don't rewrite if unclear
	return { shouldRewrite: false, reason: "Not clearly prescriptive" };
}

/**
 * Scan a single file and return planned changes
 */
async function scanFile(
	filePath: string,
	rootDir: string,
	verbose?: boolean,
): Promise<PlannedChange[]> {
	const changes: PlannedChange[] = [];
	const content = await readFile(filePath, "utf-8");
	const lines = content.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineNumber = i + 1;

		const { shouldRewrite, reason } = await shouldRewriteLine(
			line,
			filePath,
			rootDir,
			verbose,
		);

		if (verbose) {
			console.log(`  [${relative(rootDir, filePath)}:${lineNumber}] ${shouldRewrite ? "REWRITE" : "SKIP"} (${reason})`);
		}

		if (shouldRewrite) {
			const after = line.replace(MARKDOWN_DB_REGEX, ".elefant/markdown-db/");
			if (after !== line) {
				changes.push({
					file: filePath,
					line: lineNumber,
					before: line,
					after,
					reason,
				});
			}
		}
	}

	return changes;
}

/**
 * Recursively find files matching a pattern
 */
async function findFiles(
	dir: string,
	extension: string | null,
	recursive: boolean,
	exclude?: RegExp,
): Promise<string[]> {
	const files: string[] = [];

	if (!existsSync(dir)) {
		return files;
	}

	const entries = await readdir(dir, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = join(dir, entry.name);

		if (entry.isDirectory() && recursive) {
			// Check exclusion pattern
			if (exclude && exclude.test(fullPath)) {
				continue;
			}
			const subFiles = await findFiles(fullPath, extension, recursive, exclude);
			files.push(...subFiles);
		} else if (entry.isFile()) {
			if (extension === null || entry.name.endsWith(extension)) {
				files.push(fullPath);
			}
		}
	}

	return files;
}

/**
 * Get all files to scan based on patterns
 */
async function getFilesToScan(rootDir: string): Promise<string[]> {
	const files: string[] = [];

	for (const pattern of SCAN_PATTERNS) {
		const fullPath = join(rootDir, pattern.path);

		if (pattern.extension === null) {
			// Single file pattern (README.md, AGENTS.md)
			if (existsSync(fullPath)) {
				files.push(fullPath);
			}
		} else {
			// Directory pattern
			const dirFiles = await findFiles(
				fullPath,
				pattern.extension,
				pattern.recursive,
				pattern.exclude,
			);
			files.push(...dirFiles);
		}
	}

	return files;
}

/**
 * Plan the migration without applying changes
 */
export async function planMigration(
	opts: MigrationOptions,
): Promise<Result<PlannedChange[], ElefantError>> {
	const { root, verbose } = opts;

	// Validate root exists
	if (!existsSync(root)) {
		return err(createError("FILE_NOT_FOUND", `Root directory does not exist: ${root}`));
	}

	const stat = statSync(root);
	if (!stat.isDirectory()) {
		return err(createError("VALIDATION_ERROR", `Root path is not a directory: ${root}`));
	}

	if (verbose) {
		console.log(`Planning migration for: ${root}`);
	}

	const files = await getFilesToScan(root);

	if (verbose) {
		console.log(`Found ${files.length} files to scan`);
	}

	const allChanges: PlannedChange[] = [];

	for (const file of files) {
		const changes = await scanFile(file, root, verbose);
		allChanges.push(...changes);
	}

	return ok(allChanges);
}

/**
 * Apply the planned migration changes
 */
export async function applyMigration(
	plan: PlannedChange[],
): Promise<Result<{ filesWritten: number; linesChanged: number }, ElefantError>> {
	if (plan.length === 0) {
		return ok({ filesWritten: 0, linesChanged: 0 });
	}

	// Group changes by file
	const changesByFile = new Map<string, PlannedChange[]>();
	for (const change of plan) {
		const existing = changesByFile.get(change.file) ?? [];
		existing.push(change);
		changesByFile.set(change.file, existing);
	}

	let filesWritten = 0;
	let linesChanged = 0;

	for (const [filePath, changes] of changesByFile) {
		// Read original content
		const content = await readFile(filePath, "utf-8");
		const lines = content.split("\n");

		// Apply changes (line numbers are 1-indexed)
		for (const change of changes) {
			const lineIndex = change.line - 1;
			if (lines[lineIndex] === change.before) {
				lines[lineIndex] = change.after;
				linesChanged++;
			} else {
				// Line has changed since planning - this shouldn't happen in dry-run mode
				return err(
					createError(
						"VALIDATION_ERROR",
						`Line ${change.line} in ${filePath} has changed since planning`,
						{ expected: change.before, actual: lines[lineIndex] },
					),
				);
			}
		}

		// Write back
		await writeFile(filePath, lines.join("\n"), "utf-8");
		filesWritten++;
	}

	return ok({ filesWritten, linesChanged });
}

/**
 * Print changes in unified-diff style
 */
function printDiff(changes: PlannedChange[], rootDir: string): void {
	if (changes.length === 0) {
		console.log("No changes planned.");
		return;
	}

	// Group by file
	const changesByFile = new Map<string, PlannedChange[]>();
	for (const change of changes) {
		const existing = changesByFile.get(change.file) ?? [];
		existing.push(change);
		changesByFile.set(change.file, existing);
	}

	for (const [filePath, fileChanges] of changesByFile) {
		const relPath = relative(rootDir, filePath);
		console.log(`\n--- ${relPath}`);
		console.log(`+++ ${relPath}`);

		for (const change of fileChanges) {
			console.log(`@@ -${change.line},1 +${change.line},1 @@`);
			console.log(`-${change.before}`);
			console.log(`+${change.after}`);
		}
	}

	console.log(`\n${changes.length} line(s) in ${changesByFile.size} file(s) would be changed.`);
}

/**
 * Print help message
 */
function printHelp(): void {
	console.log(`
Usage: bun run scripts/migrate-markdown-db.ts [options]

Options:
  --dry-run         Print planned changes; do not write
  --apply           Write changes
  --root <path>     Repo root (default: process.cwd())
  --verbose         Print every line considered
  --help            Show this help message

Examples:
  bun run scripts/migrate-markdown-db.ts --dry-run
  bun run scripts/migrate-markdown-db.ts --apply
  bun run scripts/migrate-markdown-db.ts --root /path/to/repo --dry-run --verbose
`);
}

/**
 * Parse CLI arguments
 */
function parseArgs(args: string[]): {
	dryRun: boolean;
	apply: boolean;
	root: string;
	verbose: boolean;
	help: boolean;
} {
	let dryRun = false;
	let apply = false;
	let root = process.cwd();
	let verbose = false;
	let help = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		switch (arg) {
			case "--dry-run":
				dryRun = true;
				break;
			case "--apply":
				apply = true;
				break;
			case "--root":
				if (i + 1 < args.length) {
					root = resolve(args[++i]);
				}
				break;
			case "--verbose":
				verbose = true;
				break;
			case "--help":
			case "-h":
				help = true;
				break;
		}
	}

	return { dryRun, apply, root, verbose, help };
}

// Main entry point
if (import.meta.main) {
	const args = parseArgs(Bun.argv.slice(2));

	if (args.help) {
		printHelp();
		process.exit(0);
	}

	if (!args.dryRun && !args.apply) {
		console.error("Error: Must specify either --dry-run or --apply");
		printHelp();
		process.exit(1);
	}

	const planResult = await planMigration({
		root: args.root,
		verbose: args.verbose,
	});

	if (!planResult.ok) {
		console.error(`Error: ${planResult.error.message}`);
		process.exit(1);
	}

	const plan = planResult.data;

	if (args.dryRun) {
		printDiff(plan, args.root);
		process.exit(0);
	}

	if (args.apply) {
		if (plan.length === 0) {
			console.log("No changes to apply.");
			process.exit(0);
		}

		const applyResult = await applyMigration(plan);

		if (!applyResult.ok) {
			console.error(`Error applying migration: ${applyResult.error.message}`);
			process.exit(1);
		}

		const { filesWritten, linesChanged } = applyResult.data;
		console.log(`Applied ${linesChanged} change(s) to ${filesWritten} file(s).`);
		process.exit(0);
	}
}
