<script lang="ts">
	import type { ChatMessage } from './types.js';
	import ToolCallCard from './ToolCallCard.svelte';
	import MarkdownRenderer from './MarkdownRenderer.svelte';

	type Props = {
		message: ChatMessage;
	};

	let { message }: Props = $props();
</script>

<div class="streaming-message">
	{#if message.isError}
		<div class="error-content" role="alert">
			<span class="error-icon" aria-hidden="true">⚠</span>
			<span class="error-text">{message.errorMessage ?? 'An error occurred'}</span>
		</div>
	{:else if message.blocks && message.blocks.length > 0}
		{#each message.blocks as block, i (block.type === 'tool_call' ? block.toolCall.id : `block-${i}`)}
			{#if block.type === 'text'}
				<MarkdownRenderer source={block.text} streaming={message.isStreaming ?? false} />
			{:else if block.type === 'tool_call'}
				<ToolCallCard toolCall={block.toolCall} />
			{/if}
		{/each}
	{:else if message.content}
		<MarkdownRenderer source={message.content} streaming={message.isStreaming ?? false} />
	{/if}

	{#if message.isStreaming}
		<span class="cursor" aria-hidden="true"></span>
	{/if}
</div>

<style>
	.streaming-message {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		color: var(--color-text-primary);
	}

	.error-content {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-error);
		font-size: var(--font-size-md);
	}

	.error-icon {
		font-size: 16px;
		flex-shrink: 0;
	}

	.cursor {
		display: inline-block;
		width: 2px;
		height: 14px;
		background-color: var(--color-primary);
		vertical-align: middle;
		animation: blink 1s step-end infinite;
	}

	@keyframes blink {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.cursor {
			animation: none;
		}
	}
</style>
