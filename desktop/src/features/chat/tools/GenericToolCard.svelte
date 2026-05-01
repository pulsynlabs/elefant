<script lang="ts">
	import type { ToolCallDisplay } from '../types.js';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import { isFileEditTool, parseUnifiedDiff, extractFilePath } from '$lib/daemon/diff-parser.js';
	import { HugeiconsIcon, FlashIcon, CheckIcon, CrossIcon } from '$lib/icons/index.js';

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

<div
	class="tool-call-card"
	class:has-result={toolCall.result !== undefined && !toolCall.result?.isError}
	class:has-error={toolCall.result?.isError}
>
	<div
		class="tool-header"
		onclick={() => expanded = !expanded}
		role="button"
		tabindex={0}
		onkeydown={(e) => e.key === 'Enter' && (expanded = !expanded)}
		aria-expanded={expanded}
	>
		<span class="tool-icon" aria-hidden="true">
			<HugeiconsIcon icon={FlashIcon} size={14} strokeWidth={1.5} />
		</span>
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
				<HugeiconsIcon
					icon={toolCall.result.isError ? CrossIcon : CheckIcon}
					size={14}
					strokeWidth={1.5}
				/>
			</span>
		{:else}
			<span class="tool-running" aria-label="Tool running">
				<span class="tool-running-dot"></span>
				<span class="tool-running-dot"></span>
				<span class="tool-running-dot"></span>
			</span>
		{/if}
		<span class="expand-icon" aria-hidden="true" class:expanded></span>
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
		border-radius: var(--radius-lg);
		overflow: hidden;
		margin: var(--space-2) 0;
		background-color: var(--surface-plate);
		border: 1px solid var(--border-edge);
		/* Left accent border — color controlled by state class */
		border-left: 3px solid var(--color-primary);
		transition: border-left-color var(--transition-fast);
	}

	.tool-call-card.has-result {
		border-left-color: var(--color-success);
	}

	.tool-call-card.has-error {
		border-left-color: var(--color-error);
	}

	.tool-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background-color: transparent;
		cursor: pointer;
		user-select: none;
		min-height: 36px;
	}

	.tool-header:hover {
		background-color: var(--surface-hover);
	}

	.tool-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		color: var(--text-muted);
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
		color: var(--text-prose);
		font-weight: 500;
		line-height: 1.3;
	}

	.tool-filepath {
		font-size: var(--font-size-xs);
		font-family: var(--font-mono);
		color: var(--text-muted);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.tool-status {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		color: var(--color-success);
		flex-shrink: 0;
	}

	.tool-status.error {
		color: var(--color-error);
	}

	.tool-running {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		flex-shrink: 0;
	}

	.tool-running-dot {
		display: block;
		width: 4px;
		height: 4px;
		border-radius: var(--radius-full);
		background-color: var(--color-primary);
		animation: dot-bounce 1.4s ease-in-out infinite;
	}

	.tool-running-dot:nth-child(2) { animation-delay: 0.2s; }
	.tool-running-dot:nth-child(3) { animation-delay: 0.4s; }

	@keyframes dot-bounce {
		0%, 80%, 100% { transform: scale(0.7); opacity: 0.5; }
		40% { transform: scale(1); opacity: 1; }
	}

	.expand-icon {
		flex-shrink: 0;
		width: 8px;
		height: 8px;
		border-right: 1.5px solid var(--text-muted);
		border-bottom: 1.5px solid var(--text-muted);
		transform: rotate(45deg);
		transition: transform var(--transition-fast);
	}

	.expand-icon.expanded {
		transform: rotate(225deg);
	}

	.tool-body {
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		border-top: 1px solid var(--border-edge);
	}

	.tool-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.section-label {
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.07em;
		font-family: var(--font-sans);
	}

	.view-toggle {
		display: flex;
		gap: 2px;
		background-color: var(--surface-hover);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-sm);
		padding: 2px;
	}

	.toggle-btn {
		background: none;
		border: none;
		padding: 2px 8px;
		border-radius: calc(var(--radius-sm) - 1px);
		font-size: var(--font-size-xs);
		color: var(--text-muted);
		cursor: pointer;
		font-family: var(--font-sans);
		transition: color var(--transition-fast), background-color var(--transition-fast);
	}

	.toggle-btn.active {
		background-color: var(--surface-leaf);
		color: var(--text-prose);
	}

	.code-container {
		position: relative;
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.tool-code {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--text-meta);
		background-color: var(--surface-substrate);
		padding: var(--space-3);
		overflow-x: auto;
		max-height: 240px;
		overflow-y: auto;
		white-space: pre;
		word-break: normal;
		margin: 0;
		line-height: 1.6;
	}

	.result-code {
		color: var(--text-prose);
	}

	.error-text {
		color: var(--color-error);
	}

	.tool-section.error .code-container {
		border-color: var(--color-error);
	}

	@media (prefers-reduced-motion: reduce) {
		.tool-running-dot { animation: none; }
		.expand-icon { transition: none; }
	}
</style>
