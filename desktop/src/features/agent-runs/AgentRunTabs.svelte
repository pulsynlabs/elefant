<script lang="ts">
	// AgentRunTabs — horizontal tab bar for open agent runs.
	//
	// Each tab shows the run title, an agent-type badge, and a live
	// status dot. Clicking activates the tab; the close control asks for
	// confirmation if the run is still running.

	import { agentRunsStore } from '$lib/stores/agent-runs.svelte.js';
	import type { AgentRun, AgentRunStatus } from '$lib/types/agent-run.js';
	import { HugeiconsIcon, CloseIcon } from '$lib/icons/index.js';

	type Props = {
		// When provided, only runs for this session appear in the bar.
		sessionId?: string;
	};

	let { sessionId }: Props = $props();

	let runToConfirm = $state<AgentRun | null>(null);

	const openRuns = $derived<AgentRun[]>(
		agentRunsStore.openRunIds
			.map((id) => agentRunsStore.runs[id])
			.filter((r): r is AgentRun => Boolean(r))
			.filter((r) => (sessionId ? r.sessionId === sessionId : true)),
	);

	function statusLabel(status: AgentRunStatus): string {
		switch (status) {
			case 'running':
				return 'Running';
			case 'done':
				return 'Complete';
			case 'error':
				return 'Error';
			case 'cancelled':
				return 'Cancelled';
		}
	}

	function handleTabClick(run: AgentRun): void {
		agentRunsStore.setActiveRun(run.runId);
	}

	function handleTabKey(e: KeyboardEvent, run: AgentRun): void {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			agentRunsStore.setActiveRun(run.runId);
		}
	}

	function requestClose(run: AgentRun, e: MouseEvent): void {
		e.stopPropagation();
		if (run.status === 'running') {
			runToConfirm = run;
			return;
		}
		agentRunsStore.closeRun(run.runId);
	}

	function confirmClose(): void {
		if (!runToConfirm) return;
		agentRunsStore.closeRun(runToConfirm.runId);
		runToConfirm = null;
	}

	function cancelClose(): void {
		runToConfirm = null;
	}
</script>

{#if openRuns.length > 0}
	<div class="tab-bar" role="tablist" aria-label="Open agent runs">
		{#each openRuns as run (run.runId)}
			{@const isActive = agentRunsStore.activeRunId === run.runId}
			<div
				class="tab"
				class:active={isActive}
				role="tab"
				tabindex={isActive ? 0 : -1}
				aria-selected={isActive}
				aria-controls="agent-run-panel-{run.runId}"
				onclick={() => handleTabClick(run)}
				onkeydown={(e) => handleTabKey(e, run)}
			>
				<span
					class="status-dot status-{run.status}"
					aria-label={statusLabel(run.status)}
					title={statusLabel(run.status)}
				></span>
				<span class="title" title={run.title}>{run.title}</span>
				<span class="badge" aria-hidden="true">{run.agentType}</span>
				<button
					type="button"
					class="close"
					onclick={(e) => requestClose(run, e)}
					aria-label="Close {run.title}"
				>
					<HugeiconsIcon icon={CloseIcon} size={12} strokeWidth={2} />
				</button>
			</div>
		{/each}
	</div>
{/if}

{#if runToConfirm}
	<div
		class="confirm-backdrop"
		role="dialog"
		aria-modal="true"
		aria-labelledby="confirm-title"
	>
		<div class="confirm-card">
			<h3 id="confirm-title" class="confirm-title">Close a running run?</h3>
			<p class="confirm-body">
				<strong>{runToConfirm.title}</strong> is still running. Closing the
				tab hides the transcript but does not stop the run. Use the Cancel
				button in the tree view to stop it first.
			</p>
			<div class="confirm-actions">
				<button type="button" class="btn btn-ghost" onclick={cancelClose}>
					Keep open
				</button>
				<button type="button" class="btn btn-danger" onclick={confirmClose}>
					Close tab
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.tab-bar {
		display: flex;
		align-items: stretch;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-2) 0;
		background-color: var(--color-surface);
		border-bottom: 1px solid var(--color-border);
		overflow-x: auto;
		scrollbar-width: thin;
	}

	.tab {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		min-width: 140px;
		max-width: 260px;
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-bottom: none;
		border-radius: var(--radius-md) var(--radius-md) 0 0;
		cursor: pointer;
		color: var(--color-text-secondary);
		font-size: var(--font-size-sm);
		transition:
			background-color var(--transition-fast),
			color var(--transition-fast);
		user-select: none;
	}

	.tab:hover {
		background-color: var(--color-surface-hover);
		color: var(--color-text-primary);
	}

	.tab.active {
		background-color: var(--color-bg);
		color: var(--color-text-primary);
		border-color: var(--color-border-strong);
		box-shadow: 0 1px 0 0 var(--color-bg);
	}

	.tab:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.status-dot {
		width: 8px;
		height: 8px;
		flex-shrink: 0;
		border-radius: 9999px;
		background-color: var(--color-text-muted);
	}

	.status-running {
		background-color: var(--color-primary, #3b82f6);
		animation: pulse 1.5s ease-in-out infinite;
	}

	.status-done {
		background-color: var(--color-success, #10b981);
	}

	.status-error {
		background-color: var(--color-error, #ef4444);
	}

	.status-cancelled {
		background-color: var(--color-text-disabled);
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}

	.title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.badge {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		background-color: var(--color-surface);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		flex-shrink: 0;
		text-transform: lowercase;
	}

	.close {
		background: transparent;
		border: none;
		padding: 2px;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.close:hover {
		background-color: var(--color-surface-hover);
		color: var(--color-text-primary);
	}

	.close:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.confirm-backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
		background-color: color-mix(in srgb, black 55%, transparent);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
	}

	.confirm-card {
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-lg);
		padding: var(--space-5);
		max-width: 440px;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.confirm-title {
		margin: 0;
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
	}

	.confirm-body {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
		line-height: var(--line-height-relaxed);
	}

	.confirm-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	.btn {
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		border: 1px solid transparent;
		font-family: var(--font-sans);
	}

	.btn-ghost {
		background: transparent;
		color: var(--color-text-primary);
		border-color: var(--color-border-strong);
	}

	.btn-ghost:hover {
		background-color: var(--color-surface-hover);
	}

	.btn-danger {
		background-color: var(--color-error, #b23a3a);
		color: white;
	}

	.btn-danger:hover {
		filter: brightness(1.1);
	}

	.btn:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	@media (max-width: 640px) {
		.tab {
			min-width: 120px;
		}
	}
</style>
