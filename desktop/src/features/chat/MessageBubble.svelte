<script lang="ts">
	import type { ChatMessage } from './types.js';
	import StreamingMessage from './StreamingMessage.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import { Tooltip } from '$lib/components/ui/tooltip/index.js';

	type Props = {
		message: ChatMessage;
		/**
		 * True when this user message is the most recent user message AND
		 * the chat store currently has an undoable pair (i.e.
		 * `chatStore.canUndo === true`). Controls visibility of the
		 * inline per-message undo affordance. Ignored for non-user roles.
		 */
		isLastUndoablePair?: boolean;
		/**
		 * Click handler for the per-message undo button. Wired through
		 * `MessageList -> ChatView` so the same `chatStore.undo()` path
		 * used by `/undo` and the redo banner is reused — single source
		 * of truth for the undo gesture, regardless of trigger.
		 */
		onUndo?: () => void;
	};

	let { message, isLastUndoablePair = false, onUndo }: Props = $props();

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
		{#if isUser && isLastUndoablePair}
			<Tooltip content="Undo">
				<button
					type="button"
					class="undo-btn"
					onclick={onUndo}
					aria-label="Undo this message"
				>
					<span class="undo-icon" aria-hidden="true">
						<svg
							width="14"
							height="14"
							viewBox="0 0 14 14"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
						>
							<path
								d="M2 5H8.5C10.433 5 12 6.567 12 8.5C12 10.433 10.433 12 8.5 12H5"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
							<path
								d="M4.5 2.5L2 5L4.5 7.5"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</span>
				</button>
			</Tooltip>
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

	/* Per-message undo button. Visual recipe mirrors CopyButton:
	   28×28 square, transparent at rest, hairline border that strengthens
	   on hover, muted icon that picks up the prose color on interaction.
	   Lives in the user message meta row and only renders for the last
	   undoable pair (gated by parent props). */
	.undo-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast),
			background-color var(--transition-fast);
	}

	.undo-btn:hover {
		color: var(--text-prose);
		border-color: var(--border-emphasis);
		background-color: var(--surface-hover);
	}

	.undo-btn:focus-visible {
		outline: 2px solid var(--border-emphasis);
		outline-offset: 2px;
	}

	.undo-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
</style>
