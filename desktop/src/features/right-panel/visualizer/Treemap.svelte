<script lang="ts">
	import type { TokenSegment } from '$lib/stores/token-counter.svelte.js';
	import { computeTreemap, type TreemapRect } from './treemap-layout.js';

	const CATEGORY_COLORS: Record<TokenSegment['category'], string> = {
		system: 'var(--color-primary)',
		messages: 'var(--color-success, #22c55e)',
		tools: 'var(--color-warning, #f59e0b)',
		active_tool_calls: 'var(--color-error, #ef4444)',
		mcp_schemas: '#8b5cf6',
		file_contents: '#06b6d4',
		images: '#ec4899',
		assistant_output: '#f97316',
		other: 'var(--text-meta)',
	};

	type Props = {
		segments: TokenSegment[];
		width?: number;
		height?: number;
	};

	let { segments, width = 280, height = 200 }: Props = $props();

	const rects = $derived(computeTreemap(segments, width, height));

	let tooltip = $state<TreemapRect | null>(null);
	let tooltipX = $state(0);
	let tooltipY = $state(0);

	const tooltipStyle = $derived(
		`left:${Math.max(0, Math.min(width - 100, tooltipX))}px;top:${Math.max(0, Math.min(height - 44, tooltipY - 40))}px`,
	);

	function showTooltip(event: MouseEvent, rect: TreemapRect) {
		const target = event.currentTarget;
		if (!(target instanceof SVGGElement)) {
			tooltip = rect;
			return;
		}

		const bounds = target.ownerSVGElement?.getBoundingClientRect();
		if (!bounds) {
			tooltip = rect;
			return;
		}

		tooltip = rect;
		tooltipX = event.clientX - bounds.left;
		tooltipY = event.clientY - bounds.top;
	}

	function hideTooltip() {
		tooltip = null;
	}
</script>

<div class="treemap-container" style={`width:${width}px;height:${height}px`}>
	<svg {width} {height} role="img" aria-label="Context window usage treemap">
		{#if rects.length === 0}
			<rect x="0" y="0" {width} {height} fill="var(--surface-substrate)" stroke="var(--border-subtle)" stroke-width="1" rx="4" />
			<text
				x={width / 2}
				y={height / 2}
				font-size="12"
				fill="var(--text-meta)"
				font-family="var(--font-mono)"
				text-anchor="middle"
				dominant-baseline="middle"
			>
				No data
			</text>
		{:else}
			{#each rects as rect}
				<g
					role="button"
					tabindex="0"
					aria-label={`${rect.label} — ${rect.tokens.toLocaleString()} tokens (${rect.percent.toFixed(1)}%)`}
					onmouseenter={(event) => showTooltip(event, rect)}
					onmousemove={(event) => showTooltip(event, rect)}
					onmouseleave={hideTooltip}
					onfocus={() => {
						tooltip = rect;
						tooltipX = Math.max(0, rect.x0);
						tooltipY = Math.max(0, rect.y0);
					}}
					onblur={hideTooltip}
				>
					<rect
						x={rect.x0}
						y={rect.y0}
						width={Math.max(0, rect.x1 - rect.x0)}
						height={Math.max(0, rect.y1 - rect.y0)}
						fill={CATEGORY_COLORS[rect.category]}
						stroke="var(--surface-substrate)"
						stroke-width="1"
						rx="2"
					/>
					{#if rect.x1 - rect.x0 > 40 && rect.y1 - rect.y0 > 20}
						<text
							x={rect.x0 + 6}
							y={rect.y0 + 14}
							font-size="11"
							fill="white"
							font-family="var(--font-mono)"
							pointer-events="none"
						>
							{rect.label}
						</text>
					{/if}
				</g>
			{/each}
		{/if}
	</svg>

	{#if tooltip}
		<div class="treemap-tooltip" style={tooltipStyle}>
			<strong>{tooltip.label}</strong><br />
			{tooltip.tokens.toLocaleString()} tokens ({tooltip.percent.toFixed(1)}%)
		</div>
	{/if}
</div>

<style>
	.treemap-container {
		position: relative;
	}

	.treemap-tooltip {
		position: absolute;
		background: var(--surface-leaf);
		border: 1px solid var(--border-default, var(--border-subtle));
		border-radius: var(--radius-md, 6px);
		padding: var(--space-1) var(--space-2);
		font-size: 12px;
		pointer-events: none;
		white-space: nowrap;
		z-index: 10;
		color: var(--text-prose);
		font-family: var(--font-mono);
		box-shadow: var(--shadow-md);
	}
</style>
