<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		/** Plain-text title. Required for backward-compat with existing consumers. */
		title: string;
		/** Optional plain-text description (Geist Sans body). */
		description?: string;
		/** Optional icon snippet rendered above the title (~32px). */
		icon?: Snippet;
		/** Optional action snippet below the body — typically a button. */
		action?: Snippet;
		/** Extra classes appended to the outer wrapper. */
		class?: string;
	};

	let { title, description, icon, action, class: className = '' }: Props = $props();
</script>

<div class="empty-state {className}" role="status">
	{#if icon}
		<span class="empty-icon" aria-hidden="true">
			{@render icon()}
		</span>
	{/if}

	<p class="empty-title">{title}</p>

	{#if description}
		<p class="empty-description">{description}</p>
	{/if}

	{#if action}
		<div class="empty-action">
			{@render action()}
		</div>
	{/if}
</div>

<style>
	/* Editorial empty state — pure typographic composition; no card, no
	   surface. The page-grade serif title and Geist Sans body do the work.
	   Vertical rhythm: 16px icon→title, 12px title→body, 24px body→action. */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: var(--space-9) var(--space-6);
	}

	.empty-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		color: var(--text-muted);
		margin-bottom: 16px;
		flex-shrink: 0;
	}

	.empty-title {
		margin: 0;
		font-family: var(--font-display);
		font-style: italic;
		font-size: var(--font-size-xl);
		font-variation-settings: "opsz" 24, "wght" 380;
		letter-spacing: var(--tracking-snug);
		line-height: var(--leading-tight);
		color: var(--text-prose);
	}

	.empty-description {
		margin: 12px 0 0 0;
		font-family: var(--font-body);
		font-size: var(--font-size-base);
		line-height: var(--leading-relaxed);
		color: var(--text-meta);
		max-width: 50ch;
	}

	.empty-action {
		margin-top: 24px;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}
</style>
