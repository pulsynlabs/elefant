<script lang="ts">
	// Code viz renderer — delegates the actual syntax highlighting to
	// the shared `CodeBlock` component (which wraps `lib/shiki.ts`),
	// so we get language detection, theme switching, and the copy
	// button for free without adding a second highlighter dependency.
	// This component just adds the optional title chrome above the
	// existing block.

	import type { VizRendererProps } from './types.js';
	import CodeBlock from '$lib/components/CodeBlock.svelte';

	let { envelope }: VizRendererProps = $props();

	interface CodeData {
		lang: string;
		src: string;
		title?: string;
	}

	const data = $derived(envelope.data as unknown as CodeData);
	const title = $derived(data.title ?? envelope.title ?? null);
</script>

<div class="code-viz">
	{#if title}
		<p class="code-title">{title}</p>
	{/if}
	<CodeBlock code={data.src} language={data.lang} />
</div>

<style>
	.code-viz {
		margin: var(--space-2) 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.code-title {
		margin: 0;
		color: var(--text-meta);
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
</style>
