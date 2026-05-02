<script lang="ts">
	import type { ChatMessage } from './types.js';
	import MessageBubble from './MessageBubble.svelte';
	import { HugeiconsIcon, ChatIcon } from '$lib/icons/index.js';
	import { chatStore } from './chat.svelte.js';
	import { tick } from 'svelte';

	type Props = {
		messages: ChatMessage[];
		/**
		 * Forwarded to the per-message undo button on the last
		 * undoable user bubble. Routed up to ChatView so the existing
		 * `chatStore.undo()` -> `pendingInputRestore` handshake (used
		 * by the `/undo` slash command) is the single source of truth.
		 */
		onUndoMessage?: () => void;
	};

	let { messages, onUndoMessage }: Props = $props();

	let listEl: HTMLDivElement;

	// Identifier of the last user message in the current list, or null
	// if no user message exists yet. The per-message undo button only
	// renders on this message, and only when `chatStore.canUndo` is
	// true — together they pin the affordance to the most recent
	// undoable pair, matching the `/undo` semantics.
	//
	// Walks the array from the tail in a plain loop instead of
	// `Array.prototype.findLast` so the file doesn't need ES2023 in the
	// project's TS `lib` target — staying compatible with the existing
	// build settings used everywhere else in the codebase.
	const lastUserMessageId: string | null = $derived.by(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === 'user') return messages[i].id;
		}
		return null;
	});

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
			<MessageBubble
				{message}
				isLastUndoablePair={chatStore.canUndo && message.id === lastUserMessageId}
				onUndo={onUndoMessage}
			/>
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
