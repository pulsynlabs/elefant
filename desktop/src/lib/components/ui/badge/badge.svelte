<script lang="ts">
	import type { Snippet } from 'svelte';

	type Tone =
		| 'default'
		| 'primary'
		| 'success'
		| 'warning'
		| 'error'
		| 'info'
		| 'muted';
	type Variant = 'soft' | 'solid' | 'outline';

	type Props = {
		tone?: Tone;
		variant?: Variant;
		class?: string;
		children?: Snippet;
	};

	let {
		tone = 'default',
		variant = 'soft',
		class: className = '',
		children,
	}: Props = $props();
</script>

<span class="badge badge-tone-{tone} badge-variant-{variant} {className}">
	{@render children?.()}
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 2px 8px;
		border-radius: var(--radius-full);
		border: 1px solid transparent;
		font-family: var(--font-mono);
		font-size: var(--font-size-2xs);
		font-weight: var(--font-weight-medium);
		letter-spacing: var(--tracking-widest);
		text-transform: uppercase;
		line-height: 1.5;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	/* Tone defines the colour expressed through --badge-color. */
	.badge-tone-default {
		--badge-color: var(--text-meta);
	}

	.badge-tone-primary {
		--badge-color: var(--color-primary);
	}

	.badge-tone-success {
		--badge-color: var(--color-success);
	}

	.badge-tone-warning {
		--badge-color: var(--color-warning);
	}

	.badge-tone-error {
		--badge-color: var(--color-error);
	}

	.badge-tone-info {
		--badge-color: var(--color-info);
	}

	.badge-tone-muted {
		--badge-color: var(--text-disabled);
	}

	/* Variant: soft — tinted background, brand-coloured text. */
	.badge-variant-soft {
		background: color-mix(in oklch, var(--badge-color) 14%, transparent);
		color: var(--badge-color);
	}

	/* Variant: solid — filled background. Foreground tuned per tone group. */
	.badge-variant-solid {
		background: var(--badge-color);
		color: var(--text-inverse);
	}

	/* Default + muted + info read better with prose foreground on solid. */
	.badge-tone-default.badge-variant-solid,
	.badge-tone-muted.badge-variant-solid,
	.badge-tone-info.badge-variant-solid {
		color: var(--text-prose);
	}

	/* Primary solid keeps the foreground token explicitly. */
	.badge-tone-primary.badge-variant-solid {
		color: var(--color-primary-foreground);
	}

	/* Variant: outline — transparent fill, hairline border. */
	.badge-variant-outline {
		background: transparent;
		border-color: var(--badge-color);
		color: var(--badge-color);
	}
</style>
