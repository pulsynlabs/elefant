<script lang="ts">
	import type { Snippet } from 'svelte';
	import { clsx } from 'clsx';

	type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
	type LevelNumber = 1 | 2 | 3 | 4 | 5 | 6;
	type HeadingSize = '4xl' | '3xl' | '2xl' | 'xl' | 'lg' | 'md' | 'sm';
	type FontWeight = 'light' | 'regular' | 'medium' | 'semibold' | 'bold';
	type Tracking = 'tight' | 'snug' | 'normal' | 'wide' | 'wider' | 'widest';
	type TextColor = 'primary' | 'secondary' | 'muted' | 'disabled' | 'inherit';
	type Tier = 'display' | 'title' | 'prose' | 'meta' | 'hero';
	type Tone = 'prose' | 'meta' | 'muted' | 'disabled';

	type Props = {
		/** Semantic heading level: 'h1'–'h6' or numeric 1–6. */
		level?: HeadingLevel | LevelNumber;
		/** Quire type tier — overrides default mapping based on level. */
		tier?: Tier;
		/** Quire tone — preferred new prop. */
		tone?: Tone;
		/** Italic display variant (Fraunces italic axis). */
		italic?: boolean;
		/** Legacy: explicit size override. */
		size?: HeadingSize;
		/** Legacy: explicit weight override. */
		weight?: FontWeight;
		/** Legacy: explicit tracking override. */
		tracking?: Tracking;
		/** Legacy: explicit color (mapped to tone). */
		color?: TextColor;
		class?: string;
		children?: Snippet;
	};

	let {
		level = 'h2',
		tier,
		tone,
		italic = false,
		size,
		weight,
		tracking,
		color,
		class: className = '',
		children,
	}: Props = $props();

	// Normalize numeric level → h-tag
	const tagLevel = $derived<HeadingLevel>(
		typeof level === 'number'
			? (`h${level}` as HeadingLevel)
			: level
	);

	// Default tier mapping from level
	const tierFromLevel: Record<HeadingLevel, Tier> = {
		h1: 'display',
		h2: 'display',
		h3: 'title',
		h4: 'meta',
		h5: 'meta',
		h6: 'meta',
	};

	const resolvedTier = $derived<Tier>(tier ?? tierFromLevel[tagLevel]);

	// Map legacy `color` to a Quire `tone` if `tone` not given.
	const colorToTone: Record<TextColor, Tone | null> = {
		primary: 'prose',
		secondary: 'meta',
		muted: 'muted',
		disabled: 'disabled',
		inherit: null,
	};
	const resolvedTone = $derived<Tone | null>(
		tone ?? (color ? colorToTone[color] : 'prose')
	);

	const tierClass = $derived(`text-${resolvedTier}`);

	// Optional legacy explicit size/weight/tracking still apply on top of the tier
	const classes = $derived(
		clsx(
			tierClass,
			italic && 'italic',
			resolvedTone && `tone-${resolvedTone}`,
			size && `text-${size}`,
			weight && `font-${weight}`,
			tracking && `tracking-${tracking}`,
			className
		)
	);
</script>

{#if tagLevel === 'h1'}
	<h1 class={classes}>{@render children?.()}</h1>
{:else if tagLevel === 'h2'}
	<h2 class={classes}>{@render children?.()}</h2>
{:else if tagLevel === 'h3'}
	<h3 class={classes}>{@render children?.()}</h3>
{:else if tagLevel === 'h4'}
	<h4 class={classes}>{@render children?.()}</h4>
{:else if tagLevel === 'h5'}
	<h5 class={classes}>{@render children?.()}</h5>
{:else}
	<h6 class={classes}>{@render children?.()}</h6>
{/if}

<style>
	/* Quire tone scope — these compose with the tier classes from typography.css */
	:global(.tone-prose) { color: var(--text-prose); }
	:global(.tone-meta) { color: var(--text-meta); }
	:global(.tone-muted) { color: var(--text-muted); }
	:global(.tone-disabled) { color: var(--text-disabled); }
</style>
