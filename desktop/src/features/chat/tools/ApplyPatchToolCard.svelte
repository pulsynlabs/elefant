<script lang="ts">
	import type { ToolCardProps } from './types.js';
	import ToolCardShell from './ToolCardShell.svelte';
	import { parseUnifiedDiff } from '$lib/daemon/diff-parser.js';

	let { toolCall }: ToolCardProps = $props();

	const status = $derived<'running' | 'success' | 'error'>(
		!toolCall.result ? 'running' : toolCall.result.isError ? 'error' : 'success'
	);

	const errorMessage = $derived(
		toolCall.result?.isError ? toolCall.result.content : undefined
	);

	const resultText = $derived(toolCall.result?.content ?? '');
	const patchText = $derived((toolCall.arguments.patchText as string) ?? '');

	type PatchSummary = {
		modified: string[];
		added: string[];
		deleted: string[];
	};

	function parsePatchSummary(text: string): PatchSummary {
		const modified: string[] = [];
		const added: string[] = [];
		const deleted: string[] = [];
		for (const line of text.split('\n')) {
			if (line.startsWith('- Modified:')) modified.push(line.replace('- Modified:', '').trim());
			if (line.startsWith('- Added:')) added.push(line.replace('- Added:', '').trim());
			if (line.startsWith('- Deleted:')) deleted.push(line.replace('- Deleted:', '').trim());
		}
		return { modified, added, deleted };
	}

	const summary = $derived(
		resultText ? parsePatchSummary(resultText) : { modified: [], added: [], deleted: [] }
	);

	const subtitleText = $derived(() => {
		if (!resultText) return undefined;
		const parts: string[] = [];
		if (summary.modified.length > 0) parts.push(`${summary.modified.length} modified`);
		if (summary.added.length > 0) parts.push(`${summary.added.length} added`);
		if (summary.deleted.length > 0) parts.push(`${summary.deleted.length} deleted`);
		return parts.join(', ') || undefined;
	});

	const allFiles = $derived([
		...summary.modified.map(f => ({ path: f, type: 'M' as const })),
		...summary.added.map(f => ({ path: f, type: 'A' as const })),
		...summary.deleted.map(f => ({ path: f, type: 'D' as const })),
	]);

	// Try parsing patchText as unified diff for preview
	const parsedDiff = $derived(patchText ? parseUnifiedDiff(patchText) : null);

	// Truncated raw patch for fallback display
	const patchPreviewLines = $derived(() => {
		if (!patchText) return [];
		return patchText.split('\n').slice(0, 20);
	});

	const patchTotalLines = $derived(
		patchText ? patchText.split('\n').length : 0
	);

	let showPatch = $state(false);
</script>

<ToolCardShell
	toolName="apply_patch"
	{status}
	{errorMessage}
	subtitle={resultText ? subtitleText() : undefined}
>
	{#snippet children()}
		{#if status !== 'running' && resultText}
			<div class="patch-body">
				{#if allFiles.length > 0}
					<div class="patch-file-list">
						{#each allFiles as file}
							<div class="patch-file-row">
								<span
									class="patch-file-badge"
									class:badge-modified={file.type === 'M'}
									class:badge-added={file.type === 'A'}
									class:badge-deleted={file.type === 'D'}
								>
									{file.type}
								</span>
								<span class="patch-file-path">{file.path}</span>
							</div>
						{/each}
					</div>
				{/if}

				{#if patchText}
					<button
						class="patch-toggle"
						onclick={() => showPatch = !showPatch}
					>
						{showPatch ? '\u25BC Hide patch' : '\u25B6 Show patch'}
					</button>

					{#if showPatch}
						<pre class="patch-raw">{#if parsedDiff}{patchText}{:else}{patchPreviewLines().join('\n')}{#if patchTotalLines > 20}{'\n'}... ({patchTotalLines - 20} more lines){/if}{/if}</pre>
					{/if}
				{/if}
			</div>
		{/if}
	{/snippet}
</ToolCardShell>

<style>
	.patch-body {
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.patch-file-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.patch-file-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.patch-file-badge {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-bold);
		width: 16px;
		text-align: center;
	}

	.badge-modified {
		color: var(--color-warning, var(--color-primary));
	}

	.badge-added {
		color: var(--color-success);
	}

	.badge-deleted {
		color: var(--color-error);
	}

	.patch-file-path {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.patch-toggle {
		all: unset;
		cursor: pointer;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		padding: var(--space-1) 0;
	}

	.patch-toggle:hover {
		color: var(--color-text-secondary);
	}

	.patch-toggle:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}

	.patch-raw {
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
