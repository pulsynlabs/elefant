<script lang="ts">
	// ChildRunView — full-pane view for a child agent run.
	//
	// Layout (grid, three rows):
	//   • header: breadcrumb back to parent + sibling prev/next controls
	//   • body:   the child's transcript (via existing AgentRunTranscript)
	//   • footer: a disabled composer that visually matches the real one
	//             but cannot accept input — users must return to the parent
	//             session to continue the conversation.
	//
	// Navigation is wired directly to navigationStore (openChildRun /
	// backToParent). Esc closes the child run and returns to the parent.

	import { agentRunsStore } from '$lib/stores/agent-runs.svelte.js';
	import { navigationStore } from '$lib/stores/navigation.svelte.js';
	import type { AgentRun } from '$lib/types/agent-run.js';
	import AgentRunTranscript from './AgentRunTranscript.svelte';
	import {
		computeChildRunViewState,
		computeSiblingNavState,
	} from './child-run-view-state.js';

	type Props = {
		runId: string;
	};

	let { runId }: Props = $props();

	const child = $derived<AgentRun | null>(
		agentRunsStore.runs[runId] ?? null,
	);

	const parent = $derived<AgentRun | null>(
		child?.parentRunId ? agentRunsStore.runs[child.parentRunId] ?? null : null,
	);

	const viewState = $derived(computeChildRunViewState(child, parent));

	const siblings = $derived<AgentRun[]>(
		child?.parentRunId
			? agentRunsStore.childRunsForRun(child.parentRunId)
			: [],
	);

	const siblingNav = $derived(computeSiblingNavState(child, siblings));

	function handleBack(): void {
		navigationStore.backToParent();
	}

	function handlePrev(): void {
		if (siblingNav.prev) {
			// Replace the top of the child-run stack: backToParent then
			// openChildRun keeps the stack shallow instead of growing it
			// with every sibling switch.
			navigationStore.backToParent();
			navigationStore.openChildRun(siblingNav.prev.runId);
		}
	}

	function handleNext(): void {
		if (siblingNav.next) {
			navigationStore.backToParent();
			navigationStore.openChildRun(siblingNav.next.runId);
		}
	}

	let transcriptScrollEl = $state<HTMLDivElement | null>(null);

	function scrollToBottom(): void {
		if (transcriptScrollEl) {
			transcriptScrollEl.scrollTop = transcriptScrollEl.scrollHeight;
		}
	}

	// Scroll to bottom whenever the runId changes (new subagent opened).
	$effect(() => {
		// Depend on runId so this re-runs on every navigation.
		const _id = runId;
		if (!transcriptScrollEl) return;
		// First pass: after current paint.
		requestAnimationFrame(scrollToBottom);
		// Second pass: after historical messages have loaded and re-painted.
		setTimeout(scrollToBottom, 300);
	});

	// Esc navigates back to the parent when the child-run view is active.
	$effect(() => {
		if (navigationStore.current !== 'child-run') return;

		function onKeydown(event: KeyboardEvent): void {
			if (event.key !== 'Escape') return;
			// Ignore when the user is mid-IME composition or inside a
			// modal/input with its own Escape handling (the disabled
			// textarea will not receive focus, but guard anyway).
			if (event.defaultPrevented) return;
			event.preventDefault();
			navigationStore.backToParent();
		}

		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});
</script>

