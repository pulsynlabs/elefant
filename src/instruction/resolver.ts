import { dirname, join, resolve } from 'node:path';

import { INSTRUCTION_FILES } from './types.ts';

/**
 * Find an instruction file (AGENTS.md or CLAUDE.md fallback) in a directory.
 * Returns the absolute path if found, undefined otherwise.
 */
export async function findInstruction(dir: string): Promise<string | undefined> {
	for (const filename of INSTRUCTION_FILES) {
		const filepath = resolve(join(dir, filename));
		if (await Bun.file(filepath).exists()) return filepath;
	}

	return undefined;
}

/**
 * Resolve the root instruction file for a project.
 * Returns null if no instruction file found at projectRoot.
 */
export async function resolveRoot(projectRoot: string): Promise<{ filepath: string } | null> {
	const found = await findInstruction(projectRoot);
	if (!found) return null;

	return { filepath: found };
}

/**
 * Walk up from filepath's directory to projectRoot, returning instruction files
 * found in ancestor directories that are NOT in alreadyLoaded.
 *
 * Returns entries in root-to-leaf order (closest to projectRoot first,
 * closest to the file last — highest priority).
 */
export async function resolveForFile(
	filepath: string,
	projectRoot: string,
	alreadyLoaded: ReadonlySet<string>,
): Promise<Array<{ filepath: string }>> {
	const results: Array<{ filepath: string }> = [];
	const root = resolve(projectRoot);
	const target = resolve(filepath);
	let current = dirname(target);

	while (current.startsWith(root)) {
		const found = await findInstruction(current);
		if (found && found !== target && !alreadyLoaded.has(found)) {
			results.unshift({ filepath: found });
		}

		if (current === root) return results;

		current = dirname(current);
	}

	return results;
}
