/**
 * System Prompt Builder
 *
 * Composes the base Elefant system prompt from independent section generators.
 *
 * Section ordering (stable for prompt caching):
 * 1. Identity         — What Elefant is and the agent's role
 * 2. Tool Inventory   — Categorized tool list with names and descriptions
 * 3. Skills           — Available specialized skill instructions and workflows
 * 4. Workflow Section — Conditional (Spec Mode only): phase guidance, relevant tools/commands
 * 5. Slash Commands   — Available slash commands with triggers and descriptions
 * 6. Context Note     — Brief explanation of how context is assembled
 *
 * Token budget:
 * - Quick Mode baseline: ≤2000 tokens
 * - Spec Mode (active workflow): ≤3000 tokens (soft cap)
 */

import type { ToolRegistry } from '../tools/registry.ts'
import type { SkillInfo } from '../tools/skill/resolver.js'
import { formatSkills } from './system-prompt/skills-section.js'
import { buildToolInventorySection } from './system-prompt/tool-inventory.ts'
import { buildWorkflowSection } from './system-prompt/workflow-section.ts'
import { buildCommandsSection, type CommandEntry } from './system-prompt/command-listing.ts'

export interface WorkflowPromptState {
	readonly phase: string
	readonly currentWave?: number
	readonly totalWaves?: number
}

/** @deprecated Use CommandEntry from './system-prompt/command-listing.ts' instead. */
export type SystemPromptCommand = CommandEntry

export interface SystemPromptContext {
	readonly toolRegistry: Pick<ToolRegistry, 'getAll'>
	readonly sessionMode: 'spec' | 'quick'
	readonly workflowState?: WorkflowPromptState
	readonly commands: readonly CommandEntry[]
	readonly skills?: readonly SkillInfo[]
}

function joinSections(sections: readonly string[]): string {
	return sections
		.map((section) => section.trim())
		.filter((section) => section.length > 0)
		.join('\n\n')
}

/**
 * Convert resolved skill info entries into command-listing entries so they
 * appear under the `### Skill Commands` heading in the system prompt.
 */
function buildSkillCommandEntries(skills: readonly SkillInfo[]): CommandEntry[] {
	return skills.map((s) => ({
		trigger: `/${s.name}`,
		description: s.description,
		phase: 'skill',
	}));
}

export function buildSystemPrompt(ctx: SystemPromptContext): string {
	return joinSections([
		buildIdentitySection(),
		buildToolInventorySection(ctx.toolRegistry),
		buildSkillsSection(ctx.skills ?? []),
		buildWorkflowSection({
			sessionMode: ctx.sessionMode,
			workflowState: ctx.workflowState,
		}),
		buildCommandsSection(ctx.commands, buildSkillCommandEntries(ctx.skills ?? [])),
		buildContextNoteSection(),
	])
}

export function buildSkillsSection(skills: readonly SkillInfo[]): string {
	return formatSkills([...skills], { verbose: true, maxChars: 4000 })
}

export function buildIdentitySection(): string {
	return [
		'## Identity',
		'- You are Elefant, an AI coding agent running inside the user\'s project.',
		'- Prioritise correctness, concise communication, and safe tool use.',
	].join('\n')
}

export function buildContextNoteSection(): string {
	return [
		'## Context Assembly',
		'- System context is assembled from the stable base prompt, project knowledge, workflow blocks, compaction summaries, prior messages, and current user input.',
		'- Treat injected context as authoritative when it is more specific than general instructions.',
	].join('\n')
}

// Re-export section builders for isolated testing and backward compatibility.
export { buildToolInventorySection, buildWorkflowSection, buildCommandsSection, type CommandEntry }
