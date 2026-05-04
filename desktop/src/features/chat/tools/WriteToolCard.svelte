<script lang="ts">
	import type { ToolCardProps } from './types.js';
	import ToolCardShell from './ToolCardShell.svelte';
	import { parseLspDiagnostics } from '$lib/daemon/lsp-diagnostic-parser.js';
	import type { DiagnosticInput } from '$lib/types/diagnostics.js';

	let { toolCall }: ToolCardProps = $props();

	const filePath = $derived(
		typeof toolCall.arguments.filePath === 'string'
			? toolCall.arguments.filePath
			: typeof toolCall.arguments.path === 'string'
				? toolCall.arguments.path
				: null
	);

	const status = $derived<'running' | 'success' | 'error'>(
		!toolCall.result ? 'running' : toolCall.result.isError ? 'error' : 'success'
	);

	const errorMessage = $derived(
		toolCall.result?.isError ? toolCall.result.content : undefined
	);

	const bytesWritten = $derived(() => {
		if (!toolCall.result?.content || toolCall.result.isError) return null;
		const match = toolCall.result.content.match(/(\d+)\s+bytes?/i);
		return match ? match[1] : null;
	});

	const lspDiagnostics = $derived<DiagnosticInput[]>(
		!toolCall.result?.content || toolCall.result.isError
			? []
			: parseLspDiagnostics(toolCall.result.content)
	);

	const subtitle = $derived(filePath ?? undefined);
</script>

<ToolCardShell
	toolName="write"
	{status}
	{errorMessage}
	{subtitle}
>
	{#if status === 'success'}
		<div class="write-body">
			{#if bytesWritten() !== null}
				<span class="bytes-badge">{bytesWritten()} bytes written</span>
			{:else}
				<pre class="write-raw">{toolCall.result?.content}</pre>
			{/if}

			{#if lspDiagnostics.length > 0}
				<ul class="lsp-list" aria-label="LSP diagnostics for this file">
					{#each lspDiagnostics as d (`${d.line}:${d.column}:${d.message}`)}
						<li class="lsp-item lsp-{d.severity}">
							<span class="lsp-loc">{d.line}:{d.column}</span>
							<span class="lsp-sev">{d.severity}</span>
							<span class="lsp-msg">{d.message}</span>
							{#if d.code}<span class="lsp-code">[{d.code}]</span>{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</ToolCardShell>

<style>
	.write-body {
		padding: var(--space-2) var(--space-3);
	}

	.bytes-badge {
		display: inline-block;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-primary);
		background-color: var(--color-primary-subtle);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		line-height: 1;
	}

	.write-raw {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
		margin: 0;
		white-space: pre-wrap;
		word-break: break-all;
	}

	.lsp-list {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.lsp-item {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: baseline;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		line-height: 1.4;
		padding: var(--space-1) var(--space-2);
		border-left: 2px solid var(--color-border);
		border-radius: var(--radius-sm);
		background-color: var(--color-bg);
	}

	.lsp-item.lsp-error {
		border-left-color: var(--color-danger, #e5484d);
	}

	.lsp-item.lsp-warning {
		border-left-color: var(--color-warning, #f5a524);
	}

	.lsp-item.lsp-info,
	.lsp-item.lsp-hint {
		border-left-color: var(--color-primary);
	}

	.lsp-loc {
		color: var(--color-text-secondary);
		font-variant-numeric: tabular-nums;
	}

	.lsp-sev {
		text-transform: uppercase;
		font-size: 0.7rem;
		letter-spacing: 0.05em;
		color: var(--color-text-secondary);
	}

	.lsp-error .lsp-sev {
		color: var(--color-danger, #e5484d);
	}

	.lsp-warning .lsp-sev {
		color: var(--color-warning, #f5a524);
	}

	.lsp-msg {
		flex: 1 1 auto;
		min-width: 0;
		color: var(--color-text);
		word-break: break-word;
	}

	.lsp-code {
		color: var(--color-text-muted, var(--color-text-secondary));
		font-size: 0.7rem;
	}
</style>
