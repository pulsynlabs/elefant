<script lang="ts">
	import ToolCardShell from '../tools/ToolCardShell.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import type { VizRendererProps } from './types.js';

	let { envelope }: VizRendererProps = $props();

	const dataJson = $derived(JSON.stringify(envelope.data, null, 2));
	const subtitle = $derived(envelope.title ?? envelope.intent);
	// Surface the type as the visible "tool name" in the shell so an
	// unknown viz type is still clearly labelled in the transcript.
	const displayName = $derived(`viz · ${envelope.type}`);
</script>

<div class="generic-viz">
	<ToolCardShell toolName={displayName} status="success" {subtitle}>
		<div class="body">
			{#if envelope.title}
				<p class="intent">{envelope.intent}</p>
			{/if}
			<div class="code-container">
				<CopyButton content={dataJson} small />
				<pre class="raw">{dataJson}</pre>
			</div>
		</div>
	</ToolCardShell>
</div>

<style>
	.generic-viz {
		margin: var(--space-2) 0;
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
	}

	.intent {
		margin: 0;
		color: var(--text-meta);
		font-size: var(--font-size-sm);
		font-family: var(--font-sans);
		line-height: 1.5;
	}

	.code-container {
		position: relative;
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.raw {
		margin: 0;
		padding: var(--space-3);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--text-muted);
		background-color: var(--surface-substrate);
		overflow-x: auto;
		max-height: 240px;
		overflow-y: auto;
		white-space: pre;
		word-break: normal;
		line-height: 1.6;
	}
</style>
