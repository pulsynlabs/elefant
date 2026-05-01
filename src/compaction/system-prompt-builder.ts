/**
 * System Prompt Builder
 *
 * Composes the base Elefant system prompt from independent section generators.
 *
 * Section ordering (stable for prompt caching):
 * 1. Identity         — What Elefant is and the agent's role
 * 2. Tool Inventory   — Categorized tool list with names and descriptions
 * 3. Workflow Section — Conditional (Spec Mode only): phase guidance, relevant tools/commands
 * 4. Slash Commands   — Available slash commands with triggers and descriptions
 * 5. Context Note     — Brief explanation of how context is assembled
 *
 * Token budget:
 * - Quick Mode baseline: ≤2000 tokens
 * - Spec Mode (active workflow): ≤3000 tokens (soft cap)
 */

import type { ToolRegistry } from '../tools/registry.ts'
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
}

function joinSections(sections: readonly string[]): string {
	return sections
		.map((section) => section.trim())
		.filter((section) => section.length > 0)
		.join('\n\n')
}

export function buildSystemPrompt(ctx: SystemPromptContext): string {
	return joinSections([
		buildIdentitySection(),
		buildToolInventorySection(ctx.toolRegistry),
		buildWorkflowSection({
			sessionMode: ctx.sessionMode,
			workflowState: ctx.workflowState,
		}),
		buildCommandsSection(ctx.commands),
		buildContextNoteSection(),
	])
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
