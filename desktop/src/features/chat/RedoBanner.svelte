<script lang="ts">
	/**
	 * RedoBanner — slim, non-blocking banner that surfaces redo
	 * availability above the chat input.
	 *
	 * Renders only when `chatStore.canRedo === true` (gating is the
	 * caller's responsibility — the banner itself just shows). The
	 * parent wraps the banner in `{#if canRedo}`; Svelte's
	 * `transition:slide` then handles the in/out animation, sliding
	 * the bar down on appear and up on disappear so the chat input
	 * doesn't visually jump.
	 *
	 * Visual recipe (Quire tokens only):
	 *   - background: --surface-hover
	 *   - bottom border only (subtle separator from the chat input)
	 *   - --font-size-sm + --text-muted body copy
	 *   - "Redo" affordance uses --color-primary with a subtle
	 *     hover background so it reads as a calm action, not a
	 *     hard call-to-action.
	 *
	 * The banner is a single-line flex row (label left, button right);
	 * it sits inside the same flex column as the message list and
	 * input so the layout naturally rebalances when it appears or
	 * disappears.
	 */
	import { slide } from 'svelte/transition';

	type Props = {
		redoCount: number;
		onRedo: () => void;
	};

	let { redoCount, onRedo }: Props = $props();

	// Pluralisation: "1 message undone" / "2 messages undone". Kept
	// as a derived so the label stays in sync if `redoCount` changes
	// while the banner is mounted (e.g. a second undo while still
	// visible).
	const label = $derived(
		`↩ ${redoCount} message${redoCount !== 1 ? 's' : ''} undone`,
	);
</script>

<!--
  Slide transition is applied to the root so the banner cleanly
  collapses to/from zero height when the parent toggles
  `{#if canRedo}`. 200ms matches the project's --duration-base
  motion token (250ms) closely without feeling sluggish in the
  small-distance Y-axis case.
-->
<div
	class="redo-banner"
	role="status"
	aria-live="polite"
	transition:slide={{ duration: 200, axis: 'y' }}
>
	<span class="redo-banner__label">{label}</span>
	<button
		type="button"
		class="redo-banner__action"
		onclick={onRedo}
		aria-label="Redo last undone message"
	>
		Redo
	</button>
</div>

<style>
	.redo-banner {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-2) var(--space-4);
		background-color: var(--surface-hover);
		/* Bottom border only — pairs visually with the chat input
		   beneath without competing with surrounding card edges. */
		border-bottom: 1px solid var(--border-hairline);
		font-size: var(--font-size-sm);
		color: var(--text-muted);
	}

	.redo-banner__label {
		/* Truncate gracefully if the layout ever gets squeezed
		   (e.g. very narrow viewport) — the count + "Redo" button
		   are the load-bearing parts, not the full text. */
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.redo-banner__action {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 2px var(--space-2);
		background-color: transparent;
		border: none;
		border-radius: var(--radius-sm);
		font-family: inherit;
		font-size: var(--font-size-sm);
		font-weight: 500;
		color: var(--color-primary);
		cursor: pointer;
		transition: var(--transition-base);
	}

	.redo-banner__action:hover {
		background-color: var(--color-primary-subtle);
	}

	.redo-banner__action:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
</style>
