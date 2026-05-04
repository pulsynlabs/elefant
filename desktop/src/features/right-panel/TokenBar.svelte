<script lang="ts" module>
	/**
	 * Compact "abbreviated" formatter for token counts.
	 *
	 * Spec (W1.T3 / MH7):
	 *   <    1,000        → "999"      (raw integer)
	 *    1,000–999,999    → "14.2k"    (one decimal, dropped if zero)
	 *   ≥ 1,000,000       → "1.04m"    (two decimals, always shown)
	 *
	 * Negative inputs are clamped to 0 (token counts are never negative;
	 * a defensive clamp avoids "-0.0k" rendering glitches if upstream
	 * data is briefly inconsistent during streaming).
	 *
	 * Exported from a `<script module>` block so unit tests and other
	 * components in Wave 5 (T5.3 treemap, T5.4 visualizer) can reuse the
	 * same helper without duplicating the rounding rules.
	 */
	export function formatTokens(value: number): string {
		if (!Number.isFinite(value) || value <= 0) return '0';

		if (value < 1_000) {
			return Math.floor(value).toString();
		}

		if (value < 1_000_000) {
			const scaled = value / 1_000;
			// One decimal, dropped when it would be ".0" so we render
			// "14k" rather than "14.0k" — matches the spec example.
			const rounded = Math.round(scaled * 10) / 10;
			return Number.isInteger(rounded) ? `${rounded}k` : `${rounded.toFixed(1)}k`;
		}

		const scaled = value / 1_000_000;
		// Two decimals always — spec shows "1.04m" so trailing zeros stay.
		return `${scaled.toFixed(2)}m`;
	}
</script>

<script lang="ts">
	// W5.T2: TokenBar now consumes the live `tokenCounterStore` directly
	// instead of receiving placeholder numeric props. The store is bound
	// to the active session by RightPanel.svelte (its parent), and pushes
	// 4 Hz throttled updates from the daemon's per-session SSE feed.
	//
	// SPEC MH7: live updates ≤ 500 ms; window resets on compaction;
	// session total monotonic across compactions.
	import { tokenCounterStore } from '$lib/stores/token-counter.svelte.js';
	import { chatStore } from '../chat/chat.svelte.js';

	type Props = {
		/**
		 * Optional click handler — fires when the user clicks the bar.
		 * In W5.T4 this opens the Context Window Visualizer; if omitted,
		 * the bar renders as a non-interactive readout.
		 */
		onVisualizerOpen?: () => void;
	};

	let { onVisualizerOpen }: Props = $props();

	const isInteractive = $derived(typeof onVisualizerOpen === 'function');

	// Read live counts from the store. These re-evaluate whenever the
	// store's $state fields change (every flush from the SSE pipeline).
	const windowTokens = $derived(tokenCounterStore.windowTokens);
	const windowMax = $derived(tokenCounterStore.windowMax);
	const sessionTokens = $derived(tokenCounterStore.sessionTokens);

	// Clamp the percentage to [0, 100] so an over-budget window (which
	// can briefly happen at the edges of streaming) never paints a bar
	// wider than its track. Division-guard: when `windowMax` is 0 we
	// hide the percentage label and render an empty bar.
	const hasBudget = $derived(windowMax > 0);
	const percent = $derived(
		hasBudget ? Math.min(100, Math.max(0, (windowTokens / windowMax) * 100)) : 0,
	);
	const percentLabel = $derived(hasBudget ? `${Math.round(percent)}%` : '');

	const windowLabel = $derived(`${formatTokens(windowTokens)} / ${formatTokens(windowMax)}`);
	const sessionLabel = $derived(`Session: ${formatTokens(sessionTokens)} total`);

	// Stable a11y label combining both metrics in one announcement so
	// screen readers don't have to crawl through the visual layout.
	const ariaLabel = $derived(
		`Context window: ${windowLabel}${hasBudget ? `, ${percentLabel}` : ''}. ${sessionLabel}.`,
	);

	// Subtle pulse on the window-token readout while the assistant is
	// streaming. We tie the cue to `chatStore.isStreaming` rather than
	// debouncing token deltas locally so the animation reliably starts
	// at stream-open and stops at stream-close even when the SSE flush
	// debounce silences brief value plateaus mid-stream.
	const isStreaming = $derived(chatStore.isStreaming);

	function handleClick() {
		onVisualizerOpen?.();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!isInteractive) return;
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onVisualizerOpen?.();
		}
	}
