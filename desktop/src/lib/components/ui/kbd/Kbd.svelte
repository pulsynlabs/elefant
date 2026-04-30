<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		class?: string;
		children?: Snippet;
	};

	let { class: className = '', children }: Props = $props();
</script>

<kbd class="kbd quire-sm {className}">{@render children?.()}</kbd>

<style>
	.kbd {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
		font-variant-numeric: tabular-nums;
		letter-spacing: var(--tracking-wide);
		color: var(--text-meta);
		border-radius: var(--radius-sm);
		padding: 2px 6px;
		min-width: 20px;
		line-height: 1;
		white-space: nowrap;
		vertical-align: baseline;
	}
</style>
