<script lang="ts">
	import type { Snippet } from 'svelte';
	import { clsx } from 'clsx';

	type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
	type HeadingSize = '4xl' | '3xl' | '2xl' | 'xl' | 'lg' | 'md' | 'sm';
	type FontWeight = 'light' | 'regular' | 'medium' | 'semibold' | 'bold';
	type Tracking = 'tight' | 'snug' | 'normal' | 'wide' | 'wider' | 'widest';
	type TextColor = 'primary' | 'secondary' | 'muted' | 'disabled' | 'inherit';

	type Props = {
		level?: HeadingLevel;
		size?: HeadingSize;
		weight?: FontWeight;
		tracking?: Tracking;
		color?: TextColor;
		class?: string;
		children?: Snippet;
	};

	let {
		level = 'h2',
		size,
		weight = 'semibold',
		tracking = 'tight',
		color = 'primary',
		class: className = '',
		children,
	}: Props = $props();

	const defaultSizes: Record<HeadingLevel, HeadingSize> = {
		h1: '4xl',
		h2: '3xl',
		h3: '2xl',
		h4: 'xl',
		h5: 'lg',
		h6: 'md',
	};

	const resolvedSize = $derived(size ?? defaultSizes[level]);

	const classes = $derived(
		clsx(
			`text-${resolvedSize}`,
			`font-${weight}`,
			`tracking-${tracking}`,
			color !== 'inherit' && `text-color-${color}`,
			className
		)
	);
</script>

{#if level === 'h1'}
	<h1 class={classes}>{@render children?.()}</h1>
{:else if level === 'h2'}
	<h2 class={classes}>{@render children?.()}</h2>
{:else if level === 'h3'}
	<h3 class={classes}>{@render children?.()}</h3>
{:else if level === 'h4'}
	<h4 class={classes}>{@render children?.()}</h4>
{:else if level === 'h5'}
	<h5 class={classes}>{@render children?.()}</h5>
{:else}
	<h6 class={classes}>{@render children?.()}</h6>
{/if}

<style>
	:global(.text-color-primary) { color: var(--color-text-primary); }
	:global(.text-color-secondary) { color: var(--color-text-secondary); }
	:global(.text-color-muted) { color: var(--color-text-muted); }
	:global(.text-color-disabled) { color: var(--color-text-disabled); }
</style>
