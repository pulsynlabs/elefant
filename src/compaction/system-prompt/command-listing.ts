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

/**
 * Build a well-formatted slash command listing for the system prompt.
 * Uses a concise bullet-list format optimised for low token budget.
 *
 * If commands have phase metadata they are grouped by phase;
 * otherwise all commands are presented as a flat list.
 */
export function buildCommandsSection(commands: readonly CommandEntry[]): string {
	if (commands.length === 0) {
		return ['## Slash Commands', '- No slash commands are currently registered.'].join('\n');
	}

	const lines = ['## Slash Commands'];

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
	};
	return labels[phase] ?? phase;
}

/** The full command list sourced from the canonical COMMANDS_REGISTRY.json. */
export const DEFAULT_COMMANDS: CommandEntry[] = (registry as RegistryEntry[]).map((entry) => ({
	trigger: entry.trigger,
	description: entry.description,
	phase: entry.category,
}));
