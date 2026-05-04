<script lang="ts">
	import type { ToolCardProps } from './types.js';
	import ToolCardShell from './ToolCardShell.svelte';

	let { toolCall }: ToolCardProps = $props();

	const operation = $derived((toolCall.arguments.operation as string) ?? '');
	const filePath = $derived(toolCall.arguments.filePath as string | undefined);

	const status = $derived<'running' | 'success' | 'error'>(
		!toolCall.result ? 'running' : toolCall.result.isError ? 'error' : 'success'
	);

	const errorMessage = $derived(
		toolCall.result?.isError ? toolCall.result.content : undefined
	);

	const content = $derived(
		toolCall.result?.content && !toolCall.result.isError
			? toolCall.result.content
			: ''
	);

	const subtitleText = $derived(() => {
		const fileName = filePath ? filePath.split('/').pop() : undefined;
		if (operation && fileName) return `${operation} \u2014 ${fileName}`;
		if (operation) return operation;
		return undefined;
	});

	type LocationEntry = {
		path: string;
		line: number;
		char: number;
	};

	function parseLocations(text: string): LocationEntry[] {
		return text
			.split('\n')
			.filter(Boolean)
			.map(l => {
				const match = l.match(/^(.*?):(\d+):(\d+)$/);
				if (!match) return null;
				return { path: match[1], line: parseInt(match[2], 10), char: parseInt(match[3], 10) };
			})
			.filter((entry): entry is LocationEntry => entry !== null);
	}

	const locations = $derived(
		(operation === 'goToDefinition' || operation === 'findReferences') && content
			? parseLocations(content)
			: []
	);

	const truncatedLocations = $derived(locations.slice(0, 50));
	const hasMoreLocations = $derived(locations.length > 50);

	let showAllLocations = $state(false);

	const displayedLocations = $derived(
		showAllLocations ? locations : truncatedLocations
	);
</script>

<ToolCardShell
	toolName="lsp"
	{status}
	{errorMessage}
	subtitle={subtitleText()}
>
	{#snippet children()}
		{#if status === 'success' && content}
			<div class="lsp-body">
				<!-- Supported operations: hover, goToDefinition, findReferences, documentSymbol, workspaceSymbol.
				 'diagnostics' is not a current daemon LSP operation (src/tools/lsp/index.ts) —
				 if a future version adds it, it falls through to the raw fallback branch. -->
			{#if operation === 'hover'}
					<pre class="lsp-hover">{content}</pre>
				{:else if operation === 'goToDefinition' || operation === 'findReferences'}
					{#if locations.length === 0}
						<span class="lsp-empty">(no locations found)</span>
					{:else}
						<div class="lsp-location-list">
							{#each displayedLocations as loc}
								<div class="lsp-location-row">
									<span class="lsp-location-path">{loc.path}:{loc.line}</span>
								</div>
							{/each}
						</div>
						{#if hasMoreLocations && !showAllLocations}
							<button
								class="lsp-show-more"
								onclick={() => showAllLocations = true}
							>
								Show all {locations.length} locations
							</button>
						{/if}
					{/if}
				{:else if operation === 'documentSymbol' || operation === 'workspaceSymbol'}
					<pre class="lsp-symbols">{content}</pre>
				{:else}
					<pre class="lsp-raw">{content}</pre>
				{/if}

			</div>
		{/if}
	{/snippet}
</ToolCardShell>

<style>
	.lsp-body {
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.lsp-hover {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
		background-color: var(--color-bg);
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		max-height: 200px;
		overflow-y: auto;
		white-space: pre-wrap;
		word-break: break-all;
		margin: 0;
	}

	.lsp-empty {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		font-style: italic;
	}

	.lsp-location-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.lsp-location-row {
		display: flex;
		align-items: center;
	}

	.lsp-location-path {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.lsp-show-more {
		all: unset;
		cursor: pointer;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		padding: var(--space-1) 0;
	}

	.lsp-show-more:hover {
		color: var(--color-text-secondary);
	}

	.lsp-show-more:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}

	.lsp-symbols {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
		background-color: var(--color-bg);
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		max-height: 300px;
		overflow-y: auto;
		white-space: pre-wrap;
		word-break: break-all;
		margin: 0;
	}

	.lsp-raw {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
		background-color: var(--color-bg);
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		max-height: 300px;
		overflow-y: auto;
		white-space: pre-wrap;
		word-break: break-all;
		margin: 0;
	}

</style>
