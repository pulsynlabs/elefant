<script lang="ts">
	import type { ChatMessage } from './types.js';
	import StreamingMessage from './StreamingMessage.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';

	type Props = {
		message: ChatMessage;
	};

	let { message }: Props = $props();

	const isUser = $derived(message.role === 'user');
	const formattedTime = $derived(
		message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
	);
</script>

<div
	class="message-bubble"
	class:user={isUser}
	class:assistant={!isUser}
	class:error={message.isError}
>
	<div class="message-header">
		<span class="message-role">{isUser ? 'You' : 'Elefant'}</span>
		<span class="message-time">{formattedTime}</span>
		{#if !isUser && !message.isStreaming}
			<CopyButton content={message.content} />
		{/if}
	</div>

	<div class="message-content">
		{#if isUser}
			<p class="user-text">{message.content}</p>
		{:else}
			<StreamingMessage {message} />
		{/if}
	</div>
</div>

<style>
	.message-bubble {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-width: 85%;
	}

	.message-bubble.user {
		align-self: flex-end;
	}

	.message-bubble.assistant {
		align-self: flex-start;
	}

	.message-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.message-role {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
	}

	.message-bubble.user .message-role {
		color: var(--color-primary);
	}

	.message-time {
		font-size: var(--font-size-xs);
		color: var(--color-text-disabled);
	}

	.message-content {
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
		width: 100%;
	}

	.message-bubble.user .message-content {
		background-color: var(--color-primary-subtle);
		border-color: var(--color-primary-muted);
	}

	.message-bubble.error .message-content {
		background-color: color-mix(in oklch, var(--color-error) 8%, transparent);
		border-color: var(--color-error);
	}

	.user-text {
		color: var(--color-text-primary);
		font-size: var(--font-size-md);
		line-height: var(--line-height-relaxed);
		white-space: pre-wrap;
		word-break: break-word;
		margin: 0;
	}
</style>
