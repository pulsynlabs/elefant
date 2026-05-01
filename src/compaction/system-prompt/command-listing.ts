import registry from '../../commands/workflow/COMMANDS_REGISTRY.json' with { type: 'json' };

/** A slash command entry from the canonical command registry. */
export interface CommandEntry {
	readonly trigger: string;
	readonly description: string;
	/** Workflow phase hint (optional). Absent in the current registry; reserved for future grouping. */
	readonly phase?: string;
}

interface RegistryEntry {
	name: string;
	trigger: string;
	description: string;
	category: string;
	args?: string;
}

/** Maximum number of skill command entries rendered before truncation. */
const SKILL_COMMAND_CAP = 50;

/**
 * Build a well-formatted slash command listing for the system prompt.
 * Uses a concise bullet-list format optimised for low token budget.
 *
 * If commands have phase metadata they are grouped by phase;
 * otherwise all commands are presented as a flat list.
 *
 * When `skillCommands` is provided and non-empty, a separate
 * `### Skill Commands` group is appended after workflow commands.
 */
export function buildCommandsSection(
	commands: readonly CommandEntry[],
	skillCommands?: readonly CommandEntry[],
): string {
	if (commands.length === 0 && (!skillCommands || skillCommands.length === 0)) {
		return ['## Slash Commands', '- No slash commands are currently registered.'].join('\n');
	}

	const lines = ['## Slash Commands'];

	// Render workflow commands
	if (commands.length > 0) {
		// Group by phase if every command has phase metadata
		const allHavePhase = commands.every((c) => c.phase !== undefined);
		if (allHavePhase) {
			const groups = new Map<string, CommandEntry[]>();
			for (const cmd of commands) {
				const phase = cmd.phase!;
				const group = groups.get(phase);
				if (group) {
					group.push(cmd);
				} else {
					groups.set(phase, [cmd]);
				}
			}

			for (const [phase, cmds] of groups) {
				const label = phaseLabel(phase);
				lines.push(`### ${label}`);
				for (const cmd of cmds) {
					lines.push(`- ${cmd.trigger} — ${cmd.description}`);
				}
				lines.push('');
			}

			// Remove trailing empty line
			if (lines[lines.length - 1] === '') {
				lines.pop();
			}
		} else {
			for (const cmd of commands) {
				lines.push(`- ${cmd.trigger} — ${cmd.description}`);
			}
		}
	}

	// Render skill commands as a separate group
	if (skillCommands && skillCommands.length > 0) {
		lines.push('');
		lines.push('### Skill Commands');

		const capped = skillCommands.slice(0, SKILL_COMMAND_CAP);
		for (const cmd of capped) {
			lines.push(`- ${cmd.trigger} — ${cmd.description}`);
		}

		const overflow = skillCommands.length - SKILL_COMMAND_CAP;
		if (overflow > 0) {
			lines.push(`- ... [${overflow} more skills]`);
		}
	}

	return lines.join('\n');
}

/** Map internal phase/category values to human-readable labels. */
function phaseLabel(phase: string): string {
	const labels: Record<string, string> = {
		'spec-mode': 'Workflow Commands',
		discover: 'Discovery',
		plan: 'Planning',
		execute: 'Execution',
		audit: 'Audit',
		'utility': 'Utilities',
		'skill': 'Skill Commands',
	};
	return labels[phase] ?? phase;
}

/** The full command list sourced from the canonical COMMANDS_REGISTRY.json. */
export const DEFAULT_COMMANDS: CommandEntry[] = (registry as RegistryEntry[]).map((entry) => ({
	trigger: entry.trigger,
	description: entry.description,
	phase: entry.category,
}));
