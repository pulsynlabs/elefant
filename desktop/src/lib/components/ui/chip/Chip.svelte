<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		selected?: boolean;
		disabled?: boolean;
		dismissible?: boolean;
		onclick?: (event: MouseEvent) => void;
		/** Backwards-compat: legacy `onremove` callback renders a dismiss button. */
		onremove?: () => void;
		class?: string;
		leading?: Snippet;
		children?: Snippet;
		dismiss?: Snippet;
	};

	let {
		selected = false,
		disabled = false,
		dismissible,
		onclick,
		onremove,
		class: className = '',
		leading,
		children,
		dismiss,
	}: Props = $props();

	// Legacy `onremove` implies dismissible.
	const showDismiss = $derived(dismissible ?? Boolean(onremove));
	const interactive = $derived(Boolean(onclick) && !disabled);

	function handleDismiss(event: MouseEvent): void {
		event.stopPropagation();
		if (onremove) onremove();
	}
</script>

{#if interactive}
	<button
		type="button"
		class="chip quire-sm {className}"
		class:chip-leading={leading}
		class:chip-selected={selected}
		class:chip-disabled={disabled}
		disabled={disabled}
		aria-pressed={selected}
		{onclick}
	>
		{#if leading}
			<span class="chip-leading-slot">{@render leading()}</span>
		{/if}
		<span class="chip-content">{@render children?.()}</span>
		{#if showDismiss}
			{#if dismiss}
				{@render dismiss()}
			{:else}
				<span
					class="chip-dismiss"
					role="button"
					tabindex="-1"
					aria-label="Remove"
					onclick={handleDismiss}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							handleDismiss(e as unknown as MouseEvent);
						}
					}}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M18 6 6 18" />
						<path d="m6 6 12 12" />
					</svg>
				</span>
			{/if}
		{/if}
	</button>
{:else}
	<span
		class="chip quire-sm {className}"
		class:chip-leading={leading}
		class:chip-selected={selected}
		class:chip-disabled={disabled}
	>
		{#if leading}
			<span class="chip-leading-slot">{@render leading()}</span>
		{/if}
		<span class="chip-content">{@render children?.()}</span>
		{#if showDismiss}
			{#if dismiss}
				{@render dismiss()}
			{:else}
				<button
					type="button"
					class="chip-dismiss chip-dismiss-button"
					aria-label="Remove"
					onclick={handleDismiss}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M18 6 6 18" />
						<path d="m6 6 12 12" />
					</svg>
				</button>
			{/if}
		{/if}
	</span>
{/if}

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: 4px 10px;
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-regular);
		line-height: 1.4;
		color: var(--text-prose);
		white-space: nowrap;
		/* .quire-sm provides surface; override radius to full pill. */
		border-radius: var(--radius-full);
		font-variation-settings: 'opsz' 14, 'wght' 450;
	}

	.chip.chip-leading {
		padding-left: 8px;
	}

	/* Button form gets pointer + transition. */
	button.chip {
		appearance: none;
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			transform var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	button.chip:hover:not(.chip-disabled) {
		transform: translateY(-1px);
		border-color: var(--border-edge);
	}

	button.chip:active:not(.chip-disabled) {
		transform: translateY(0);
	}

	/* Selected state — indigo-tinted background + emphasis border. */
	.chip-selected {
		background: color-mix(
			in oklch,
			var(--color-primary) 18%,
			var(--surface-plate)
		);
		border-color: var(--border-emphasis);
		color: var(--text-prose);
	}

	:global([data-theme='light']) .chip-selected {
		background: color-mix(
			in oklch,
			var(--color-primary) 12%,
			var(--surface-plate)
		);
	}

	/* Disabled — global focus-visible still draws focus, no hover lift. */
	.chip-disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	button.chip-disabled:hover {
		transform: none;
	}

	.chip-leading-slot {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: var(--text-meta);
	}

	.chip-content {
		display: inline-flex;
		align-items: center;
	}

	/* Dismiss control — works for both <span role=button> inside <button>
	   and inline <button> next to a <span> chip. */
	.chip-dismiss {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		padding: 0;
		margin-right: -2px;
		border: none;
		background: transparent;
		color: var(--text-muted);
		border-radius: var(--radius-full);
		cursor: pointer;
		transition:
			color var(--transition-fast),
			background-color var(--transition-fast);
		flex-shrink: 0;
	}

	.chip-dismiss:hover {
		color: var(--text-prose);
		background: var(--surface-hover);
	}

	@media (prefers-reduced-motion: reduce) {
		button.chip:hover:not(.chip-disabled),
		button.chip:active:not(.chip-disabled) {
			transform: none;
		}
	}
</style>
