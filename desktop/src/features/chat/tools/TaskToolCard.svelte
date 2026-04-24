<script lang="ts">
	// TaskToolCard — chat-surface adapter that renders an `AgentTaskCard`
	// for `task` tool calls in the assistant transcript.
	//
	// The chat surface receives a `ToolCallDisplay` (id, name, arguments,
	// result, and optional metadata). Resolution precedence for every
	// field the card needs is documented in `task-tool-card-state.ts`:
	//
	//   - runId:      tool_call_metadata (primary) → title-match fallback
	//   - title:      arguments.description (primary) → metadata.title
	//   - agentType:  arguments.agent_type (primary) → metadata.agentType
	//
	// Metadata is patched onto the tool call by
	// `chatStore.patchToolCallMetadata` whenever a `tool_call_metadata`
	// SSE event arrives; this is the daemon's authoritative runId
	// announcement at spawn time. The title-match fallback is retained
	// for replayed sessions and slow-arrival metadata.

	import { agentRunsStore } from '$lib/stores/agent-runs.svelte.js';
	import { navigationStore } from '$lib/stores/navigation.svelte.js';
	import AgentTaskCard from '$features/agent-runs/AgentTaskCard.svelte';
	import type { ToolCardProps } from './types.js';
	import {
		extractTaskAgentType,
		extractTaskDescription,
		resolveTaskToolCardChildRunId,
	} from './task-tool-card-state.js';

	let { toolCall }: ToolCardProps = $props();

	// All derivations live in the pure `task-tool-card-state` module so
	// they can be unit tested without a component renderer (see
	// TaskToolCard.test.ts).
	const description = $derived(extractTaskDescription(toolCall));
	const agentType = $derived(extractTaskAgentType(toolCall));

	// Re-runs whenever `toolCall.metadata` is patched in by
	// `chatStore.patchToolCallMetadata` (primary path) or when
	// `agentRunsStore.runs` gains a matching-title row (fallback).
	const resolvedRunId = $derived.by<string | null>(() =>
		resolveTaskToolCardChildRunId(toolCall, agentRunsStore.runs),
	);

	function handleOpenChildRun(runId: string): void {
		console.debug('[TaskToolCard] openChildRun', { runId, metadata: toolCall.metadata, resolvedRunId });
		navigationStore.openChildRun(runId);
	}
</script>

{#if !resolvedRunId}
	<!-- Pre-resolution placeholder. Mirrors AgentTaskCard's "spawning"
	     visual so the card layout doesn't reflow once the child id
	     resolves and AgentTaskCard takes over. -->
	<div
		class="task-card-placeholder"
		role="status"
		aria-live="polite"
		aria-label="Starting agent task: {description || 'Untitled task'}"
	>
		<span class="placeholder-spinner" aria-hidden="true"></span>
		<span class="placeholder-body">
			<span class="placeholder-title">{description || 'Untitled task'}</span>
			<span class="placeholder-status">Starting…</span>
		</span>
	</div>
{:else}
	<AgentTaskCard
		title={description}
		{agentType}
		toolCallId={toolCall.id}
		parentRunId=""
		{resolvedRunId}
		onOpenChildRun={handleOpenChildRun}
	/>
{/if}

<style>
	.task-card-placeholder {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		margin: var(--space-2) 0;
		min-height: 56px;
		width: 100%;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-left: 3px solid var(--color-info);
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.placeholder-spinner {
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-info);
		border-radius: var(--radius-full);
		animation: spin 0.9s linear infinite;
		flex-shrink: 0;
	}

	.placeholder-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.placeholder-title {
		font-weight: var(--font-weight-medium);
		color: var(--color-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.placeholder-status {
		font-size: var(--font-size-xs);
		font-style: italic;
		color: var(--color-info);
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.placeholder-spinner {
			animation: none;
		}
	}
</style>
