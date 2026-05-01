import path from 'node:path';

import type { StateManager } from '../state/manager.ts';
import { parseFrontmatter } from '../tools/skill/frontmatter.js';
import { listSkills, resolveSkill, type SkillInfo } from '../tools/skill/resolver.js';

export interface SlashCommandDefinition {
	name: string; // e.g., "discuss"
	trigger: string; // e.g., "/discuss"
	description: string;
	category: 'spec-mode' | 'utility' | 'skill';
	args?: string; // e.g., "[session-name]"
}

export interface SlashCommandMatch {
	command: SlashCommandDefinition;
	args: string; // remainder of the message after the trigger
	promptContent: string; // loaded command markdown (injected as system context)
}

export type ResolveSkillFn = typeof resolveSkill;
export type ListSkillsFn = typeof listSkills;

export interface ParseSlashCommandOptions {
	/** Override skill resolution for deterministic tests. */
	resolveSkillFn?: ResolveSkillFn;
}

export interface SuggestCommandsOptions {
	/** Override skill listing for deterministic tests. */
	listSkillsFn?: ListSkillsFn;
}

function fuzzyScore(query: string, candidate: string): number {
	const q = query.toLowerCase();
	const c = candidate.toLowerCase();
	// Require the query to be a prefix (or close) of the candidate trigger.
	// Only match if q's characters appear in order in c starting from position 0.
	if (c.startsWith(q)) return q.length + 1;

	// Allow one-character deviation for typo tolerance (e.g., /plzn vs /plan)
	if (q.length >= 4 && c.length >= q.length) {
		let diffs = 0;
		for (let i = 0; i < q.length && i < c.length; i++) {
			if (q[i] !== c[i]) diffs += 1;
		}
		// Up to 2 character differences for fuzzy match
		if (diffs <= 2 && Math.abs(c.length - q.length) <= 2) return q.length - diffs;
	}

	return 0;
}

export async function suggestCommands(
	trigger: string,
	registry: SlashCommandDefinition[],
	limit = 3,
	options: SuggestCommandsOptions = {},
): Promise<string[]> {
	const skills = await (options.listSkillsFn ?? listSkills)();
	const skillCommands: SlashCommandDefinition[] = skills.map((skill: SkillInfo) => ({
		name: skill.name,
		trigger: `/${skill.name}`,
		description: skill.description,
		category: 'skill',
	}));

	return [...registry, ...skillCommands]
		.map((cmd) => ({
			name: cmd.trigger,
			score: fuzzyScore(trigger, cmd.trigger),
		}))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map((entry) => entry.name);
}

export async function loadCommandRegistry(
	commandsDir: string,
): Promise<SlashCommandDefinition[]> {
	const jsonPath = path.join(commandsDir, 'COMMANDS_REGISTRY.json');
	const jsonFile = Bun.file(jsonPath);

	if (await jsonFile.exists()) {
		const raw = await jsonFile.text();
		const parsed: unknown = JSON.parse(raw);
		if (
			Array.isArray(parsed) &&
			parsed.every(
				(entry) =>
					typeof entry === 'object' &&
					entry !== null &&
					typeof (entry as Record<string, unknown>).name === 'string' &&
					typeof (entry as Record<string, unknown>).trigger === 'string' &&
					typeof (entry as Record<string, unknown>).description === 'string' &&
					typeof (entry as Record<string, unknown>).category === 'string',
			)
		) {
			return parsed as SlashCommandDefinition[];
		}
	}

	// Fallback: scan *.md files and derive definitions from filenames
	const glob = new Bun.Glob('*.md');
	const results: SlashCommandDefinition[] = [];

	for await (const entry of glob.scan({ cwd: commandsDir, absolute: false })) {
		const name = entry.replace(/\.md$/, '');
		const trigger = `/${name}`;
		if (results.some((r) => r.trigger === trigger)) continue;

		results.push({
			name,
			trigger,
			description: `See /${name} for details.`,
			category: 'spec-mode',
		});
	}

	return results;
}

export async function parseSlashCommand(
	message: string,
	commandsDir: string,
	options: ParseSlashCommandOptions = {},
): Promise<SlashCommandMatch | null> {
	const trimmed = message.trimStart();
	if (!trimmed.startsWith('/')) return null;

	const firstLine = trimmed.split('\n')[0];
	if (!firstLine.startsWith('/')) return null;

	// Extract trigger as the first whitespace-delimited token.
	// Args is the remainder of the line after the trigger, with
	// leading whitespace stripped but internal spacing preserved.
	const spaceIdx = firstLine.search(/\s/);
	const trigger = spaceIdx === -1 ? firstLine : firstLine.slice(0, spaceIdx);
	const args = spaceIdx === -1 ? '' : firstLine.slice(spaceIdx).trim();

	const commands = await loadCommandRegistry(commandsDir);
	const cmd = commands.find((c) => c.trigger === trigger);
	if (!cmd) {
		const skillName = trigger.startsWith('/') ? trigger.slice(1) : trigger;
		const skillResult = await (options.resolveSkillFn ?? resolveSkill)(skillName);

		if (!skillResult) return null;

		const { description } = parseFrontmatter(skillResult.content);
		return {
			command: {
				name: skillName,
				trigger,
				description: description ?? `${skillName} skill`,
				category: 'skill',
			},
			args,
			promptContent: skillResult.content,
		};
	}

	const filePath = path.join(commandsDir, `${cmd.name}.md`);
	const file = Bun.file(filePath);
	if (!(await file.exists())) return null;

	const promptContent = await file.text();
	return { command: cmd, args, promptContent };
}

/**
 * Map of slash commands to their auto-progression follow-up. When the
 * workflow has `autopilot=true`, the agent loop calls
 * `executeAutoProgression` after a command completes; if a follow-up is
 * registered the next turn is primed with that command's prompt body so
 * the workflow advances without the user typing again.
 *
 * `/accept` deliberately has no successor — acceptance is always a
 * human gate even in lazy autopilot.
 */
export const AUTO_PROGRESSION: Readonly<Record<string, string>> = Object.freeze({
	'/discuss': '/plan',
	'/plan': '/execute',
	'/execute': '/audit',
	'/audit': '/accept',
});

export async function executeAutoProgression(
	currentCommand: string,
	stateManager: StateManager,
	workflowId: string,
	projectId: string,
	commandsDir: string,
): Promise<SlashCommandMatch | null> {
	const workflow = await stateManager.getSpecWorkflow(projectId, workflowId);
	if (!workflow?.autopilot) return null;

	const nextTrigger = AUTO_PROGRESSION[currentCommand];
	if (!nextTrigger) return null;

	return parseSlashCommand(nextTrigger, commandsDir);
}
