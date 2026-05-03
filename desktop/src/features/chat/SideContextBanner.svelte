<script lang="ts">
	/**
	 * SideContextBanner — persistent mode indicator that surfaces
	 * "side context" state above the message list.
	 *
	 * Renders only when `chatStore.isSideContext === true`. The
	 * parent (ChatView) wraps this in `{#if chatStore.isSideContext}`
	 * so Svelte's `transition:slide` cleanly collapses the banner
	 * to/from zero height on entry and exit — mirroring the
	 * RedoBanner pattern so layout shifts feel coherent across the
	 * chat surface.
	 *
	 * Visual recipe (Quire tokens only):
	 *   - background: `--surface-hover` (matches RedoBanner so the
	 *     two banners feel like a coherent system when stacked)
	 *   - left border: 2px `--color-primary` accent stripe — this
	 *     is the "visually distinct" cue required by MH4. The right
	 *     and top edges stay flush; only the bottom hairline + left
	 *     stripe carry visual weight, so the banner reads as a calm
	 *     mode indicator rather than an alert.
	 *   - bottom hairline: `--border-hairline` (matches RedoBanner)
	 *   - label: `--font-size-sm` `--text-meta` for body, with the
	 *     "Side context" prefix in `--text-prose` for emphasis
	 *   - button: outlined, `--color-primary` text, calm hover —
	 *     touch-target enforced at ≥44px via min-height/min-width
	 *     so it satisfies the mobile-regression check on small
	 *     viewports without bloating the desktop layout.
	 *
	 * Reduced-motion: the slide transition is applied at the parent
	 * level; the local `:focus-visible` outline uses a token-driven
	 * step that already respects motion preferences. We additionally
	 * suppress the button's hover transition when the user has
	 * `prefers-reduced-motion: reduce` set, so focus/hover changes
	 * are instantaneous for that audience.
	 */
	import { chatStore } from './chat.svelte.js';
	import { slide } from 'svelte/transition';

	type Props = {
		/**
		 * Invoked when the user clicks "Return to main". Parent wires
		 * this to `chatStore.exitSideContext()` so the banner stays
		 * presentational and store mutations remain owned by ChatView.
		 */
		onReturn: () => void;
	};

	let { onReturn }: Props = $props();
</script>

{#if chatStore.isSideContext}
	<!--
	  role="status" + aria-live="polite" announces the mode change to
	  assistive tech without interrupting the user — matches the
	  RedoBanner contract for consistency. The banner is not a
	  modal/dialog; the user can keep typing while it's visible.
	-->
	<div
		class="side-context-banner"
		role="status"
		aria-live="polite"
		transition:slide={{ duration: 200, axis: 'y' }}
	>
		<span class="side-context-banner__label">
			<span class="side-context-banner__title">Side context</span>
			<span class="side-context-banner__separator" aria-hidden="true">·</span>
			<span class="side-context-banner__hint">main conversation paused</span>
		</span>
		<button
			type="button"
			class="side-context-banner__return-btn"
			onclick={onReturn}
			aria-label="Return to main conversation"
		>
			Return to main
		</button>
	</div>
{/if}

<style>
	.side-context-banner {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		width: 100%;
		/* Slightly larger vertical padding than RedoBanner — this is a
		   persistent mode indicator, not a transient affordance, so it
		   earns a touch more breathing room. Horizontal padding matches
		   the RedoBanner so the two banners align when stacked. */
		padding: var(--space-3) var(--space-4);
		background-color: var(--surface-hover);
		/* Left accent stripe carries the "visually distinct" cue
		   required by MH4 without introducing a new background color
		   token. 2px reads clearly on both light and dark themes. */
		border-left: 2px solid var(--color-primary);
		border-bottom: 1px solid var(--border-hairline);
		font-size: var(--font-size-sm);
		color: var(--text-meta);
	}

	.side-context-banner__label {
		display: inline-flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--space-2);
		min-width: 0;
		/* Truncate gracefully on very narrow viewports — the title +
		   button are the load-bearing parts. */
		overflow: hidden;
	}

	.side-context-banner__title {
		color: var(--text-prose);
		font-weight: 500;
	}

	.side-context-banner__separator {
		color: var(--text-muted);
	}

	.side-context-banner__hint {
		color: var(--text-meta);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.side-context-banner__return-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		/* Touch-target floor — mobile-regression enforces ≥44×44px on
		   every interactive element. We hit the floor with min-height
		   and min-width while keeping visual padding modest so the
		   button doesn't dominate the bar. */
		min-height: 44px;
		min-width: 44px;
		padding: var(--space-1) var(--space-3);
		background-color: transparent;
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-sm);
		font-family: inherit;
		font-size: var(--font-size-sm);
		font-weight: 500;
		color: var(--color-primary);
		cursor: pointer;
		transition: var(--transition-fast);
	}

	.side-context-banner__return-btn:hover {
		background-color: var(--color-primary-subtle);
		border-color: color-mix(
			in oklch,
			var(--color-primary) 30%,
			var(--border-hairline)
		);
	}

	.side-context-banner__return-btn:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	@media (prefers-reduced-motion: reduce) {
		.side-context-banner__return-btn {
			transition: none;
		}
	}
</style>
