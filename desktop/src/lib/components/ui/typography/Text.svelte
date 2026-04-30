<script lang="ts">
	import type { Snippet } from 'svelte';
	import { clsx } from 'clsx';

	type TextVariant = 'body' | 'caption' | 'label' | 'mono' | 'code';
	type TextSize = '2xs' | 'xs' | 'sm' | 'md' | 'base' | 'lg' | 'xl';
	type FontWeight = 'light' | 'regular' | 'medium' | 'semibold' | 'bold';
	type TextColor = 'primary' | 'secondary' | 'muted' | 'disabled' | 'inherit';
	type TextElement = 'p' | 'span' | 'div' | 'label';
	type Tier = 'caption' | 'meta' | 'body' | 'prose';
	type Tone = 'prose' | 'meta' | 'muted' | 'disabled';

	type Props = {
		/** Render tag. Preferred new prop. */
		tag?: TextElement;
		/** Legacy alias for tag. */
		as?: TextElement;
		/** Quire type tier. */
		tier?: Tier;
		/** Quire tone. */
		tone?: Tone;
		/** Italic body variant (Newsreader italic axis). */
		italic?: boolean;
		/** Legacy variant — maps to tier. */
		variant?: TextVariant;
		/** Legacy explicit size override. */
		size?: TextSize;
		/** Legacy explicit weight override. */
		weight?: FontWeight;
		/** Legacy color — mapped to tone. */
		color?: TextColor;
		class?: string;
		children?: Snippet;
	};

	let {
		tag,
		as,
		tier,
		tone,
		italic = false,
		variant,
		size,
		weight,
		color,
		class: className = '',
		children,
	}: Props = $props();

	const element = $derived<TextElement>(tag ?? as ?? 'span');

	// Map legacy variant → tier
	const variantToTier: Record<TextVariant, Tier> = {
		body: 'body',
		caption: 'caption',
		label: 'meta',
		mono: 'meta',
		code: 'meta',
	};

	const resolvedTier = $derived<Tier>(
		tier ?? (variant ? variantToTier[variant] : 'body')
	);

	// Map legacy color → tone
	const colorToTone: Record<TextColor, Tone | null> = {
		primary: 'prose',
		secondary: 'meta',
		muted: 'muted',
		disabled: 'disabled',
		inherit: null,
	};
	const resolvedTone = $derived<Tone | null>(
		tone ?? (color ? colorToTone[color] : null)
	);

	const isMono = $derived(variant === 'mono' || variant === 'code');

	const classes = $derived(
		clsx(
			`text-${resolvedTier}`,
			italic && 'italic',
			isMono && 'font-mono',
			resolvedTone && `tone-${resolvedTone}`,
			size && `text-${size}`,
			weight && `font-${weight}`,
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
