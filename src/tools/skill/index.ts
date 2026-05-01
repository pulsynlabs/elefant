/**
 * Skill tool — load SKILL.md files from project, user, or built-in registry.
 */

import type { ToolDefinition } from '../../types/tools.js';
import type { ElefantError } from '../../types/errors.js';
import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';
import { resolveSkill, listSkills } from './resolver.js';

export interface SkillParams {
	name?: string;
	list?: boolean;
	/** Override for `homedir()` — test isolation. */
	home?: string;
	/** Override for `process.cwd()` — test isolation. */
	cwd?: string;
}

/**
 * Format skills list for display.
 */
function formatSkillsList(skills: Awaited<ReturnType<typeof listSkills>>): string {
	if (skills.length === 0) {
		return 'No skills available.';
	}

	const lines = skills.map((s) => `${s.name} [${s.source}]: ${s.description}`);
	return lines.join('\n');
}

/**
 * Skill tool definition.
 */
export const skillTool: ToolDefinition<SkillParams, string> = {
	name: 'skill',
	description: 'Load a SKILL.md file by name, or list all available skills.',
	parameters: {
		name: {
			type: 'string',
			description: 'Skill name to load',
			required: false,
		},
		list: {
			type: 'boolean',
			description: 'List all available skills',
			required: false,
			default: false,
		},
	},
	execute: async (params): Promise<Result<string, ElefantError>> => {
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
			const skills = await listSkills({ home: home, cwd: cwd });
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
	},
};
