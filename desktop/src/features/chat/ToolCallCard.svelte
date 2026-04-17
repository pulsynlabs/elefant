<script lang="ts">
	import type { ToolCallDisplay } from './types.js';
	import CopyButton from '$lib/components/CopyButton.svelte';

	type Props = {
		toolCall: ToolCallDisplay;
	};

	let { toolCall }: Props = $props();

	let expanded = $state(false);
	const argsJson = $derived(JSON.stringify(toolCall.arguments, null, 2));
</script>

<div class="tool-call-card" class:has-result={toolCall.result !== undefined}>
	<button
		class="tool-header"
		onclick={() => (expanded = !expanded)}
		aria-expanded={expanded}
		aria-label={expanded ? `Collapse ${toolCall.name} details` : `Expand ${toolCall.name} details`}
	>
		<span class="tool-icon" aria-hidden="true">⚡</span>
		<span class="tool-name">{toolCall.name}</span>
		{#if toolCall.result}
			<span
				class="tool-status"
				class:error={toolCall.result.isError}
				aria-label={toolCall.result.isError ? 'Tool failed' : 'Tool succeeded'}
			>
				{toolCall.result.isError ? '✗' : '✓'}
			</span>
		{:else}
			<span class="tool-running" aria-label="Tool running">⋯</span>
		{/if}
		<span class="expand-icon" aria-hidden="true">
			{expanded ? '▲' : '▼'}
		</span>
	</button>

	{#if expanded}
		<div class="tool-body">
			<div class="tool-section">
				<span class="section-label">Arguments</span>
				<div class="code-container">
					<div class="code-container-actions">
						<CopyButton content={argsJson} small />
					</div>
					<pre class="tool-code">{argsJson}</pre>
				</div>
			</div>

			{#if toolCall.result}
				<div class="tool-section" class:error={toolCall.result.isError}>
					<span class="section-label">{toolCall.result.isError ? 'Error' : 'Result'}</span>
					<div class="code-container">
						<div class="code-container-actions">
							<CopyButton content={toolCall.result.content} small />
						</div>
						<pre class="tool-code result-code">{toolCall.result.content}</pre>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.tool-call-card {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		margin: var(--space-2) 0;
		background-color: var(--color-surface-elevated);
	}

	.tool-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background-color: var(--color-surface);
		border: none;
		border-bottom: 1px solid var(--color-border);
		cursor: pointer;
		width: 100%;
		text-align: left;
		font-family: var(--font-sans);
		transition: background-color var(--transition-fast);
	}

	.tool-header:hover {
		background-color: var(--color-surface-hover);
	}

	.tool-icon {
		font-size: 13px;
		flex-shrink: 0;
	}

	.tool-name {
		font-size: var(--font-size-sm);
		font-family: var(--font-mono);
		color: var(--color-text-primary);
		font-weight: var(--font-weight-medium);
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tool-status {
		font-size: 13px;
		color: var(--color-success);
		flex-shrink: 0;
	}

	.tool-status.error {
		color: var(--color-error);
	}

	.tool-running {
		font-size: 16px;
		color: var(--color-warning);
		animation: pulse 1.5s ease-in-out infinite;
		flex-shrink: 0;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.3;
		}
	}

	.expand-icon {
		color: var(--color-text-muted);
		font-size: 10px;
		flex-shrink: 0;
	}

	.tool-body {
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.tool-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.tool-section.error .code-container {
		border-color: var(--color-error);
		background-color: color-mix(in oklch, var(--color-error) 5%, transparent);
	}

	.section-label {
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
	}

	.code-container {
		position: relative;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.code-container-actions {
		position: absolute;
		top: var(--space-2);
		right: var(--space-2);
		z-index: 1;
	}

	.tool-code {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
		background-color: var(--color-bg);
		padding: var(--space-3);
		overflow-x: auto;
		max-height: 200px;
		overflow-y: auto;
		white-space: pre-wrap;
		word-break: break-all;
		margin: 0;
	}

	.result-code {
		color: var(--color-text-primary);
	}
</style>
