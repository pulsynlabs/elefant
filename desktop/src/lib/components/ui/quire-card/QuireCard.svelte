<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		/** Adds a hover lift + interactive treatment. */
		hoverable?: boolean;
		/** Extra classes appended to the outer plate. */
		class?: string;
		/** Card body. */
		children?: Snippet;
		/** Click handler — when set, the card renders as a <button>. */
		onclick?: () => void;
	};

	let { hoverable = false, class: className = '', children, onclick }: Props = $props();
</script>

<!--
	QuireCard — the signature surface of the Quire material.

	Internally uses the `quire-plate` outer + `quire-leaf` inner pair
	(defined in quire.css) with mathematically concentric radii. Renders
	as a <button> when an onclick handler is supplied; otherwise a <div>.
	All visual properties resolve through Quire tokens.
-->

{#if onclick}
	<button
		class="quire-card-shell quire-plate {hoverable ? 'quire-interactive' : ''} {className}"
		class:hoverable
		{onclick}
		type="button"
	>
		<span class="quire-leaf quire-card-leaf">
			{@render children?.()}
		</span>
	</button>
{:else}
	<div
		class="quire-card-shell quire-plate {hoverable ? 'quire-interactive' : ''} {className}"
		class:hoverable
	>
		<div class="quire-leaf quire-card-leaf">
			{@render children?.()}
		</div>
	</div>
{/if}

<style>
	/* The shell holds the bezel; the leaf carries content padding so the
	   2px plate margin remains visible as the binding edge. */
	.quire-card-shell {
		width: 100%;
		text-align: left;
		display: block;
	}

	button.quire-card-shell {
		cursor: pointer;
		font: inherit;
		color: inherit;
		appearance: none;
		background: color-mix(in oklch, var(--surface-plate) 80%, transparent);
		border: 1px solid var(--border-hairline);
	}

	.quire-card-leaf {
		display: block;
		padding: var(--space-5);
		color: var(--text-prose);
	}

	/* Hover lift — composes with the .quire-interactive class from quire.css.
	   Local rule preserves the existing hoverable API: a subtle vertical
	   shift plus an indigo ambient glow. */
	.quire-card-shell.hoverable {
		transition:
			transform var(--transition-fast),
			box-shadow var(--transition-fast),
			border-color var(--transition-fast);
	}

	.quire-card-shell.hoverable:hover {
		transform: translateY(-1px);
		box-shadow: var(--glow-primary);
	}

	.quire-card-shell.hoverable:active {
		transform: translateY(0) scale(0.995);
	}

	@media (prefers-reduced-motion: reduce) {
		.quire-card-shell.hoverable,
		.quire-card-shell.hoverable:hover,
		.quire-card-shell.hoverable:active {
			transform: none;
			transition: box-shadow var(--transition-fast), border-color var(--transition-fast);
		}
	}
</style>
