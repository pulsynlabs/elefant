<script lang="ts">
	import type { Snippet } from 'svelte';

	type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error';
	/** Legacy alias kept for backward compatibility with existing consumers. */
	type LegacyVariant = 'default' | 'primary' | 'success' | 'warning' | 'error';

	type Props = {
		tone?: Tone;
		/** Backwards-compat alias; `default` maps to `neutral`. */
		variant?: LegacyVariant;
		class?: string;
		children?: Snippet;
	};

	let {
		tone,
		variant,
		class: className = '',
		children,
	}: Props = $props();

	const resolvedTone: Tone = $derived(
		(tone ?? (variant === 'default' ? 'neutral' : (variant as Tone)) ?? 'neutral') as Tone
	);
</script>

<span class="tag tag-{resolvedTone} {className}">
	{@render children?.()}
</span>

<style>
	.tag {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 2px 10px;
		border-radius: var(--radius-full);
		border: 1px solid var(--border-hairline);
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-regular);
		font-style: italic;
		line-height: 1.45;
		white-space: nowrap;
		font-variation-settings: 'opsz' 14, 'wght' 420;
		/* Default subtle plate fill (overridden per-tone below). */
		background: color-mix(in oklch, var(--surface-plate) 70%, transparent);
		color: var(--text-meta);
	}

	.tag-neutral {
		color: var(--text-meta);
	}

	.tag-primary {
		color: var(--color-primary);
		background: color-mix(in oklch, var(--color-primary) 10%, transparent);
		border-color: color-mix(in oklch, var(--color-primary) 28%, transparent);
	}

	.tag-success {
		color: var(--color-success);
		background: color-mix(in oklch, var(--color-success) 10%, transparent);
		border-color: color-mix(in oklch, var(--color-success) 28%, transparent);
	}

	.tag-warning {
		color: var(--color-warning);
		background: color-mix(in oklch, var(--color-warning) 10%, transparent);
		border-color: color-mix(in oklch, var(--color-warning) 28%, transparent);
	}

	.tag-error {
		color: var(--color-error);
		background: color-mix(in oklch, var(--color-error) 10%, transparent);
		border-color: color-mix(in oklch, var(--color-error) 28%, transparent);
	}
</style>
