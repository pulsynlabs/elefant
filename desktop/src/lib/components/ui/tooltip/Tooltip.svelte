<script lang="ts">
	import type { Snippet } from 'svelte';

	type Position = 'top' | 'bottom' | 'left' | 'right';
	type Props = {
		content: string;
		position?: Position;
		class?: string;
		children?: Snippet;
	};

	let { content, position = 'top', class: className = '', children }: Props = $props();

	let visible = $state(false);
</script>

<span
	class="tooltip-wrapper {className}"
	role="group"
	onmouseenter={() => (visible = true)}
	onmouseleave={() => (visible = false)}
	onfocusin={() => (visible = true)}
	onfocusout={() => (visible = false)}
>
	{@render children?.()}
	{#if visible}
		<!-- role="tooltip" picks up the global Quire surface treatment from
		     shadcn-overrides.css (quire-lg material: blur, hairline, shadow). -->
		<span class="tooltip tooltip-{position}" role="tooltip">
			{content}
		</span>
	{/if}
</span>

<style>
	.tooltip-wrapper {
		position: relative;
		display: inline-flex;
		align-items: center;
	}

	.tooltip {
		position: absolute;
		z-index: var(--z-tooltip);
		padding: 6px 10px;
		border-radius: var(--radius-leaf);
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
		font-variation-settings: "opsz" 14, "wght" 400;
		line-height: var(--leading-snug);
		color: var(--text-prose);
		max-width: 280px;
		white-space: normal;
		text-align: center;
		pointer-events: none;
		/* Mount entry: opacity + 2px lift toward the trigger.
		   Background, border, blur, and shadow are inherited from the global
		   [role="tooltip"] block in shadcn-overrides.css (quire-lg material). */
		animation: tooltip-mount var(--duration-fast) var(--ease-out-quart);
	}

	.tooltip-top {
		bottom: calc(100% + 6px);
		left: 50%;
		transform: translateX(-50%);
	}
	.tooltip-bottom {
		top: calc(100% + 6px);
		left: 50%;
		transform: translateX(-50%);
	}
	.tooltip-left {
		right: calc(100% + 6px);
		top: 50%;
		transform: translateY(-50%);
	}
	.tooltip-right {
		left: calc(100% + 6px);
		top: 50%;
		transform: translateY(-50%);
	}

	/* Per-position entry: lift toward the trigger then settle. transform
	   composes the centring offset with a 2px translate along the axis. */
	@keyframes tooltip-mount {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.tooltip-top {
		animation-name: tooltip-mount-top;
	}
	.tooltip-bottom {
		animation-name: tooltip-mount-bottom;
	}
	.tooltip-left {
		animation-name: tooltip-mount-left;
	}
	.tooltip-right {
		animation-name: tooltip-mount-right;
	}

	@keyframes tooltip-mount-top {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(2px);
		}
		to {
			opacity: 1;
			transform: translateX(-50%) translateY(0);
		}
	}
	@keyframes tooltip-mount-bottom {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(-2px);
		}
		to {
			opacity: 1;
			transform: translateX(-50%) translateY(0);
		}
	}
	@keyframes tooltip-mount-left {
		from {
			opacity: 0;
			transform: translateY(-50%) translateX(2px);
		}
		to {
			opacity: 1;
			transform: translateY(-50%) translateX(0);
		}
	}
	@keyframes tooltip-mount-right {
		from {
			opacity: 0;
			transform: translateY(-50%) translateX(-2px);
		}
		to {
			opacity: 1;
			transform: translateY(-50%) translateX(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tooltip,
		.tooltip-top,
		.tooltip-bottom,
		.tooltip-left,
		.tooltip-right {
			animation: none;
		}
	}
</style>
