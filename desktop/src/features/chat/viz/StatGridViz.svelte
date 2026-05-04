<script lang="ts">
	// Stat grid viz renderer.
	//
	// Custom CSS grid + inline SVG trend glyphs — no charting library.
	// Each card is a `--surface-leaf` plate inside the same `--space-2`
	// gap rhythm as the surrounding transcript. Tabular numerals keep
	// the value column aligned across cards even when the lengths
	// differ (e.g. "1,234" next to "98").

	import type { VizRendererProps } from './types.js';
	import {
		formatDelta,
		formatValue,
		trendToColorToken,
		type Trend,
	} from './stat-grid-state.js';

	let { envelope }: VizRendererProps = $props();

	interface StatItem {
		label: string;
		value: string | number;
		delta?: number;
		trend?: Trend;
	}

	// The daemon-side Zod schema validates the payload shape before it
	// reaches the renderer, so the cast surfaces the typed structure
	// without re-validating. `items` defaults to an empty array so a
	// malformed envelope renders an empty grid instead of crashing.
	const items = $derived(
		(envelope.data as { items?: StatItem[] }).items ?? [],
	);
</script>

{#if envelope.title}
	<p class="grid-title">{envelope.title}</p>
{/if}

<div
	class="stat-grid"
	role="list"
	aria-label={envelope.title ?? envelope.intent}
>
	{#each items as item, i (i)}
		<div class="stat-card" role="listitem">
			<span class="stat-label">{item.label}</span>
			<span class="stat-value">{formatValue(item.value)}</span>
			{#if item.delta !== undefined || item.trend !== undefined}
				<span
					class="stat-delta"
					style="color: {trendToColorToken(item.trend)}"
				>
					{#if item.trend === 'up'}
						<svg
							width="10"
							height="10"
							viewBox="0 0 10 10"
							aria-hidden="true"
							fill="currentColor"
						>
							<path d="M5 1 L9 9 L1 9 Z" />
						</svg>
					{:else if item.trend === 'down'}
						<svg
							width="10"
							height="10"
							viewBox="0 0 10 10"
							aria-hidden="true"
							fill="currentColor"
						>
							<path d="M5 9 L9 1 L1 1 Z" />
						</svg>
					{:else if item.trend === 'flat'}
						<svg
							width="10"
							height="4"
							viewBox="0 0 10 4"
							aria-hidden="true"
							fill="currentColor"
						>
							<rect x="0" y="1" width="10" height="2" rx="1" />
						</svg>
					{/if}
					{#if item.delta !== undefined}
						<span class="stat-delta-text">{formatDelta(item.delta)}</span>
					{/if}
				</span>
			{/if}
		</div>
	{/each}
</div>

<style>
	.grid-title {
		color: var(--text-meta);
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 var(--space-2) 0;
	}

	.stat-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: var(--space-2);
		margin: var(--space-2) 0;
	}

	.stat-card {
		background: var(--surface-leaf);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		box-shadow: var(--shadow-xs);
		transition: border-color var(--transition-fast);
	}

	.stat-card:hover {
		border-color: var(--border-edge);
	}

	.stat-label {
		color: var(--text-muted);
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		line-height: 1.4;
	}

	.stat-value {
		color: var(--text-prose);
		font-family: var(--font-sans);
		font-size: var(--font-size-lg);
		font-weight: 600;
		line-height: 1.2;
		font-variant-numeric: tabular-nums;
	}

	.stat-delta {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}

	.stat-delta-text {
		display: inline-block;
	}
</style>
