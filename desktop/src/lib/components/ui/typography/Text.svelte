<script lang="ts">
	import type { Snippet } from 'svelte';
	import { clsx } from 'clsx';

	type TextVariant = 'body' | 'caption' | 'label' | 'mono' | 'code';
	type TextSize = '2xs' | 'xs' | 'sm' | 'md' | 'base' | 'lg' | 'xl';
	type FontWeight = 'light' | 'regular' | 'medium' | 'semibold' | 'bold';
	type TextColor = 'primary' | 'secondary' | 'muted' | 'disabled' | 'inherit';
	type TextElement = 'p' | 'span' | 'div' | 'label';

	type Props = {
		variant?: TextVariant;
		size?: TextSize;
		weight?: FontWeight;
		color?: TextColor;
		as?: TextElement;
		class?: string;
		children?: Snippet;
	};

	let {
		variant = 'body',
		size,
		weight,
		color,
		as: element = 'span',
		class: className = '',
		children,
	}: Props = $props();

	const variantDefaults: Record<TextVariant, { size: TextSize; weight: FontWeight; color: TextColor }> = {
		body: { size: 'base', weight: 'regular', color: 'primary' },
		caption: { size: 'xs', weight: 'regular', color: 'muted' },
		label: { size: 'sm', weight: 'medium', color: 'secondary' },
		mono: { size: 'sm', weight: 'regular', color: 'secondary' },
		code: { size: 'sm', weight: 'regular', color: 'primary' },
	};

	const defaults = $derived(variantDefaults[variant]);
	const resolvedSize = $derived(size ?? defaults.size);
	const resolvedWeight = $derived(weight ?? defaults.weight);
	const resolvedColor = $derived(color ?? defaults.color);

	const isMono = $derived(variant === 'mono' || variant === 'code');

	const classes = $derived(
		clsx(
			`text-${resolvedSize}`,
			`font-${resolvedWeight}`,
			isMono && 'font-mono',
			resolvedColor !== 'inherit' && `text-color-${resolvedColor}`,
			className
		)
	);
</script>

{#if element === 'p'}
	<p class={classes}>{@render children?.()}</p>
{:else if element === 'div'}
	<div class={classes}>{@render children?.()}</div>
{:else if element === 'label'}
	<label class={classes}>{@render children?.()}</label>
{:else}
	<span class={classes}>{@render children?.()}</span>
{/if}

<style>
	:global(.font-mono) { font-family: var(--font-mono); }
</style>
