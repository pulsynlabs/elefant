<!--
@component
FrontmatterPillBar — surfaces the locked-contract metadata of a Research Base
file as a row of pills under the sticky header.

Hierarchy:
  • Confidence pill: color-coded chip drawing attention to trust level
  • Tag chips: zero or more, indigo-tinted
  • Sources count: collapsible disclosure (sources are URLs, often long)
  • Updated date: relative ("2d ago") with absolute on hover
  • Author agent: subdued chip, low visual weight

The bar uses a soft indigo wash via color-mix instead of a heavy gradient
image so it parses identically in light + dark themes and respects user
theme switches without an extra paint.
-->
<script lang="ts">
	import type { ResearchFrontmatter } from '$lib/daemon/types.js';

	type Props = {
		frontmatter: ResearchFrontmatter;
	};

	let { frontmatter }: Props = $props();

	let sourcesOpen = $state(false);

	const confidence = $derived(frontmatter.confidence ?? 'medium');
	const tags = $derived(frontmatter.tags ?? []);
	const sources = $derived(frontmatter.sources ?? []);

	/**
	 * Render an ISO-8601 timestamp as a short relative tag ("2d ago"),
	 * falling back to the raw value if parsing fails. Recomputed on every
	 * frontmatter change so component remounts always show fresh values
	 * without an interval timer.
	 */
	const updatedRelative = $derived.by(() => {
		const raw = frontmatter.updated;
		if (!raw) return '—';
		const ts = Date.parse(raw);
		if (Number.isNaN(ts)) return raw;
		const diffMs = Date.now() - ts;
		const minutes = Math.floor(diffMs / 60_000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days < 30) return `${days}d ago`;
		const months = Math.floor(days / 30);
		if (months < 12) return `${months}mo ago`;
		return `${Math.floor(months / 12)}y ago`;
	});
</script>

<div class="pill-bar" aria-label="Document metadata">
	<span
		class="pill confidence-pill"
		data-level={confidence}
		title="Confidence: {confidence}"
	>
		<span class="confidence-dot" aria-hidden="true"></span>
		<span class="pill-label">Confidence</span>
		<span class="pill-value">{confidence}</span>
	</span>

	{#if tags.length > 0}
		<ul class="tag-list" aria-label="Tags">
			{#each tags as tag (tag)}
				<li class="tag-chip">{tag}</li>
			{/each}
		</ul>
	{/if}

	{#if sources.length > 0}
		<button
			type="button"
			class="pill sources-pill"
			aria-expanded={sourcesOpen}
			aria-controls="frontmatter-sources"
			onclick={() => (sourcesOpen = !sourcesOpen)}
		>
			<span class="pill-label">Sources</span>
			<span class="pill-value">{sources.length}</span>
		</button>
	{/if}

	<span class="pill meta-pill" title={frontmatter.updated || ''}>
		<span class="pill-label">Updated</span>
		<span class="pill-value">{updatedRelative}</span>
	</span>

	{#if frontmatter.author_agent}
		<span class="pill meta-pill author-pill">
			<span class="pill-label">By</span>
			<span class="pill-value">{frontmatter.author_agent}</span>
		</span>
	{/if}
</div>

{#if sourcesOpen && sources.length > 0}
	<ol id="frontmatter-sources" class="sources-list" aria-label="Sources">
		{#each sources as source, i (i)}
			<li class="source-item">
				<a href={source} target="_blank" rel="noreferrer noopener">{source}</a>
			</li>
		{/each}
	</ol>
{/if}

<style>
	.pill-bar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-6);
		/* Soft indigo wash composed from primary-subtle + transparent — no
		   raster image, theme-reactive, GPU-cheap. */
		background: linear-gradient(
			to bottom,
			var(--color-primary-subtle),
			transparent
		);
		border-bottom: 1px solid var(--border-hairline);
	}

	.pill {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 4px var(--space-2);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-sm);
		background-color: var(--surface-leaf);
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		color: var(--text-meta);
		line-height: 1;
		white-space: nowrap;
	}

	.pill-label {
		font-family: var(--font-mono);
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-muted);
	}

	.pill-value {
		font-weight: 500;
		color: var(--text-prose);
		text-transform: capitalize;
	}

	/* --- Confidence pill -------------------------------------------------
	   Color-coded indicator. Uses the semantic tokens so it respects light
	   and dark theme variants automatically. */
	.confidence-pill {
		gap: 6px;
	}

	.confidence-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background-color: var(--text-muted);
	}

	.confidence-pill[data-level='high'] .confidence-dot {
		background-color: var(--color-success);
		box-shadow: 0 0 6px color-mix(in oklch, var(--color-success) 40%, transparent);
	}

	.confidence-pill[data-level='medium'] .confidence-dot {
		background-color: var(--color-warning);
	}

	.confidence-pill[data-level='low'] .confidence-dot {
		background-color: var(--color-error);
	}

	/* --- Tag list -------------------------------------------------------- */
	.tag-list {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 6px;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.tag-chip {
		display: inline-flex;
		align-items: center;
		padding: 3px var(--space-2);
		border-radius: var(--radius-sm);
		background-color: var(--color-primary-subtle);
		color: var(--color-primary);
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		font-weight: 500;
		line-height: 1;
		border: 1px solid color-mix(in oklch, var(--color-primary) 18%, transparent);
	}

	/* --- Sources pill (interactive) ------------------------------------- */
	.sources-pill {
		cursor: pointer;
		transition: background-color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.sources-pill:hover {
		background-color: var(--surface-hover);
		border-color: var(--border-edge);
	}

	.sources-pill:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.sources-pill[aria-expanded='true'] {
		border-color: var(--border-emphasis);
	}

	/* --- Author pill — even more subdued than meta -------------------- */
	.author-pill {
		opacity: 0.85;
	}

	/* --- Sources list --------------------------------------------------- */
	.sources-list {
		margin: 0;
		padding: var(--space-3) var(--space-6) var(--space-3) calc(var(--space-6) + var(--space-4));
		background-color: var(--surface-leaf);
		border-bottom: 1px solid var(--border-hairline);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--text-meta);
	}

	.source-item {
		padding: 2px 0;
		overflow-wrap: anywhere;
	}

	.source-item a {
		color: var(--color-primary);
		text-decoration: none;
		transition: color var(--transition-fast);
	}

	.source-item a:hover {
		text-decoration: underline;
		color: var(--color-primary-hover);
	}

	.source-item a:focus-visible {
		outline: none;
		text-decoration: underline;
		box-shadow: var(--glow-focus);
		border-radius: var(--radius-xs);
	}
</style>
