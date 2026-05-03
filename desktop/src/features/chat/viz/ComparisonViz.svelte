<script lang="ts">
	// Comparison viz renderer — two side-by-side cards with shared
	// visual treatment. Each side carries a title and a flat list of
	// items; this is a deliberately simple layout, with NH polish
	// (diff highlight, mirrored alignment) deferred per the spec.
	// Collapses to a single column on narrow viewports so the chat
	// transcript stays readable in the mobile drawer.

	import type { VizRendererProps } from './types.js';

	let { envelope }: VizRendererProps = $props();

	interface Side {
		title: string;
		items: string[];
	}

	interface ComparisonData {
		left: Side;
		right: Side;
	}

	const data = $derived(envelope.data as unknown as ComparisonData);
	const sides = $derived<Side[]>([data.left, data.right]);
</script>

<div class="comparison-viz">
	{#if envelope.title}
		<p class="comp-title">{envelope.title}</p>
	{/if}
	<div class="grid">
		{#each sides as side, si (si)}
			<section class="side" aria-label={side.title}>
				<h4 class="side-title">{side.title}</h4>
				<ul class="side-items">
					{#each side.items as item, i (i)}
						<li class="side-item">{item}</li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>
</div>

<style>
	.comparison-viz {
		margin: var(--space-2) 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.comp-title {
		margin: 0;
		color: var(--text-meta);
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}

	@media (max-width: 480px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}

	.side {
		background: var(--surface-leaf);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.side-title {
		margin: 0;
		color: var(--text-prose);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		font-weight: 600;
	}

	.side-items {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.side-item {
		color: var(--text-meta);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		line-height: 1.5;
		padding-left: var(--space-2);
		border-left: 2px solid var(--border-edge);
	}
</style>
