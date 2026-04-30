<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		class?: string;
		children?: Snippet;
	};

	let { class: className = '', children }: Props = $props();
</script>

<code class="inline-code {className}">{@render children?.()}</code>

<style>
	.inline-code {
		font-family: var(--font-mono);
		font-size: 0.92em;
		font-variant-numeric: tabular-nums;
		color: inherit;
		/* Subtle indigo tint — dark-theme default; light overrides below. */
		background: rgba(64, 73, 225, 0.16);
		border-radius: var(--radius-xs);
		padding: 1px 4px;
		/* Avoid tightening the surrounding line-height. */
		line-height: inherit;
	}

	:global([data-theme="light"]) .inline-code {
		background: rgba(64, 73, 225, 0.07);
	}
</style>
