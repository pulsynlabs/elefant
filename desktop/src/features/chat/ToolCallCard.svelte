<script lang="ts">
	import type { ToolCallDisplay } from './types.js';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import { isFileEditTool, parseUnifiedDiff, extractFilePath } from '$lib/daemon/diff-parser.js';

	type Props = {
		toolCall: ToolCallDisplay;
	};

	let { toolCall }: Props = $props();

	let expanded = $state(false);
	let showDiff = $state(true);

	const argsJson = $derived(JSON.stringify(toolCall.arguments, null, 2));
	const isFileEdit = $derived(isFileEditTool(toolCall.name));
	const filePath = $derived(extractFilePath(toolCall.name, toolCall.arguments));

	// Try to parse result as unified diff
	const diffContent = $derived(() => {
		if (!toolCall.result?.content) return null;
		return parseUnifiedDiff(toolCall.result.content);
	});

	const hasDiff = $derived(isFileEdit && diffContent !== null);
</script>

<div class="tool-call-card" class:has-result={toolCall.result !== undefined}>
	<div
		class="tool-header"
		onclick={() => expanded = !expanded}
		role="button"
		tabindex={0}
		onkeydown={(e) => e.key === 'Enter' && (expanded = !expanded)}
		aria-expanded={expanded}
	>
		<span class="tool-icon" aria-hidden="true">⚡</span>
		<div class="tool-info">
			<span class="tool-name">{toolCall.name}</span>
			{#if filePath}
				<span class="tool-filepath">{filePath}</span>
			{/if}
		</div>
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
		<span class="expand-icon" aria-hidden="true">{expanded ? '▲' : '▼'}</span>
	</div>

	{#if expanded}
		<div class="tool-body">
			<!-- Arguments section -->
			<div class="tool-section">
				<span class="section-label">Arguments</span>
				<div class="code-container">
					<CopyButton content={argsJson} small />
					<pre class="tool-code">{argsJson}</pre>
				</div>
			</div>

			<!-- Result section -->
			{#if toolCall.result}
				<div class="tool-section" class:error={toolCall.result.isError}>
					<div class="section-header">
						<span class="section-label">{toolCall.result.isError ? 'Error' : 'Result'}</span>
						{#if hasDiff}
							<div class="view-toggle">
								<button
									class="toggle-btn"
									class:active={showDiff}
									onclick={() => showDiff = true}
								>
									Diff
								</button>
								<button
									class="toggle-btn"
									class:active={!showDiff}
									onclick={() => showDiff = false}
								>
									Raw
								</button>
								</div>
							{/if}
						</div>

					{#if hasDiff && showDiff}
						{#await import('$lib/components/DiffViewer.svelte') then { default: DiffViewer }}
							{@const parsed = diffContent()}
							{#if parsed}
								<DiffViewer
									original={parsed.original}
									modified={parsed.modified}
									mode="unified"
								/>
							{/if}
						{/await}
					{:else}
						<div class="code-container">
							<CopyButton content={toolCall.result.content} small />
							<pre class="tool-code result-code" class:error-text={toolCall.result.isError}>{toolCall.result.content}</pre>
						</div>
					{/if}
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
		border-bottom: 1px solid var(--color-border);
		cursor: pointer;
		user-select: none;
	}

	.tool-header:hover {
		background-color: var(--color-surface-hover);
	}

	.tool-icon {
		font-size: 13px;
		flex-shrink: 0;
	}

	.tool-info {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}

	.tool-name {
		font-size: var(--font-size-sm);
		font-family: var(--font-mono);
		color: var(--color-text-primary);
		font-weight: var(--font-weight-medium);
	}

	.tool-filepath {
		font-size: var(--font-size-xs);
		font-family: var(--font-mono);
		color: var(--color-text-muted);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
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
		0%, 100% { opacity: 1; }
		50% { opacity: 0.3; }
	}

	.expand-icon {
		font-size: 10px;
		color: var(--color-text-muted);
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

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.section-label {
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
	}

	.view-toggle {
		display: flex;
		gap: 2px;
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 2px;
	}

	.toggle-btn {
		background: none;
		border: none;
		padding: 2px 8px;
		border-radius: calc(var(--radius-sm) - 2px);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		cursor: pointer;
		font-family: var(--font-sans);
		transition: color var(--transition-fast), background-color var(--transition-fast);
	}

	.toggle-btn.active {
		background-color: var(--color-surface-elevated);
		color: var(--color-text-primary);
	}

	.code-container {
		position: relative;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		overflow: hidden;
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
	}

	.result-code {
		color: var(--color-text-primary);
	}

	.error-text {
		color: var(--color-error);
	}
</style>