{#if viewState.status === 'loading'}
	<section
		class="child-run-view"
		aria-label={viewState.regionLabel}
		aria-busy="true"
	>
		<div class="loading" role="status">Loading run…</div>
	</section>
{:else}
	<section
		class="child-run-view"
		aria-label={viewState.regionLabel}
	>
		<header class="breadcrumb-bar">
			<button
				type="button"
				class="breadcrumb-back"
				onclick={handleBack}
				aria-label={viewState.backLabel}
			>
				<span class="breadcrumb-arrow" aria-hidden="true">←</span>
				<span class="breadcrumb-parent-title">
					{viewState.parentTitle ?? 'Parent'}
				</span>
			</button>
			<span class="breadcrumb-separator" aria-hidden="true">/</span>
			<span class="breadcrumb-current" aria-current="page">
				{viewState.childTitle}
			</span>

			{#if siblingNav.total > 1}
				<div
					class="sibling-nav"
					role="group"
					aria-label="Sibling run navigation"
				>
					<button
						type="button"
						class="sibling-button"
						onclick={handlePrev}
						disabled={!siblingNav.hasPrev}
						aria-disabled={!siblingNav.hasPrev}
						aria-label="Previous sibling run"
						title="Previous sibling run"
					>
						<span aria-hidden="true">‹</span>
					</button>
					<span class="sibling-counter" aria-live="polite">
						{siblingNav.index + 1} / {siblingNav.total}
					</span>
					<button
						type="button"
						class="sibling-button"
						onclick={handleNext}
						disabled={!siblingNav.hasNext}
						aria-disabled={!siblingNav.hasNext}
						aria-label="Next sibling run"
						title="Next sibling run"
					>
						<span aria-hidden="true">›</span>
					</button>
				</div>
			{/if}
		</header>

		<div class="transcript-scroll" bind:this={transcriptScrollEl}>
			<AgentRunTranscript {runId} />
		</div>

		<footer class="composer-footer" aria-label="Composer (read-only in child runs)">
			<div class="composer-shell">
				<textarea
					class="composer-input"
					disabled
					readonly
					rows="1"
					placeholder={viewState.composerPlaceholder}
					aria-label="Message input (disabled in child runs)"
				></textarea>
				<div class="composer-actions">
					<button
						type="button"
						class="composer-back-link"
						onclick={handleBack}
						aria-label={viewState.backLabel}
					>
						← Back to parent
					</button>
				</div>
			</div>
		</footer>
	</section>
{/if}

<style>
	.child-run-view {
		display: grid;
		grid-template-rows: auto 1fr auto;
		height: 100%;
		min-height: 0;
		overflow: hidden;
		background-color: var(--color-bg);
	}

	.loading {
		padding: var(--space-6);
		margin: var(--space-5) auto;
		max-width: 600px;
		text-align: center;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		background-color: var(--color-surface);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-md);
	}

	.breadcrumb-bar {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-5);
		border-bottom: 1px solid var(--color-border);
		background-color: var(--color-surface);
		font-size: var(--font-size-sm);
		flex-shrink: 0;
		min-width: 0;
	}

	.breadcrumb-back {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		background: none;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		color: var(--color-text-muted);
		cursor: pointer;
		font: inherit;
		font-size: var(--font-size-sm);
		min-width: 0;
		max-width: 40%;
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast),
			background-color var(--transition-fast);
	}

	.breadcrumb-back:hover {
		color: var(--color-text-primary);
		background-color: var(--color-surface-hover);
	}

	.breadcrumb-back:focus-visible {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: var(--glow-focus);
	}

	.breadcrumb-arrow {
		flex-shrink: 0;
		font-size: var(--font-size-md);
		line-height: 1;
	}

	.breadcrumb-parent-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.breadcrumb-separator {
		color: var(--color-text-disabled);
		flex-shrink: 0;
	}

	.breadcrumb-current {
		color: var(--color-text-primary);
		font-weight: var(--font-weight-medium);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.sibling-nav {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		margin-left: auto;
		flex-shrink: 0;
	}

	.sibling-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		background: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
		font: inherit;
		font-size: var(--font-size-md);
		line-height: 1;
		padding: 0;
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast),
			background-color var(--transition-fast);
	}

	.sibling-button:hover:not(:disabled) {
		color: var(--color-text-primary);
		background-color: var(--color-surface-hover);
		border-color: var(--color-border-strong, var(--color-border));
	}

	.sibling-button:focus-visible {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: var(--glow-focus);
	}

	.sibling-button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.sibling-counter {
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		font-variant-numeric: tabular-nums;
		padding: 0 var(--space-1);
		min-width: 3ch;
		text-align: center;
	}

	.transcript-scroll {
		overflow-y: auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.composer-footer {
		padding: var(--space-3) var(--space-5) var(--space-5);
		border-top: 1px solid var(--color-border);
		background-color: var(--color-surface);
		flex-shrink: 0;
	}

	.composer-shell {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		background-color: color-mix(
			in srgb,
			var(--color-surface-elevated) 60%,
			transparent
		);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-3);
		opacity: 0.75;
	}

	.composer-input {
		width: 100%;
		background: none;
		border: none;
		outline: none;
		resize: none;
		color: var(--color-text-disabled);
		font-family: var(--font-sans);
		font-size: var(--font-size-md);
		line-height: var(--line-height-base);
		min-height: 24px;
		padding: 0;
		cursor: not-allowed;
	}

	.composer-input::placeholder {
		color: var(--color-text-disabled);
		font-style: italic;
	}

	.composer-actions {
		display: flex;
		justify-content: flex-end;
	}

	.composer-back-link {
		background: none;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		color: var(--color-text-muted);
		cursor: pointer;
		font: inherit;
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast),
			background-color var(--transition-fast);
	}

	.composer-back-link:hover {
		color: var(--color-text-primary);
		background-color: var(--color-surface-hover);
	}

	.composer-back-link:focus-visible {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: var(--glow-focus);
	}

	@media (max-width: 640px) {
		.breadcrumb-bar {
			padding: var(--space-2) var(--space-3);
		}

		.composer-footer {
			padding: var(--space-2) var(--space-3) var(--space-3);
		}

		.breadcrumb-back {
			max-width: 50%;
		}

		.sibling-counter {
			display: none;
		}
	}
</style>
