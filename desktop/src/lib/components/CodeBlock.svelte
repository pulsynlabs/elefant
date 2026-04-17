<script lang="ts">
	import { highlight } from '$lib/shiki.js';
	import { themeStore } from '$lib/stores/theme.svelte.js';
	import CopyButton from './CopyButton.svelte';

	type Props = {
		code: string;
		language?: string;
	};

	let { code, language = 'text' }: Props = $props();

	let highlightedHtml = $state<string | null>(null);

	$effect(() => {
		const isDark = themeStore.isDark;
		const lang = language;
		const c = code;

		highlight(c, lang, isDark).then((html) => {
			highlightedHtml = html;
		});
	});
</script>

<div class="code-block">
	<div class="code-header">
		<span class="code-language">{language}</span>
		<CopyButton content={code} small />
	</div>
	{#if highlightedHtml}
		<div class="code-content shiki-wrapper" role="region" aria-label="Code block">
			{@html highlightedHtml}
		</div>
	{:else}
		<pre class="code-content code-fallback"><code>{code}</code></pre>
	{/if}
</div>

<style>
	.code-block {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		background-color: var(--color-surface-elevated);
	}

	.code-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		background-color: var(--color-surface);
		border-bottom: 1px solid var(--color-border);
	}

	.code-language {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		text-transform: lowercase;
	}

	.code-content {
		overflow-x: auto;
		padding: var(--space-4);
	}

	.shiki-wrapper :global(pre) {
		background: transparent !important;
		padding: 0;
		margin: 0;
	}

	.shiki-wrapper :global(code) {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
	}

	.code-fallback {
		color: var(--color-text-secondary);
		white-space: pre-wrap;
		word-break: break-all;
	}
</style>
