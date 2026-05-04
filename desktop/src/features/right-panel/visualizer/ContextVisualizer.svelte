<script lang="ts">
	import { HugeiconsIcon, CloseIcon } from '$lib/icons/index.js';
	import { tokenCounterStore, type TokenSegment } from '$lib/stores/token-counter.svelte.js';
	import { formatTokens } from '../TokenBar.svelte';
	import Treemap from './Treemap.svelte';

	type Props = {
		onClose: () => void;
	};

	let { onClose }: Props = $props();

	// ── Category color map (mirrors Treemap.svelte — kept here so the legend
	//    self-contains its dependency rather than importing an internal constant) ─
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

	// ── Store reads ─────────────────────────────────────────────────────────────
	const windowTokens = $derived(tokenCounterStore.windowTokens);
	const windowMax = $derived(tokenCounterStore.windowMax);
	const breakdown = $derived(tokenCounterStore.breakdown);

	// ── Progress bar ────────────────────────────────────────────────────────────
	const hasBudget = $derived(windowMax > 0);
	const percent = $derived(
		hasBudget ? Math.min(100, Math.max(0, (windowTokens / windowMax) * 100)) : 0,
	);
	const percentLabel = $derived(hasBudget ? `${Math.round(percent)}%` : '');

	// ── Legend ──────────────────────────────────────────────────────────────────
	const legendItems = $derived(
		[...breakdown]
			.sort((a, b) => b.tokens - a.tokens)
			.slice(0, 6)
			.map((seg) => ({
				color: CATEGORY_COLORS[seg.category] ?? 'var(--text-meta)',
				label: seg.label,
			})),
	);
	const moreItems = $derived(breakdown.length > 6);

	// ── Responsive treemap sizing via ResizeObserver ────────────────────────────
	let treemapContainerEl = $state<HTMLDivElement | null>(null);
	let treemapWidth = $state(280);
	let treemapHeight = $state(200);

	$effect(() => {
		const el = treemapContainerEl;
		if (!el) return;

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const { width, height } = entry.contentRect;
			if (width > 0 && height > 0) {
				treemapWidth = Math.floor(width);
				treemapHeight = Math.floor(height);
			}
		});

		observer.observe(el);
		return () => observer.disconnect();
	});

	// ── Keyboard close handler ──────────────────────────────────────────────────
	let closeBtn = $state<HTMLButtonElement | null>(null);

	// Focus the close button when the overlay mounts so keyboard users land
	// inside the dialog immediately.
	$effect(() => {
		requestAnimationFrame(() => closeBtn?.focus());
	});

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			onClose();
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<!-- svelte-ignore a11y_role_supports_aria_props_implicit -->
<div
	class="context-visualizer"
	role="dialog"
	aria-modal="true"
	aria-label="Context window usage"
	tabindex="-1"
	onkeydown={handleKeydown}
>
	<!-- ── Header ─────────────────────────────────────────────────────────── -->
	<div class="viz-header">
		<span class="viz-title">Context Window</span>
		<span class="viz-counts">{formatTokens(windowTokens)} / {formatTokens(windowMax)}</span>
		<button
			bind:this={closeBtn}
			type="button"
			class="viz-close-btn"
			onclick={onClose}
			aria-label="Close visualizer"
		>
			<HugeiconsIcon icon={CloseIcon} size={16} strokeWidth={1.8} />
		</button>
	</div>

	<!-- ── Progress bar ───────────────────────────────────────────────────── -->
	<div class="viz-progress" aria-hidden="true">
		<div class="viz-progress-track">
			<div class="viz-progress-fill" style:width="{percent}%"></div>
		</div>
		{#if hasBudget}
			<span class="viz-progress-label">{percentLabel}</span>
		{/if}
	</div>

	<!-- ── Treemap ────────────────────────────────────────────────────────── -->
	<div class="viz-treemap" bind:this={treemapContainerEl}>
		<Treemap
			segments={breakdown}
			width={treemapWidth}
			height={treemapHeight}
		/>
	</div>

	<!-- ── Legend ─────────────────────────────────────────────────────────── -->
	<div class="viz-legend">
		{#each legendItems as item (item.label)}
			<span class="viz-legend-item">
				<span class="viz-legend-swatch" style:background={item.color}></span>
				<span class="viz-legend-label">{item.label}</span>
			</span>
		{/each}
		{#if moreItems}
			<span class="viz-legend-more" aria-label={`${breakdown.length - 6} more categories`}>…</span>
		{/if}
	</div>
</div>

<style>
	.context-visualizer {
		position: absolute;
		inset: 0;
		z-index: var(--z-dropdown, 10);
		display: flex;
		flex-direction: column;
		background-color: var(--surface-plate);
		color: var(--text-prose);
		/* Rounded top-corners soften the overlay without interfering with
		   the panel-content's border-radius. */
		border-radius: var(--radius-md, 6px) var(--radius-md, 6px) 0 0;
	}

	/* ── Header (40 px) ──────────────────────────────────────────────────── */
	.viz-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		height: 40px;
		padding: 0 var(--space-3);
		border-bottom: 1px solid var(--border-subtle, var(--border-hairline));
		flex-shrink: 0;
	}

	.viz-title {
		font-size: 13px;
		font-weight: 600;
		letter-spacing: 0.01em;
	}

	.viz-counts {
		flex: 1;
		text-align: right;
		font-size: 12px;
		font-family: var(--font-mono, 'JetBrains Mono', monospace);
		color: var(--text-meta);
		font-variant-numeric: tabular-nums;
	}

	.viz-close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: var(--radius-sm, 4px);
		background: transparent;
		color: var(--text-meta);
		cursor: pointer;
		flex-shrink: 0;
		transition: background-color var(--transition-fast), color var(--transition-fast);
	}

	.viz-close-btn:hover {
		background-color: var(--surface-hover);
		color: var(--text-prose);
	}

	.viz-close-btn:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	/* ── Progress bar (~28 px) ────────────────────────────────────────────── */
	.viz-progress {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		height: 28px;
		padding: 0 var(--space-3);
		flex-shrink: 0;
	}

	.viz-progress-track {
		flex: 1;
		height: 6px;
		background-color: var(--border-subtle, var(--border-hairline));
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.viz-progress-fill {
		height: 100%;
		background-color: var(--color-primary);
		border-radius: var(--radius-full);
		transition: width var(--transition-fast);
	}

	.viz-progress-label {
		font-size: 11px;
		font-weight: 500;
		color: var(--text-meta);
		font-variant-numeric: tabular-nums;
		min-width: 28px;
		text-align: right;
	}

	/* ── Treemap area ─────────────────────────────────────────────────────── */
	.viz-treemap {
		flex: 1 1 0;
		min-height: 0;
		padding: 0 var(--space-3);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}

	/* ── Legend (32 px) ───────────────────────────────────────────────────── */
	.viz-legend {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		height: 32px;
		padding: 0 var(--space-3);
		border-top: 1px solid var(--border-subtle, var(--border-hairline));
		flex-shrink: 0;
		overflow: hidden;
	}

	.viz-legend-item {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		flex-shrink: 0;
	}

	.viz-legend-swatch {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
		flex-shrink: 0;
	}

	.viz-legend-label {
		font-size: 11px;
		color: var(--text-meta);
		white-space: nowrap;
	}

	.viz-legend-more {
		font-size: 11px;
		color: var(--text-muted);
	}
</style>
