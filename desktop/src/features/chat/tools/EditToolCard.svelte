<script lang="ts">
	import type { ToolCardProps } from './types.js';
	import ToolCardShell from './ToolCardShell.svelte';
	import { parseUnifiedDiff, extractFilePath } from '$lib/daemon/diff-parser.js';
	import { parseLspDiagnostics } from '$lib/daemon/lsp-diagnostic-parser.js';
	import type { DiagnosticInput } from '$lib/types/diagnostics.js';

	let { toolCall }: ToolCardProps = $props();

	const filePath = $derived(
		typeof toolCall.arguments.filePath === 'string'
			? toolCall.arguments.filePath
			: extractFilePath(toolCall.name, toolCall.arguments)
	);

	const status = $derived<'running' | 'success' | 'error'>(
		!toolCall.result ? 'running' : toolCall.result.isError ? 'error' : 'success'
	);

	const errorMessage = $derived(
		toolCall.result?.isError ? toolCall.result.content : undefined
	);

	const diffParsed = $derived(() => {
		if (!toolCall.result?.content || toolCall.result.isError) return null;
		return parseUnifiedDiff(toolCall.result.content);
	});

	const lspDiagnostics = $derived<DiagnosticInput[]>(
		!toolCall.result?.content || toolCall.result.isError
			? []
			: parseLspDiagnostics(toolCall.result.content)
	);

	const subtitle = $derived(filePath ?? undefined);
</script>

<ToolCardShell
	toolName="edit"
	{status}
	{errorMessage}
	{subtitle}
>
	{#if status === 'success' && toolCall.result}
		<div class="edit-body">
			{#if diffParsed() !== null}
				{#await import('$lib/components/DiffViewer.svelte') then { default: DiffViewer }}
					{@const parsed = diffParsed()}
					{#if parsed}
						<DiffViewer
							original={parsed.original}
							modified={parsed.modified}
							mode="unified"
							diagnostics={lspDiagnostics}
						/>
					{/if}
				{/await}
			{:else}
				<pre class="edit-raw">{toolCall.result.content}</pre>
			{/if}
		</div>
	{/if}
</ToolCardShell>

<style>
	.edit-body {
		display: flex;
		flex-direction: column;
	}

	.edit-raw {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
		background-color: var(--color-bg);
		padding: var(--space-3);
		margin: 0;
		white-space: pre-wrap;
		word-break: break-all;
		max-height: 200px;
		overflow-y: auto;
	}
</style>
