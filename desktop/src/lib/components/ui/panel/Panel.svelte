<script lang="ts">
	import type { Snippet } from 'svelte';

	type Padding = 'none' | 'sm' | 'md' | 'lg';

	type Props = {
		/** Optional plain-text title. Falls back to the `title` snippet if both provided. */
		title?: string;
		/** Padding scale applied to the panel body. */
		padding?: Padding;
		/** Extra classes appended to the outer surface. */
		class?: string;
		/**
		 * Snippet form of title — Fraunces serif at the title tier. Takes
		 * precedence over the `title` string prop when both are set.
		 */
		titleSnippet?: Snippet;
		/** Optional Geist Sans subtitle below the title. */
		subtitle?: Snippet;
		/** Right-aligned toolbar — typically actions, mono caps metadata. */
		toolbar?: Snippet;
		/** Footer separated by a hairline divider above. */
		footer?: Snippet;
		/** Body content. */
		children?: Snippet;
	};

	let {
		title,
		padding = 'md',
		class: className = '',
		titleSnippet,
		subtitle,
		toolbar,
		footer,
		children,
	}: Props = $props();

	const paddingValues: Record<Padding, string> = {
		none: '0',
		sm: 'var(--space-3)',
		md: 'var(--space-5)',
		lg: 'var(--space-7)',
	};

	const hasHeader = $derived(Boolean(title || titleSnippet || subtitle || toolbar));
</script>

<section
	class="panel quire-md {className}"
	style="--panel-padding: {paddingValues[padding]}"
>
	{#if hasHeader}
		<header class="panel-header">
			<div class="panel-heading">
				{#if titleSnippet}
					{@render titleSnippet()}
				{:else if title}
					<h3 class="panel-title">{title}</h3>
				{/if}
				{#if subtitle}
					<p class="panel-subtitle">{@render subtitle()}</p>
				{/if}
			</div>
			{#if toolbar}
				<div class="panel-toolbar">
					{@render toolbar()}
				</div>
			{/if}
		</header>
	{/if}

	<div class="panel-body">
		{@render children?.()}
	</div>

	{#if footer}
		<footer class="panel-footer">
			{@render footer()}
		</footer>
	{/if}
</section>

<style>
	.panel {
		border-radius: var(--radius-plate);
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.panel-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-4) var(--panel-padding);
		border-bottom: 1px solid var(--border-hairline);
	}

	.panel-heading {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0; /* allow truncation in flex */
	}

	.panel-title {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--font-size-xl);
		font-variation-settings: "opsz" 24, "wght" 420;
		letter-spacing: var(--tracking-snug);
		line-height: var(--leading-tight);
		color: var(--text-prose);
	}

	.panel-subtitle {
		margin: 0;
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
		line-height: var(--leading-snug);
		color: var(--text-meta);
	}

	.panel-toolbar {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: var(--font-size-2xs);
		font-weight: var(--font-weight-medium);
		letter-spacing: var(--tracking-widest);
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.panel-body {
		padding: var(--panel-padding);
		flex: 1 1 auto;
		min-height: 0;
	}

	.panel-footer {
		padding: var(--space-3) var(--panel-padding);
		border-top: 1px solid var(--border-hairline);
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-2);
	}
</style>
