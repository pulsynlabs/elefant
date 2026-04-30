<script lang="ts">
	type Orientation = 'horizontal' | 'vertical';
	type Tone = 'hairline' | 'edge' | 'emphasis';

	type Props = {
		orientation?: Orientation;
		tone?: Tone;
		/** Optional label — when provided, the divider becomes a labeled separator
		 *  with a centered mono caps label sitting on the line. */
		label?: string;
		class?: string;
	};

	let {
		orientation = 'horizontal',
		tone = 'hairline',
		label,
		class: className = '',
	}: Props = $props();
</script>

{#if label && orientation === 'horizontal'}
	<div
		class="divider-labeled tone-{tone} {className}"
		role="separator"
		aria-orientation="horizontal"
	>
		<span class="text-caption divider-label">{label}</span>
	</div>
{:else if orientation === 'vertical'}
	<span
		class="divider-vertical tone-{tone} {className}"
		role="separator"
		aria-orientation="vertical"
	></span>
{:else}
	<hr class="divider-horizontal tone-{tone} {className}" />
{/if}

<style>
	/* Tone-driven 1px hairlines — token references only. */
	.divider-horizontal {
		border: none;
		height: 1px;
		width: 100%;
		margin: 0;
		background: var(--border-hairline);
	}

	.divider-horizontal.tone-edge { background: var(--border-edge); }
	.divider-horizontal.tone-emphasis { background: var(--border-emphasis); }

	.divider-vertical {
		display: inline-block;
		width: 1px;
		align-self: stretch;
		min-height: 1em;
		flex-shrink: 0;
		background: var(--border-hairline);
	}

	.divider-vertical.tone-edge { background: var(--border-edge); }
	.divider-vertical.tone-emphasis { background: var(--border-emphasis); }

	/* Labeled horizontal — line / label / line composition. */
	.divider-labeled {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
	}

	.divider-labeled::before,
	.divider-labeled::after {
		content: '';
		flex: 1 1 auto;
		height: 1px;
		background: var(--border-hairline);
	}

	.divider-labeled.tone-edge::before,
	.divider-labeled.tone-edge::after {
		background: var(--border-edge);
	}

	.divider-labeled.tone-emphasis::before,
	.divider-labeled.tone-emphasis::after {
		background: var(--border-emphasis);
	}

	.divider-label {
		flex: 0 0 auto;
		white-space: nowrap;
	}
</style>
