<script lang="ts">
	import type { ChatMessage } from './types.js';
	import MessageBubble from './MessageBubble.svelte';
	import { HugeiconsIcon, ChatIcon } from '$lib/icons/index.js';
	import GhostMessage from './GhostMessage.svelte';
	import { chatStore } from './chat.svelte.js';
	import { tick } from 'svelte';

	/**
	 * Ephemeral "tombstone" entry for a user+assistant pair that was just
	 * undone. Kept purely in the UI layer (ChatView) — these are NOT
	 * persisted on the chatStore — and rendered inline below the real
	 * message stream so auto-scroll captures them. Each entry has a
	 * stable id so multiple stacked ghosts dissolve independently.
	 */
	export type GhostEntry = { id: string; userContent: string };

	type Props = {
		messages: ChatMessage[];
		/**
		 * Forwarded to the per-message undo button on the last
		 * undoable user bubble. Routed up to ChatView so the existing
		 * `chatStore.undo()` -> `pendingInputRestore` handshake (used
		 * by the `/undo` slash command) is the single source of truth.
		 */
		onUndoMessage?: () => void;
		/**
		 * Active ghost tombstones rendered after the last real message.
		 * Owned by ChatView so `addUserMessage` (which clears the redo
		 * stack) can clear them in lock-step on a real send. Optional so
		 * existing call sites that don't yet pass ghosts keep compiling.
		 */
		ghostEntries?: GhostEntry[];
		/** Per-ghost redo handler — calls chatStore.redo() and removes the ghost. */
		onGhostRedo?: (id: string) => void;
		/** Per-ghost dismiss handler — fires after the auto-dissolve fade-out. */
		onGhostDismiss?: (id: string) => void;
	};

	let {
		messages,
		onUndoMessage,
		ghostEntries = [],
		onGhostRedo,
		onGhostDismiss,
	}: Props = $props();

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

	// Auto-scroll to bottom when messages change OR when a ghost is
	// pushed/dismissed. Ghosts render in the same scrollable area as the
	// messages, so depending on `ghostEntries.length` keeps the latest
	// activity in view even when no new real message has arrived.
	$effect(() => {
		// Access messages to create dependency
		const _len = messages.length;
		const lastMsg = messages[messages.length - 1];
		// Also track streaming content changes
		const _streaming = lastMsg?.isStreaming;
		const _content = lastMsg?.content;
		// Track ghost lifecycle so a fresh undo scrolls the new tombstone
		// into view alongside the message stream.
		const _ghostLen = ghostEntries.length;

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

		{#each ghostEntries as ghost (ghost.id)}
			<GhostMessage
				userContent={ghost.userContent}
				onRedo={() => onGhostRedo?.(ghost.id)}
				onDismiss={() => onGhostDismiss?.(ghost.id)}
			/>
		{/each}
	{/if}
</div>

<style>
	.message-list {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		overflow-y: auto;
		overflow-x: hidden;
		padding: var(--space-6) var(--space-5);
		scrollbar-width: thin;
	}
</style>
