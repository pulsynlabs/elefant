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
	class="msg"
	class:msg--user={isUser}
	class:msg--assistant={!isUser}
	class:msg--error={message.isError}
>
	<div class="msg-meta">
		<span class="msg-role">{isUser ? 'You' : 'Elefant'}</span>
		<span class="msg-time">{formattedTime}</span>
		{#if !isUser && !message.isStreaming}
			<CopyButton content={message.content} />
		{/if}
	</div>

	{#if isUser}
		<div class="msg-bubble">
			<p class="msg-text">{message.content}</p>
		</div>
	{:else}
		<div class="msg-prose" class:msg-prose--error={message.isError}>
			<StreamingMessage {message} />
		</div>
	{/if}
</div>

<style>
	.msg {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	/* User: right-aligned */
	.msg--user {
		align-items: flex-end;
		align-self: flex-end;
		max-width: 72%;
	}

	/* Assistant: left-aligned, full width */
	.msg--assistant {
		align-items: flex-start;
		align-self: stretch;
	}

	/* Meta row (label + time + copy) */
	.msg-meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 0 var(--space-1);
	}

	.msg-role {
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		font-weight: 600;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.msg--user .msg-role {
		color: var(--color-primary);
	}

	.msg-time {
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		color: var(--text-disabled);
	}

	/* User bubble */
	.msg-bubble {
		background-color: var(--color-primary-subtle);
		border: 1px solid var(--border-emphasis);
		border-radius: var(--radius-fold);
		padding: var(--space-3) var(--space-4);
		box-shadow: var(--shadow-sm);
	}

	.msg-text {
		font-family: var(--font-sans);
		font-size: var(--font-size-md);
		line-height: 1.65;
		color: var(--text-prose);
		white-space: pre-wrap;
		word-break: break-word;
		margin: 0;
	}

	/* Assistant card — subtle elevation, clear message boundary */
	.msg-prose {
		width: 100%;
		background-color: var(--surface-plate);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-lg);
		padding: var(--space-4) var(--space-5);
		font-family: var(--font-sans);
		font-size: var(--font-size-md);
		line-height: 1.75;
		color: var(--text-prose);
	}

	/* Error: left accent border + tint */
	.msg-prose--error {
		border-left: 3px solid var(--color-error);
		background-color: color-mix(in oklch, var(--color-error) 5%, var(--surface-plate));
	}
</style>
