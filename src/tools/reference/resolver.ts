/**
 * Reference resolver — resolve <name>.md files from project, user, or built-in tiers.
 *
 * References are flat markdown files (unlike skills which use directory-based layout).
 * Resolution order (highest priority first):
 *   1. .elefant/references/<name>.md          (project-level)
 *   2. ~/.config/elefant/references/<name>.md  (user-level)
 *   3. src/agents/references/<name>.md         (builtin — via import.meta.dir)
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';

export interface ReferenceInfo {
	name: string; // filename without .md extension
	description: string; // from frontmatter or first-line fallback
	source: 'project' | 'user' | 'builtin';
	path: string;
}

/** Overrides for listReferences / resolveReference to enable testability. */
export interface ListReferencesOptions {
	/** Override `process.cwd()` — defaults to `process.cwd()`. */
	cwd?: string;
	/** Override `homedir()` — defaults to `homedir()`. */
	home?: string;
}

// ---------------------------------------------------------------------------
// Description extraction
// ---------------------------------------------------------------------------

/**
 * Extract a human-readable description from reference content.
 *
 * Strategy (simple scan, full frontmatter parsing lands in Wave 2):
 *   1. If content starts with `---` frontmatter delimiters, look for a
 *      `description: <value>` line between the open and close `---` lines.
 *      Strip surrounding quotes if present.
 *   2. Fallback: first non-blank, non-`---` line of the file.
 *   3. Return `(no description)` sentinel when no text is found.
 */
function extractDescription(content: string): string {
	// Frontmatter scan — content must start with --- followed by newline
	const startsWithDelimiter =
		content.startsWith('---\n') || content.startsWith('---\r\n');

	if (startsWithDelimiter) {
		const delimLen = content.startsWith('---\r\n') ? 5 : 4;
		const afterOpen = content.slice(delimLen);
		const lines = afterOpen.split(/\r?\n/);

		let inFrontmatter = true;

		for (const line of lines) {
			if (line === '---') {
				inFrontmatter = false;
				continue;
			}

			if (inFrontmatter) {
				const trimmed = line.trim();
				if (trimmed.startsWith('description:')) {
					let value = trimmed.slice('description:'.length).trim();
					// Strip surrounding quotes (single or double)
					if (
						(value.startsWith('"') && value.endsWith('"')) ||
						(value.startsWith("'") && value.endsWith("'"))
					) {
						value = value.slice(1, -1);
					}
					if (value.length > 0) return value;
				}
			} else {
				// Body after frontmatter — first non-blank line wins
				const trimmed = line.trim();
				if (trimmed.length > 0) return trimmed;
			}
		}

		return '(no description)';
	}

	// No frontmatter — first non-blank, non-`---` line wins
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (trimmed === '---') continue;
		if (trimmed.length > 0) return trimmed;
	}

	return '(no description)';
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a single reference by name.
 *
 * Returns the highest-priority match across project → user → builtin tiers,
 * or `null` when no matching `<name>.md` file exists in any tier.
 */
export async function resolveReference(
	name: string,
	opts: ListReferencesOptions = {},
): Promise<{
	path: string;
	content: string;
	source: ReferenceInfo['source'];
} | null> {
	const cwd = opts.cwd ?? process.cwd();
	const home = opts.home ?? homedir();

	const candidates: Array<{ path: string; source: ReferenceInfo['source'] }> = [
		{
			path: join(cwd, '.elefant', 'references', `${name}.md`),
			source: 'project',
		},
		{
			path: join(home, '.config', 'elefant', 'references', `${name}.md`),
			source: 'user',
		},
		{
			path: join(
				import.meta.dir,
				'..',
				'..',
				'agents',
				'references',
				`${name}.md`,
			),
			source: 'builtin',
		},
	];

	for (const { path, source } of candidates) {
		const file = Bun.file(path);
		if (await file.exists()) {
			const content = await file.text();
			return { path, content, source };
		}
	}

	return null;
}

// ---------------------------------------------------------------------------
// Directory scanning
// ---------------------------------------------------------------------------

/**
 * Scan a single directory for `*.md` files and return `ReferenceInfo` entries.
 * Silently returns an empty array when the directory is missing or unreadable.
 */
async function scanReferenceDir(
	dirPath: string,
	source: ReferenceInfo['source'],
): Promise<ReferenceInfo[]> {
	const refs: ReferenceInfo[] = [];

	try {
		const entries = readdirSync(dirPath, { withFileTypes: true });

		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

			const refPath = join(dirPath, entry.name);
			const file = Bun.file(refPath);

			if (await file.exists()) {
				const content = await file.text();
				const name = entry.name.slice(0, -3); // strip trailing ".md"
				refs.push({
					name,
					description: extractDescription(content),
					source,
					path: refPath,
				});
			}
		}
	} catch {
		// Directory doesn't exist or can't be read — return empty array
	}

	return refs;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/**
 * List all available references across all three tiers.
 *
 * Deduplicates by name: when the same reference name exists in multiple tiers,
 * the highest-priority tier wins (project > user > builtin).
 *
 * Returns results sorted alphabetically by name for consistent output.
 */
export async function listReferences(
	opts: ListReferencesOptions = {},
): Promise<ReferenceInfo[]> {
	const cwd = opts.cwd ?? process.cwd();
	const home = opts.home ?? homedir();

	const dirs: Array<{ path: string; source: ReferenceInfo['source'] }> = [
		{ path: join(cwd, '.elefant', 'references'), source: 'project' },
		{ path: join(home, '.config', 'elefant', 'references'), source: 'user' },
		{
			path: join(import.meta.dir, '..', '..', 'agents', 'references'),
			source: 'builtin',
		},
	];

	const refMap = new Map<string, ReferenceInfo>();

	for (const { path: dirPath, source } of dirs) {
		const refs = await scanReferenceDir(dirPath, source);
		for (const ref of refs) {
			if (!refMap.has(ref.name)) {
				refMap.set(ref.name, ref);
			}
		}
	}

	return Array.from(refMap.values()).sort((a, b) =>
		a.name.localeCompare(b.name),
	);
}
