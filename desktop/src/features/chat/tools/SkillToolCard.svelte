<script lang="ts">
	import type { ToolCardProps } from './types.js';
	import ToolCardShell from './ToolCardShell.svelte';

	let { toolCall }: ToolCardProps = $props();

	const isList = $derived(toolCall.arguments.list === true);

	const skillName = $derived(
		(toolCall.arguments.name as string) ?? 'skill'
	);

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

	type SkillListEntry = {
		name: string;
		source: string;
		description: string;
	};

	function parseSkillList(text: string): SkillListEntry[] {
		if (!text) return [];
		return text.split('\n').filter(Boolean).map(line => {
			const match = line.match(/^(\S+)\s+\[([^\]]+)\]:\s*(.*)$/);
			if (match) {
				return { name: match[1], source: match[2], description: match[3] };
			}
			return { name: line.trim(), source: '', description: '' };
		});
	}

	const skillList = $derived(isList ? parseSkillList(content) : []);

	const contentLines = $derived(() => {
		if (!content || isList) return [];
		return content.split('\n');
	});

	const previewLines = $derived(() => {
		const lines = contentLines();
		return lines.slice(0, 10);
	});

	const remainingCount = $derived(() => {
		const lines = contentLines();
		return Math.max(0, lines.length - 10);
	});
</script>

<ToolCardShell
	toolName={isList ? 'skill list' : skillName}
	{status}
	{errorMessage}
	subtitle={isList ? undefined : (toolCall.arguments.name as string | undefined)}
>
	{#snippet children()}
		{#if status === 'success' && content}
			{#if isList}
				<div class="skill-body">
					<div class="skill-list">
						{#each skillList as entry}
							<div class="skill-list-item">
								<span class="skill-list-name">{entry.name}</span>
								{#if entry.source}
									<span class="skill-list-source">{entry.source}</span>
								{/if}
								{#if entry.description}
									<span class="skill-list-desc">{entry.description}</span>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{:else}
				<div class="skill-body skill-loaded-accent">
					<div class="skill-preview">
						{#each previewLines() as line}
							<div class="skill-preview-line">{line}</div>
						{/each}
						{#if remainingCount() > 0}
							<div class="skill-more">... ({remainingCount()} more line{remainingCount() === 1 ? '' : 's'}, full skill loaded)</div>
						{/if}
					</div>
					<span class="skill-loaded-badge">Skill loaded</span>
				</div>
			{/if}
		{/if}
	{/snippet}
</ToolCardShell>

<style>
	.skill-body {
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.skill-loaded-accent {
		border-left: 3px solid var(--color-primary);
	}

	.skill-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.skill-list-item {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.skill-list-name {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-primary);
		flex-shrink: 0;
	}

	.skill-list-source {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		background-color: var(--color-surface);
		padding: 0 var(--space-1);
		border-radius: var(--radius-sm);
		flex-shrink: 0;
	}

	.skill-list-desc {
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
	}

	.skill-preview {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.skill-preview-line {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-all;
	}

	.skill-more {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-style: italic;
		margin-top: var(--space-1);
	}

	.skill-loaded-badge {
		display: inline-flex;
		align-self: flex-start;
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
		color: var(--color-primary);
		background-color: var(--color-primary-subtle);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
	}
</style>
