<script lang="ts">
	/**
	 * BranchNavigator — slim, non-blocking navigator that surfaces the
	 * current fork branch position above the chat input.
	 *
	 * Renders only when at least one fork branch exists (i.e.
	 * `chatStore.forkBranchCount > 0`). The implicit "root" branch
	 * created by the store on first fork means once the user has
	 * forked once, the navigator stays visible and lets them step
	 * between the root, the first fork, and any subsequent forks.
	 *
	 * Visual recipe (Quire tokens only) mirrors `RedoBanner`:
	 *   - background: --surface-hover
	 *   - bottom border only — pairs visually with the chat input
	 *     beneath without competing with surrounding card edges
	 *   - --font-size-sm body copy in --text-muted
	 *   - prev/next chevron buttons share the 28×28 transparent-at-rest
	 *     recipe used by the message-bubble action cluster
	 *
	 * Streaming guard: both navigation buttons are disabled while
	 * `chatStore.isStreaming` is true so a branch swap can never
	 * interrupt an in-flight assistant response.
	 */
	import { chatStore } from './chat.svelte.js';
	import { slide } from 'svelte/transition';

	const branches = $derived(chatStore.forkBranches);
	const activeBranchId = $derived(chatStore.activeBranchId);
	const count = $derived(chatStore.forkBranchCount);

	// `activeBranchId === null` only happens transiently before the
	// store creates the implicit root branch; treat it as "first
	// branch" so the index/label stay consistent.
	const activeIndex = $derived(
		activeBranchId === null
			? 0
			: branches.findIndex((b) => b.id === activeBranchId),
	);

	const activeLabel = $derived(
		activeBranchId === null
			? 'Root'
			: (branches.find((b) => b.id === activeBranchId)?.label ?? 'Branch'),
	);

	const atFirst = $derived(activeIndex <= 0);
	const atLast = $derived(activeIndex >= count - 1);

	function goPrev() {
		if (atFirst || chatStore.isStreaming) return;
		const target = branches[activeIndex - 1];
		if (target) chatStore.switchToBranch(target.id);
	}

	function goNext() {
		if (atLast || chatStore.isStreaming) return;
		const target = branches[activeIndex + 1];
		if (target) chatStore.switchToBranch(target.id);
	}
</script>

{#if count > 0}
	<!--
	  Slide transition mirrors RedoBanner so the navigator collapses
	  cleanly to/from zero height when the parent's `{#if count > 0}`
	  toggles. 200ms keeps the motion proportional to the small Y-axis
	  distance — long enough to read as intentional, short enough that
	  it never blocks input.
	-->
	<div
		class="branch-nav"
		role="navigation"
		aria-label="Conversation branches"
		transition:slide={{ duration: 200, axis: 'y' }}
	>
		<button
			type="button"
			class="branch-nav__btn"
			onclick={goPrev}
			disabled={atFirst || chatStore.isStreaming}
			aria-label="Previous branch"
		>
			<svg
				width="12"
				height="12"
				viewBox="0 0 12 12"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
			>
				<path
					d="M7.5 2L3.5 6L7.5 10"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</button>

		<span class="branch-nav__label">
			<span class="branch-nav__count">
				Branch {activeIndex + 1} of {count}
			</span>
			<span class="branch-nav__sep" aria-hidden="true">·</span>
			<span class="branch-nav__name" title={activeLabel}>{activeLabel}</span>
		</span>

		<button
			type="button"
			class="branch-nav__btn"
			onclick={goNext}
			disabled={atLast || chatStore.isStreaming}
			aria-label="Next branch"
		>
			<svg
				width="12"
				height="12"
				viewBox="0 0 12 12"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
			>
				<path
					d="M4.5 2L8.5 6L4.5 10"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</button>
	</div>
{/if}

<style>
	.branch-nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-2) var(--space-4);
		background-color: var(--surface-hover);
		/* Bottom border only — pairs visually with the chat input beneath
		   without competing with surrounding card edges (matches
		   RedoBanner). */
		border-bottom: 1px solid var(--border-hairline);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		color: var(--text-muted);
		user-select: none;
	}

	.branch-nav__label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: 1;
		min-width: 0;
		justify-content: center;
	}

	.branch-nav__count {
		font-weight: 600;
		font-size: var(--font-size-xs);
		letter-spacing: 0.05em;
		text-transform: uppercase;
		white-space: nowrap;
		color: var(--text-muted);
	}

	.branch-nav__sep {
		color: var(--text-disabled);
	}

	.branch-nav__name {
		font-size: var(--font-size-xs);
		color: var(--text-prose);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 180px;
	}

	/* Prev/next buttons share the 28×28 transparent-at-rest recipe used
	   by `.undo-btn` / `.fork-btn` in MessageBubble — keeps the action
	   vocabulary consistent across the chat surface. */
	.branch-nav__btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		flex-shrink: 0;
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast),
			background-color var(--transition-fast);
	}

	.branch-nav__btn:hover:not(:disabled) {
		color: var(--text-prose);
		border-color: var(--border-emphasis);
		background-color: var(--surface-hover);
	}

	.branch-nav__btn:focus-visible {
		outline: 2px solid var(--border-emphasis);
		outline-offset: 2px;
	}

	.branch-nav__btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
