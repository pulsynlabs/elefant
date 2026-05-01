/**
 * Skill resolver — resolve SKILL.md files from project, user, or built-in tiers.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { parseFrontmatter } from './frontmatter.js';

export interface SkillInfo {
	name: string;
	description: string; // frontmatter description or first non-blank body line
	source: 'project' | 'user' | 'builtin';
	path: string;
}

/**
 * Extract the skill description from SKILL.md content.
 *
 * 1. Prefer the YAML frontmatter `description` field (parsed by parseFrontmatter).
 * 2. When frontmatter exists with no description, extract the first non-blank
 *    body line after the closing `---`.
 * 3. When no valid frontmatter is present, skip any stray `---` lines and
 *    return the first non-blank line of the content.
 * 4. Return `(no description)` sentinel when content has only blank lines.
 */
function extractDescription(content: string): string {
	const { description, raw } = parseFrontmatter(content);

	// Priority 1: explicit description field from frontmatter
	if (description) return description;

	if (raw !== null) {
		// Priority 2: valid frontmatter block but no description field —
		// extract the body after the closing --- delimiter
		const lines = content.split('\n');
		let delimiterCount = 0;

		for (let i = 0; i < lines.length; i++) {
			if (lines[i].trim() === '---') {
				delimiterCount++;
				if (delimiterCount === 2) {
					// Scan body lines after the closing --- for first non-blank
					for (let j = i + 1; j < lines.length; j++) {
						const trimmed = lines[j].trim();
						if (trimmed.length > 0) return trimmed;
					}
					return '(no description)';
				}
			}
		}
		return '(no description)';
	}

	// Priority 3: no valid frontmatter (absent or malformed) —
	// skip any stray --- lines and take first non-blank line
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (trimmed === '---') continue;
		if (trimmed.length > 0) return trimmed;
	}
	return '(no description)';
}

/**
 * Resolve skill in priority order:
 * 1. .elefant/skills/<name>/SKILL.md         (project — Elefant)
 * 2. .claude/skills/<name>/SKILL.md          (project — Claude-compatible)
 * 3. .agents/skills/<name>/SKILL.md          (project — agents-compatible)
 * 4. ~/.config/elefant/skills/<name>/SKILL.md (user — Elefant)
 * 5. ~/.agents/skills/<name>/SKILL.md        (user — agents-compatible)
 * 6. ~/.claude/skills/<name>/SKILL.md        (user — Claude-compatible)
 * 7. <import.meta.dir>/builtin/<name>/SKILL.md (bundled)
 */
export async function resolveSkill(
	name: string,
): Promise<{ path: string; content: string } | null> {
	const cwd = process.cwd();
	const home = homedir();

	const candidates = [
		join(cwd, '.elefant', 'skills', name, 'SKILL.md'),
		join(cwd, '.claude', 'skills', name, 'SKILL.md'),
		join(cwd, '.agents', 'skills', name, 'SKILL.md'),
		join(home, '.config', 'elefant', 'skills', name, 'SKILL.md'),
		join(home, '.agents', 'skills', name, 'SKILL.md'),
		join(home, '.claude', 'skills', name, 'SKILL.md'),
		join(import.meta.dir, 'builtin', name, 'SKILL.md'),
	];

	for (const candidate of candidates) {
		const file = Bun.file(candidate);
		if (await file.exists()) {
			const content = await file.text();
			return { path: candidate, content };
		}
	}
	return null;
}

/**
 * Scan a directory for skill subdirectories containing SKILL.md files.
 */
async function scanSkillDir(
	dirPath: string,
	source: SkillInfo['source'],
): Promise<SkillInfo[]> {
	const skills: SkillInfo[] = [];

	try {
		const entries = readdirSync(dirPath, { withFileTypes: true });

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;

			const skillPath = join(dirPath, entry.name, 'SKILL.md');
			const file = Bun.file(skillPath);

			if (await file.exists()) {
				const content = await file.text();
				skills.push({
					name: entry.name,
					description: extractDescription(content),
					source,
					path: skillPath,
				});
			}
		}
	} catch {
		// Directory doesn't exist or can't be read — return empty array
	}

	return skills;
}

/** Overrides for listSkills to enable testability. */
export interface ListSkillsOptions {
	/** Override `process.cwd()` — defaults to `process.cwd()`. */
	cwd?: string;
	/** Override `homedir()` — defaults to `homedir()`. */
	home?: string;
}

/**
 * Skill directory entries in priority order (highest first).
 * Project-level paths all map to `'project'`; user-level to `'user'`; builtin to `'builtin'`.
 */
function skillSearchDirs(
	cwd: string,
	home: string,
): Array<{ path: string; source: SkillInfo['source'] }> {
	return [
		{ path: join(cwd, '.elefant', 'skills'), source: 'project' },
		{ path: join(cwd, '.claude', 'skills'), source: 'project' },
		{ path: join(cwd, '.agents', 'skills'), source: 'project' },
		{ path: join(home, '.config', 'elefant', 'skills'), source: 'user' },
		{ path: join(home, '.agents', 'skills'), source: 'user' },
		{ path: join(home, '.claude', 'skills'), source: 'user' },
		{ path: join(import.meta.dir, 'builtin'), source: 'builtin' },
	];
}

/**
 * List all available skills across all tiers.
 * Deduplicates by name (project overrides user overrides builtin).
 */
export async function listSkills(
	opts: ListSkillsOptions = {},
): Promise<SkillInfo[]> {
	const cwd = opts.cwd ?? process.cwd();
	const home = opts.home ?? homedir();

	const dirs = skillSearchDirs(cwd, home);

	// Scan directories in priority order. First found for a name wins.
	const skillMap = new Map<string, SkillInfo>();

	for (const { path: dirPath, source } of dirs) {
		const skills = await scanSkillDir(dirPath, source);
		for (const skill of skills) {
			if (!skillMap.has(skill.name)) {
				skillMap.set(skill.name, skill);
			}
		}
	}

	// Return sorted by name for consistent output
	return Array.from(skillMap.values()).sort((a, b) =>
		a.name.localeCompare(b.name),
	);
}