</script>

<!--
  Render as <button> only when a click handler is supplied — otherwise
  the bar is a passive readout and shouldn't expose button semantics
  (a screen-reader user pressing Enter on a no-op button is worse than
  no affordance at all). Both branches share the same visual markup.
-->
{#if isInteractive}
	<button
		type="button"
		class="token-bar token-bar-interactive"
		aria-label={ariaLabel}
		onclick={handleClick}
		onkeydown={handleKeydown}
	>
		<div class="token-bar-row">
			<span class="window-label" class:is-streaming={isStreaming}>
				<span class="arrow" aria-hidden="true">↕</span>
				{windowLabel}
			</span>
			{#if hasBudget}
				<span class="percent-label">{percentLabel}</span>
			{/if}
		</div>

		<div class="progress-track" aria-hidden="true">
			<div class="progress-fill" style:width="{percent}%"></div>
		</div>

		<div class="session-label">{sessionLabel}</div>
	</button>
{:else}
	<div class="token-bar" role="group" aria-label={ariaLabel}>
		<div class="token-bar-row">
			<span class="window-label" class:is-streaming={isStreaming}>
				<span class="arrow" aria-hidden="true">↕</span>
				{windowLabel}
			</span>
			{#if hasBudget}
				<span class="percent-label">{percentLabel}</span>
			{/if}
		</div>

		<div class="progress-track" aria-hidden="true">
			<div class="progress-fill" style:width="{percent}%"></div>
		</div>

		<div class="session-label">{sessionLabel}</div>
	</div>
{/if}

<style>
	.token-bar {
		/* Footer height contract from RightPanel.svelte — keeping the
		   value here as a hard min-height ensures the bar always fills
		   the reserved 48px slot even when a parent forgets to apply
		   the footer's min-height. */
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: var(--space-1);
		width: 100%;
		min-height: 48px;
		padding: var(--space-2) var(--space-3);
		background-color: var(--surface-substrate);
		color: var(--text-prose);
		/* Top border distinguishes the footer from .panel-content above
		   it; the footer's outer border-top is owned by RightPanel's
		   .panel-footer rule, so this hairline is the inner detail. */
		border-top: 1px solid var(--border-subtle, var(--border-hairline));
		font-family: inherit;
		text-align: left;
		box-sizing: border-box;
	}

	/* Interactive variant: <button> resets browser chrome and exposes
	   pointer + focus states. The non-interactive variant inherits the
	   base .token-bar styles and renders cursor:default by default. */
	.token-bar-interactive {
		appearance: none;
		border: none;
		border-top: 1px solid var(--border-subtle, var(--border-hairline));
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			color var(--transition-fast);
	}

	.token-bar-interactive:hover {
		background-color: var(--surface-hover);
	}

	.token-bar-interactive:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.token-bar-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		font-size: 12px;
		line-height: 1.2;
		color: var(--text-prose);
		font-variant-numeric: tabular-nums;
	}

	.window-label {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-1);
		font-weight: 500;
	}

	/* Streaming pulse: the window-token readout breathes opacity while
	   the assistant is mid-stream. 0.9s loop, ease-in-out, infinite —
	   slow enough to read as "live" without being distracting. The
	   global @media (prefers-reduced-motion) guard in tokens.css
	   neutralises this for users who opt out. */
	.window-label.is-streaming {
		animation: token-pulse 0.9s ease-in-out infinite;
	}

	@keyframes token-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.6;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.window-label.is-streaming {
			animation: none;
		}
	}

	.arrow {
		font-size: 11px;
		line-height: 1;
		color: var(--text-meta);
	}

	.percent-label {
		font-size: 11px;
		font-weight: 500;
		color: var(--text-meta);
		font-variant-numeric: tabular-nums;
	}

	.progress-track {
		position: relative;
		width: 100%;
		height: 2px;
		background-color: var(--border-subtle, var(--border-hairline));
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background-color: var(--color-primary);
		border-radius: var(--radius-full);
		/* Smooth width transitions so streaming updates ease in rather
		   than snap. The global reduced-motion guard in tokens.css
		   neutralises this for users who opt out. */
		transition: width var(--transition-fast);
	}

	.session-label {
		font-size: 11px;
		line-height: 1.2;
		color: var(--text-meta);
		font-variant-numeric: tabular-nums;
	}
</style>
