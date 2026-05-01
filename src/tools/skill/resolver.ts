/**
 * Skill resolver — resolve SKILL.md files from project, user, or built-in tiers.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';

export interface SkillInfo {
	name: string;
	description: string; // first non-blank line of SKILL.md
	source: 'project' | 'user' | 'builtin';
	path: string;
}

/**
 * Extract the first non-blank line from SKILL.md content as the description.
 */
function extractDescription(content: string): string {
	const lines = content.split('\n');
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.length > 0) {
			return trimmed;
		}
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

/**
 * List all available skills across all tiers.
 * Deduplicates by name (project overrides user overrides builtin).
 */
export async function listSkills(): Promise<SkillInfo[]> {
	const projectDir = join(process.cwd(), '.elefant', 'skills');
	const userDir = join(homedir(), '.config', 'elefant', 'skills');
	const builtinDir = join(import.meta.dir, 'builtin');

	// Scan all tiers
	const [projectSkills, userSkills, builtinSkills] = await Promise.all([
		scanSkillDir(projectDir, 'project'),
		scanSkillDir(userDir, 'user'),
		scanSkillDir(builtinDir, 'builtin'),
	]);

	// Deduplicate: project > user > builtin
	const skillMap = new Map<string, SkillInfo>();

	// Add builtin first (lowest priority)
	for (const skill of builtinSkills) {
		skillMap.set(skill.name, skill);
	}

	// User overrides builtin
	for (const skill of userSkills) {
		skillMap.set(skill.name, skill);
	}

	// Project overrides both
	for (const skill of projectSkills) {
		skillMap.set(skill.name, skill);
	}

	// Return sorted by name for consistent output
	return Array.from(skillMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}
