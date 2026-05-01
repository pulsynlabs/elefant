/**
 * System Prompt Builder
 *
 * Composes the base Elefant system prompt from independent section generators.
 *
 * Section ordering (stable for prompt caching):
 * 1. Identity — What Elefant is and the agent's role
 * 2. Tool Inventory — Categorized tool list with names and descriptions
 * 3. Workflow Section — Conditional (Spec Mode only): phase, allowed tools, workflow commands
 * 4. Commands — Available slash commands with triggers and descriptions
 * 5. Context Note — Brief explanation of how context is assembled
 *
 * Token budget:
 * - Quick Mode baseline: ≤2000 tokens
 * - Spec Mode (active workflow): ≤3000 tokens (soft cap)
 */

import type { ToolRegistry } from '../tools/registry.ts'

export interface WorkflowPromptState {
	readonly phase: string
	readonly currentWave?: number
	readonly totalWaves?: number
}

export interface SystemPromptCommand {
	readonly trigger: string
	readonly description: string
}

export interface SystemPromptContext {
	readonly toolRegistry: Pick<ToolRegistry, 'getAll'>
	readonly sessionMode: 'spec' | 'quick'
	readonly workflowState?: WorkflowPromptState
	readonly commands: readonly SystemPromptCommand[]
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

export function buildToolInventorySection(registry: Pick<ToolRegistry, 'getAll'>): string {
	const tools = registry.getAll()
	if (tools.length === 0) {
		return ['## Tool Inventory', '- No tools are currently registered.'].join('\n')
	}

	const lines = ['## Tool Inventory']
	for (const tool of tools) {
		lines.push(`- ${tool.name} — ${tool.description}`)
	}
	return lines.join('\n')
}

export function buildWorkflowSection(
	ctx: Pick<SystemPromptContext, 'sessionMode' | 'workflowState'>,
): string {
	if (ctx.sessionMode !== 'spec' || !ctx.workflowState) {
		return ''
	}

	const wave =
		ctx.workflowState.currentWave !== undefined && ctx.workflowState.totalWaves !== undefined
			? ` | Wave: ${ctx.workflowState.currentWave}/${ctx.workflowState.totalWaves}`
			: ''

	return [
		'## Workflow',
		`- Spec Mode active. Phase: ${ctx.workflowState.phase}${wave}`,
		'- Follow phase gates and prefer workflow tools/commands for workflow state changes.',
	].join('\n')
}

export function buildCommandsSection(commands: SystemPromptContext['commands']): string {
	if (commands.length === 0) {
		return ['## Commands', '- No slash commands are currently registered.'].join('\n')
	}

	const lines = ['## Commands']
	for (const command of commands) {
		lines.push(`- ${command.trigger} — ${command.description}`)
	}
	return lines.join('\n')
}

export function buildContextNoteSection(): string {
	return [
		'## Context Assembly',
		'- System context is assembled from the stable base prompt, project knowledge, workflow blocks, compaction summaries, prior messages, and current user input.',
		'- Treat injected context as authoritative when it is more specific than general instructions.',
	].join('\n')
}
