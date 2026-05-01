/**
 * Skill tool — load SKILL.md files from project, user, or built-in registry.
 */

import type { ToolDefinition } from '../../types/tools.js';
import type { ElefantError } from '../../types/errors.js';
import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';
import { resolveSkill, listSkills } from './resolver.js';
import { formatSkills } from '../../compaction/system-prompt/skills-section.js';
// import type avoids a runtime circular dependency (registry.ts imports this file).
import type { ToolRegistry } from '../registry.js';

export interface SkillParams {
	name?: string;
	list?: boolean;
	/** Override for `homedir()` — test isolation. */
	home?: string;
	/** Override for `process.cwd()` — test isolation. */
	cwd?: string;
}

/**
 * Format skills list for display (tool output when `list: true`).
 */
function formatSkillsList(skills: Awaited<ReturnType<typeof listSkills>>): string {
	if (skills.length === 0) {
		return 'No skills available.';
	}

	const lines = skills.map((s) => `${s.name} [${s.source}]: ${s.description}`);
	return lines.join('\n');
}

/**
 * Build the tool description with a live skill catalog embedded.
 * Uses compact markdown format so the model sees available skills inline.
 */
function buildDescription(skills: Awaited<ReturnType<typeof listSkills>>): string {
	const preamble = [
		'Load a SKILL.md file by name, or list all available skills.',
		'',
		"When users reference '/<skill-name>' (e.g. '/p5js', '/comfyui'), invoke this tool with that name.",
	];

	if (skills.length === 0) {
		return [...preamble, '', 'No skills are currently available.'].join('\n');
	}

	const catalog = formatSkills(skills, { verbose: false, maxChars: 2000 });
	return [...preamble, '', catalog].join('\n');
}

/** Shared parameter schema — identical for both the static and async tool. */
const skillParams = {
	name: {
		type: 'string' as const,
		description: 'Skill name to load',
		required: false,
	},
	list: {
		type: 'boolean' as const,
		description: 'List all available skills',
		required: false,
		default: false,
	},
};

/** Shared execute function — identical for both the static and async tool. */
async function executeSkill(
	params: SkillParams,
): Promise<Result<string, ElefantError>> {
	const { name, list, home, cwd } = params;

	// Neither name nor list → error
	if (!name && !list) {
		return err({
			code: 'VALIDATION_ERROR',
			message: 'Provide either name or list: true',
		});
	}

	// List mode
	if (list) {
		const skills = await listSkills({ home, cwd });
		return ok(formatSkillsList(skills));
	}

	// Load by name
	const result = await resolveSkill(name!);
	if (!result) {
		return err({
			code: 'FILE_NOT_FOUND',
			message: `Skill not found: ${name}`,
		});
	}

	return ok(result.content);
}

/**
 * Static fallback tool definition.
 *
 * Registered first during synchronous tool registry creation so the tool is
 * always available.  The description is a generic one-liner — callers that
 * want an inline skill catalog should call {@link initializeSkillTool} after
 * registry creation, which replaces this entry with one that embeds the
 * live skill list.
 */
export const skillTool: ToolDefinition<SkillParams, string> = {
	name: 'skill',
	description: 'Load a SKILL.md file by name, or list all available skills.',
	parameters: skillParams,
	execute: executeSkill,
};

/**
 * Create the skill tool definition with a live skill catalog embedded
 * in the description.
 *
 * Reads skills from disk (project, user, and builtin tiers) and formats
 * them as a compact markdown list under `## Available Skills`.
 */
export async function createSkillTool(
	opts?: { home?: string; cwd?: string },
): Promise<ToolDefinition<SkillParams, string>> {
	const skills = await listSkills(opts ?? {});
	return {
		name: 'skill',
		description: buildDescription(skills),
		parameters: skillParams,
		execute: executeSkill,
	};
}

/**
 * Replace the statically-registered `skill` tool with one whose description
 * embeds the live skill catalog.
 *
 * Call this after {@link ToolRegistry} creation (e.g. from the daemon or
 * server bootstrap code) to upgrade the tool description.  The registry
 * supports overwriting entries by name so this is safe to call at any point.
 */
export async function initializeSkillTool(
	registry: ToolRegistry,
	opts?: { home?: string; cwd?: string },
): Promise<void> {
	const tool = await createSkillTool(opts);
	registry.register(tool);
}
