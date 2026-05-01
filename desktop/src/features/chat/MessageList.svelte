<script lang="ts">
	import type { ChatMessage } from './types.js';
	import MessageBubble from './MessageBubble.svelte';
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
	{#each messages as message (message.id)}
		<MessageBubble {message} />
	{/each}
</div>

<style>
	.message-list {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
		overflow-y: auto;
		overflow-x: hidden;
		padding: var(--space-6) var(--space-5);
		scrollbar-width: thin;
	}
</style>
