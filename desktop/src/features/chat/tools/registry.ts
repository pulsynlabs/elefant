import type { Component } from 'svelte';
import type { ToolCardProps } from './types.js';
import ReadToolCard from './ReadToolCard.svelte';
import WriteToolCard from './WriteToolCard.svelte';
import EditToolCard from './EditToolCard.svelte';
import GlobToolCard from './GlobToolCard.svelte';
import GrepToolCard from './GrepToolCard.svelte';
import BashToolCard from './BashToolCard.svelte';
import WebFetchToolCard from './WebFetchToolCard.svelte';
import WebSearchToolCard from './WebSearchToolCard.svelte';
import TodoToolCard from './TodoToolCard.svelte';
import SkillToolCard from './SkillToolCard.svelte';
import ApplyPatchToolCard from './ApplyPatchToolCard.svelte';
import LspToolCard from './LspToolCard.svelte';
import QuestionToolCard from './QuestionToolCard.svelte';
import TaskToolCard from './TaskToolCard.svelte';

/** Map of tool name to Svelte component */
export const toolCardRegistry: Record<string, Component<ToolCardProps>> = {
	read: ReadToolCard as unknown as Component<ToolCardProps>,
	write: WriteToolCard as unknown as Component<ToolCardProps>,
	edit: EditToolCard as unknown as Component<ToolCardProps>,
	glob: GlobToolCard as unknown as Component<ToolCardProps>,
	grep: GrepToolCard as unknown as Component<ToolCardProps>,
	bash: BashToolCard as unknown as Component<ToolCardProps>,
	webfetch: WebFetchToolCard as unknown as Component<ToolCardProps>,
	websearch: WebSearchToolCard as unknown as Component<ToolCardProps>,
	todowrite: TodoToolCard as unknown as Component<ToolCardProps>,
	todoread: TodoToolCard as unknown as Component<ToolCardProps>,
	skill: SkillToolCard as unknown as Component<ToolCardProps>,
	apply_patch: ApplyPatchToolCard as unknown as Component<ToolCardProps>,
	lsp: LspToolCard as unknown as Component<ToolCardProps>,
	question: QuestionToolCard as unknown as Component<ToolCardProps>,
	task: TaskToolCard as unknown as Component<ToolCardProps>,
};

/** Resolve a component for the given tool name. Returns null if not registered. */
export function resolveToolCard(name: string): Component<ToolCardProps> | null {
	return toolCardRegistry[name] ?? null;
}
