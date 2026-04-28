<script lang="ts">
	import type { ChatMessage } from './types.js';
	import MessageBubble from './MessageBubble.svelte';
	import { HugeiconsIcon, ChatIcon } from '$lib/icons/index.js';
	import { tick } from 'svelte';

	type Props = {
		messages: ChatMessage[];
	};

	let { messages }: Props = $props();

	let listEl: HTMLDivElement;

	// Auto-scroll to bottom when messages change
	$effect(() => {
		// Access messages to create dependency
		const _len = messages.length;
		const lastMsg = messages[messages.length - 1];
		// Also track streaming content changes
		const _streaming = lastMsg?.isStreaming;
		const _content = lastMsg?.content;

		tick().then(() => {
			if (listEl) {
				listEl.scrollTop = listEl.scrollHeight;
			}
		});
	});
</script>

<div class="message-list" bind:this={listEl}>
	{#if messages.length === 0}
		<div class="empty-state">
			<div class="empty-icon" aria-hidden="true">
				<HugeiconsIcon icon={ChatIcon} size={40} strokeWidth={1.5} />
			</div>
			<h3 class="empty-title">Start a conversation</h3>
			<p class="empty-desc">
				Ask Elefant to help with your code, explain concepts, or execute tasks.
			</p>
		</div>
	{:else}
		{#each messages as message (message.id)}
			<MessageBubble {message} />
		{/each}
	{/if}
</div>

<style>
	.message-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-height: 0;
		height: 100%;
		overflow-y: auto;
		overflow-x: hidden;
		padding: var(--space-4);
		scrollbar-width: thin;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-10) var(--space-6);
		text-align: center;
		gap: var(--space-3);
		color: var(--color-text-muted);
		flex: 1;
	}

	.empty-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0.7;
	}

	.empty-title {
		font-size: var(--font-size-xl);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
		letter-spacing: var(--tracking-snug);
		margin: 0;
	}

	.empty-desc {
		font-size: var(--font-size-md);
		color: var(--color-text-muted);
		max-width: 400px;
		line-height: var(--line-height-relaxed);
		margin: 0;
	}
</style>
