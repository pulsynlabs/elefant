<script lang="ts">
	// AgentTaskCard — inline card representing a `task` tool call in a
	// parent transcript. Unlike a generic ToolCallCard, this card:
	//   • visually advertises "a new agent was spawned"
	//   • surfaces the child's live status via the agent-runs store
	//   • becomes a navigable button the moment the child `runId` resolves
	//   • shows a non-clickable "Spawning…" placeholder while unresolved
	//
	// Every prop is read-only; the card observes store state for live
	// status and delegates navigation to `onOpenChildRun`.

	import { agentRunsStore } from '$lib/stores/agent-runs.svelte.js';
	import type { AgentRun } from '$lib/types/agent-run.js';
	import {
		buildAgentTaskCardAriaLabel,
		computeAgentTaskCardState,
	} from './agent-task-card-state.js';

	type Props = {
		title: string;
		agentType: string;
		toolCallId: string;
		parentRunId: string;
		resolvedRunId?: string | null;
		onOpenChildRun?: (runId: string) => void;
	};

	let {
		title,
		agentType,
		toolCallId: _toolCallId,
		parentRunId: _parentRunId,
		resolvedRunId = null,
		onOpenChildRun,
	}: Props = $props();

	// Live view of the resolved child run (or null if not hydrated yet).
	const childRun = $derived<AgentRun | null>(
		resolvedRunId ? agentRunsStore.runs[resolvedRunId] ?? null : null,
	);

	const cardState = $derived(computeAgentTaskCardState(resolvedRunId, childRun));
	const ariaLabel = $derived(buildAgentTaskCardAriaLabel(title, cardState));

	function handleClick(): void {
		console.debug('[AgentTaskCard] click', { disabled: cardState.disabled, resolvedRunId, status: cardState.status });
		if (cardState.disabled || !resolvedRunId) return;
		onOpenChildRun?.(resolvedRunId);
	}
</script>

<button
	type="button"
	class="agent-task-card"
	class:is-spawning={cardState.status === 'spawning'}
	class:is-running={cardState.status === 'running'}
	class:is-done={cardState.status === 'done'}
	class:is-error={cardState.status === 'error'}
	class:is-cancelled={cardState.status === 'cancelled'}
	disabled={cardState.disabled}
	aria-label={ariaLabel}
	aria-busy={cardState.status === 'spawning' || cardState.status === 'running'}
	onclick={handleClick}
>
	<span class="card-accent" aria-hidden="true"></span>

	<span class="agent-icon" aria-hidden="true">🤖</span>

	<span class="card-body">
		<span class="card-title-row">
			<span class="card-title">{title || 'Untitled task'}</span>
			<span class="agent-badge" title="Agent type: {agentType}">{agentType}</span>
		</span>

		<span class="card-status-row">
			{#if cardState.status === 'spawning'}
				<span class="status-spinner" aria-hidden="true"></span>
				<span class="status-text spawning">Spawning…</span>
			{:else}
				<span
					class="status-icon"
					class:pulsing={cardState.isPulsing}
					aria-hidden="true"
				>
					{#if cardState.isPulsing}
						<span class="pulse-dot"></span>
					{:else}
						{cardState.statusIcon}
					{/if}
				</span>
				<span class="status-text">{cardState.statusLabel}</span>
			{/if}
		</span>
	</span>

	{#if !cardState.disabled}
		<span class="card-chevron" aria-hidden="true">›</span>
	{/if}
</button>

<style>
	.agent-task-card {
		/* Reset button chrome */
		appearance: none;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-left: 3px solid var(--color-info);
		border-radius: var(--radius-md);
		color: inherit;
		font: inherit;
		text-align: left;

		display: grid;
		grid-template-columns: auto auto 1fr auto;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		margin: var(--space-2) 0;
		width: 100%;
		min-height: 56px;

		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			transform var(--transition-fast);
	}

	.agent-task-card:hover:not(:disabled) {
		background-color: var(--color-surface-hover);
		border-color: var(--color-info);
	}

	.agent-task-card:focus-visible {
		outline: 2px solid var(--color-info);
		outline-offset: 2px;
	}

	.agent-task-card:active:not(:disabled) {
		transform: translateY(1px);
	}

	.agent-task-card:disabled {
		cursor: progress;
		opacity: 0.85;
	}

	/* Left accent strip — absorbed into border-left, but keep a hook. */
	.card-accent {
		display: none;
	}

	/* State-specific accent border colors. */
	.agent-task-card.is-done {
		border-left-color: var(--color-success);
	}
	.agent-task-card.is-error {
		border-left-color: var(--color-error);
	}
	.agent-task-card.is-cancelled {
		border-left-color: var(--color-text-muted);
	}

	.agent-icon {
		font-size: 20px;
		line-height: 1;
		flex-shrink: 0;
	}

	.card-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.card-title-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.card-title {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-primary);
		line-height: 1.3;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.agent-badge {
		flex-shrink: 0;
		display: inline-block;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
		color: var(--color-info);
		background-color: color-mix(in oklch, var(--color-info) 12%, transparent);
		padding: 1px var(--space-2);
		border-radius: var(--radius-sm);
		line-height: 1.4;
		white-space: nowrap;
		max-width: 160px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.card-status-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	.status-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		font-size: 12px;
		line-height: 1;
	}

	.is-done .status-icon {
		color: var(--color-success);
	}
	.is-error .status-icon {
		color: var(--color-error);
	}
	.is-cancelled .status-icon {
		color: var(--color-text-muted);
	}
	.is-running .status-icon {
		color: var(--color-info);
	}

	.pulse-dot {
		display: block;
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
		background-color: currentColor;
		animation: pulse 1.5s ease-in-out infinite;
	}

	.status-spinner {
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-info);
		border-radius: var(--radius-full);
		animation: spin 0.9s linear infinite;
	}

	.status-text.spawning {
		color: var(--color-info);
		font-style: italic;
	}

	.card-chevron {
		font-size: 18px;
		color: var(--color-text-muted);
		line-height: 1;
		flex-shrink: 0;
		transition: transform var(--transition-fast);
	}

	.agent-task-card:hover:not(:disabled) .card-chevron {
		transform: translateX(2px);
		color: var(--color-info);
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.3;
		}
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.pulse-dot,
		.status-spinner {
			animation: none;
		}
		.agent-task-card:active:not(:disabled) {
			transform: none;
		}
	}
</style>
