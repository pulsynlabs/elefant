<script lang="ts">
	// SidebarChildRunChain — indented list of active child-run rows
	// surfaced beneath a session row (MH3).
	//
	// The chain is the ancestor path from the session's root run down
	// to the currently-active child run, minus the root itself (the
	// session row already represents the root). Each row is indented
	// in proportion to its depth in the tree.
	//
	// Each row also carries a live status indicator reflecting the
	// run's state:
	//   - running → pulsing primary-colored dot
	//   - blocked → yellow dot (awaiting a question answer)
	//   - error   → red dot (terminated with error)
	//   - unseen  → blue dot (new output the user hasn't focused yet)
	//   - none    → no dot (done / cancelled / quiet)
	//
	// The component is intentionally presentational — visibility rules,
	// row computation, and variant resolution live in the parent via
	// the `sidebar-child-run-chain-state` pure helpers. Callers pass
	// the resolved rows + the already-computed variant for each row
	// and the click handler; we just draw them.

	import type {
		SidebarChildRunRow,
		SidebarRunStatusVariant,
	} from './sidebar-child-run-chain-state.js';
	import { buildChildRunRowIndent } from './sidebar-child-run-chain-state.js';

	type Props = {
		rows: SidebarChildRunRow[];
		/** Active child run id — used to highlight the current row. */
		activeChildRunId: string | null;
		/**
		 * Resolver for the status indicator variant of a given row.
		 * The parent supplies this (it has access to the store's
		 * `isUnseen` / `isAwaitingQuestion` selectors); we stay pure.
		 */
		getStatusVariant: (row: SidebarChildRunRow) => SidebarRunStatusVariant;
		onSelectRun: (runId: string) => void;
	};

	let { rows, activeChildRunId, getStatusVariant, onSelectRun }: Props =
		$props();

	function handleKeydown(event: KeyboardEvent, runId: string): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onSelectRun(runId);
		}
	}

	function rowLabel(title: string): string {
		return title.trim() || 'Untitled run';
	}

	/**
	 * Human-readable label for the status indicator, announced to
	 * assistive tech via aria-label. Empty when there is no dot.
	 */
	function variantLabel(variant: SidebarRunStatusVariant): string {
		switch (variant) {
			case 'running':
				return 'Running';
			case 'blocked':
				return 'Awaiting answer';
			case 'error':
				return 'Error';
			case 'unseen':
				return 'New output';
			case 'none':
			default:
				return '';
		}
	}
</script>

{#if rows.length > 0}
	<ul class="child-run-chain" role="list" aria-label="Active child run chain">
		{#each rows as row (row.run.runId)}
			{@const variant = getStatusVariant(row)}
			{@const label = variantLabel(variant)}
			<li>
				<button
					type="button"
					class="child-run-row"
					class:active={activeChildRunId === row.run.runId}
					aria-current={activeChildRunId === row.run.runId ? 'page' : undefined}
					aria-label="Open child run {rowLabel(row.run.title)}"
					style="padding-left: {buildChildRunRowIndent(row.depth)};"
					onclick={() => onSelectRun(row.run.runId)}
					onkeydown={(e) => handleKeydown(e, row.run.runId)}
				>
					<span class="chain-connector" aria-hidden="true">└─</span>
					<span class="child-run-label" title={rowLabel(row.run.title)}>
						{rowLabel(row.run.title)}
					</span>
					{#if variant !== 'none'}
						<span
							class="status-dot status-{variant}"
							role="img"
							aria-label={label}
							title={label}
						></span>
					{/if}
				</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.child-run-chain {
		list-style: none;
		margin: var(--space-1) 0;
		padding: 0 0 0 var(--space-6);
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.child-run-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-1) var(--space-2);
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		text-align: left;
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		transition:
			color var(--transition-fast),
			background-color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.child-run-row:hover {
		color: var(--color-text-primary);
		background-color: var(--color-surface-hover);
	}

	.child-run-row:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.child-run-row.active {
		color: var(--color-primary);
		background-color: var(--color-primary-subtle);
	}

	.chain-connector {
		display: inline-block;
		color: var(--color-text-disabled);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		flex-shrink: 0;
		user-select: none;
	}

	.child-run-label {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* --- Status indicator dot -------------------------------------- */
	.status-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		flex-shrink: 0;
		border-radius: var(--radius-full);
		background-color: var(--color-text-muted);
	}

	.status-running {
		width: 8px;
		height: 8px;
		background-color: var(--color-primary);
		box-shadow: var(--glow-primary);
		animation: pulse 1.5s ease-in-out infinite;
	}

	.status-blocked {
		background-color: var(--color-warning);
	}

	.status-error {
		background-color: var(--color-error);
	}

	.status-unseen {
		background-color: var(--color-info);
	}

	/* Respect reduced-motion: keep the running dot visible but stop
	   the pulse animation for users who opt out. */
	@media (prefers-reduced-motion: reduce) {
		.status-running {
			animation: none;
		}
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
</style>
