<script lang="ts">
	import type { ChatMessage } from './types.js';
	import ToolCallCard from './ToolCallCard.svelte';
	import CodeBlock from '$lib/components/CodeBlock.svelte';

	type Props = {
		message: ChatMessage;
	};

	let { message }: Props = $props();

	interface TextPart {
		type: 'text';
		content: string;
	}

	interface CodePart {
		type: 'code';
		content: string;
		language: string;
	}

	type ParsedPart = TextPart | CodePart;

	// Parse text blocks for code fences
	function parseTextBlock(text: string): ParsedPart[] {
		const parts: ParsedPart[] = [];
		const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
		let lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = codeBlockRegex.exec(text)) !== null) {
			if (match.index > lastIndex) {
				const textContent = text.slice(lastIndex, match.index);
				if (textContent.trim()) parts.push({ type: 'text', content: textContent });
			}
			parts.push({
				type: 'code',
				content: match[2] ?? '',
				language: match[1] || 'text',
			});
			lastIndex = match.index + match[0].length;
		}

		if (lastIndex < text.length) {
			const remaining = text.slice(lastIndex);
			if (remaining.trim()) parts.push({ type: 'text', content: remaining });
		}

		if (parts.length === 0 && text.trim()) {
			parts.push({ type: 'text', content: text });
		}

		return parts;
	}
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
				{@const parts = parseTextBlock(block.text)}
				{#each parts as part, j (`${i}-${j}`)}
					{#if part.type === 'code'}
						<CodeBlock code={part.content} language={part.language} />
					{:else}
						<p class="text-content">{part.content}</p>
					{/if}
				{/each}
			{:else if block.type === 'tool_call'}
				<ToolCallCard toolCall={block.toolCall} />
			{/if}
		{/each}
	{:else if message.content}
		{@const parts = parseTextBlock(message.content)}
		{#each parts as part, i (`fallback-${i}`)}
			{#if part.type === 'code'}
				<CodeBlock code={part.content} language={part.language} />
			{:else}
				<p class="text-content">{part.content}</p>
			{/if}
		{/each}
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

	.text-content {
		font-size: var(--font-size-md);
		line-height: var(--line-height-relaxed);
		color: var(--color-text-primary);
		white-space: pre-wrap;
		word-break: break-word;
		margin: 0;
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
</style>
