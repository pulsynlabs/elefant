<script lang="ts">
	type Props = {
		/** Is extended thinking mode currently active? */
		pressed: boolean;
		/** True when the active model does not support thinking. */
		disabled?: boolean;
		/** Tooltip text shown when disabled (e.g. "Model doesn't support thinking"). */
		disabledReason?: string;
		/** Fired on click / Space / Enter when not disabled. */
		onToggle: () => void;
	};

	let {
		pressed,
		disabled = false,
		disabledReason,
		onToggle,
	}: Props = $props();

	// Stable id so aria-describedby can point to the tooltip element.
	const tooltipId = `thinking-toggle-tip-${Math.random().toString(36).slice(2, 9)}`;

	const showTooltip = $derived(disabled && !!disabledReason);

	function handleClick() {
		if (disabled) return;
		onToggle();
	}
</script>

<button
	type="button"
	class="thinking-toggle"
	class:is-pressed={pressed}
	class:is-disabled={disabled}
	aria-pressed={pressed}
	aria-disabled={disabled}
	aria-label="Toggle thinking mode"
	aria-describedby={showTooltip ? tooltipId : undefined}
	disabled={disabled}
	onclick={handleClick}
>
	<!-- Tiny diamond glyph reads as "spark of thought" without leaning on emoji -->
	<svg
		class="thinking-toggle__icon"
		viewBox="0 0 16 16"
		width="12"
		height="12"
		aria-hidden="true"
		focusable="false"
	>
		<path
			d="M8 1.5 L9.6 6.4 L14.5 8 L9.6 9.6 L8 14.5 L6.4 9.6 L1.5 8 L6.4 6.4 Z"
			fill="currentColor"
		/>
	</svg>
	<span class="thinking-toggle__label">{pressed ? 'Thinking' : 'Think'}</span>

	{#if showTooltip}
		<span id={tooltipId} class="thinking-toggle__tooltip" role="tooltip">
			{disabledReason}
		</span>
	{/if}
</button>

<style>
	.thinking-toggle {
		/* Layout — pill that sits inline alongside other toolbar buttons */
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-3);
		min-height: 28px;

		/* Surface */
		background-color: var(--surface-leaf);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-full);

		/* Typography */
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		font-weight: 500;
		line-height: 1;
		color: var(--text-meta);

		/* Reset native button chrome */
		cursor: pointer;
		appearance: none;
		-webkit-appearance: none;
		user-select: none;

		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	/* Hover on the unpressed state — lift surface, brighten text */
	.thinking-toggle:not(.is-pressed):not(.is-disabled):hover {
		background-color: var(--surface-hover);
		color: var(--text-prose);
	}

	/* Active / pressed — soft indigo tint, primary text + border, gentle glow */
	.thinking-toggle.is-pressed {
		background-color: var(--color-primary-subtle);
		border-color: var(--border-emphasis);
		color: var(--color-primary);
		box-shadow: var(--glow-primary);
	}

	/* Hover on pressed — sharpen the border to full primary */
	.thinking-toggle.is-pressed:not(.is-disabled):hover {
		border-color: var(--color-primary);
	}

	/* Focus — replace browser outline with token-driven ring */
	.thinking-toggle:focus {
		outline: none;
	}
	.thinking-toggle:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}
	.thinking-toggle.is-pressed:focus-visible {
		/* Combine the active glow with the focus ring so users still see both signals */
		box-shadow: var(--glow-primary), var(--glow-focus);
	}

	/* Disabled — flatten and lock pointer */
	.thinking-toggle.is-disabled,
	.thinking-toggle:disabled {
		opacity: 0.45;
		cursor: not-allowed;
		box-shadow: none;
	}
	/* Block hover/active visuals from sneaking in via inner content */
	.thinking-toggle.is-disabled > * {
		pointer-events: none;
	}

	.thinking-toggle__icon {
		flex-shrink: 0;
		display: block;
		/* Icon inherits text color so it tracks pressed/hover states automatically */
	}

	.thinking-toggle__label {
		display: inline-block;
		letter-spacing: 0.01em;
	}

	/* Tooltip — pure CSS, only rendered when disabled + reason supplied.
	   Hidden by default; revealed on hover/focus of the (disabled) button. */
	.thinking-toggle__tooltip {
		position: absolute;
		bottom: calc(100% + var(--space-2));
		left: 50%;
		transform: translateX(-50%);
		z-index: 10;

		padding: var(--space-1) var(--space-2);
		background-color: var(--surface-leaf);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-md);
		color: var(--text-prose);
		font-size: var(--font-size-xs);
		line-height: 1.3;
		white-space: nowrap;

		opacity: 0;
		pointer-events: none;
		transition: opacity var(--transition-fast);
	}

	.thinking-toggle:hover .thinking-toggle__tooltip,
	.thinking-toggle:focus-visible .thinking-toggle__tooltip {
		opacity: 1;
	}

	/* Reduced motion — respect user preference, drop transitions */
	@media (prefers-reduced-motion: reduce) {
		.thinking-toggle,
		.thinking-toggle__tooltip {
			transition: none;
		}
	}
</style>
