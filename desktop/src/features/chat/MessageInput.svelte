<script lang="ts">
	type Props = {
		disabled?: boolean;
		streaming?: boolean;
		onSend: (content: string) => void;
		onStop: () => void;
	};

	let { disabled = false, streaming = false, onSend, onStop }: Props = $props();

	let inputValue = $state('');
	let textareaEl: HTMLTextAreaElement;

	function handleSend(): void {
		const content = inputValue.trim();
		if (!content || disabled) return;
		onSend(content);
		inputValue = '';
		// Reset textarea height
		if (textareaEl) {
			textareaEl.style.height = 'auto';
		}
	}

	function handleKeydown(event: KeyboardEvent): void {
		if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
			event.preventDefault();
			handleSend();
		}
	}

	function handleInput(): void {
		if (textareaEl) {
			textareaEl.style.height = 'auto';
			textareaEl.style.height = `${Math.min(textareaEl.scrollHeight, 200)}px`;
		}
	}

	const canSend = $derived(!disabled && !streaming && inputValue.trim().length > 0);
</script>

<div class="message-input-wrapper">
	<textarea
		bind:this={textareaEl}
		bind:value={inputValue}
		class="message-input"
		placeholder="Message Elefant... (Ctrl+Enter to send)"
		disabled={streaming}
		rows={1}
		onkeydown={handleKeydown}
		oninput={handleInput}
		aria-label="Message input"
	></textarea>

	<div class="input-actions">
		{#if streaming}
			<button
				class="btn-stop"
				onclick={onStop}
				aria-label="Stop generating"
				title="Stop generating"
			>
				<span aria-hidden="true">⬛</span> Stop
			</button>
		{:else}
			<button
				class="btn-send"
				onclick={handleSend}
				disabled={!canSend}
				aria-label="Send message"
				title="Send message (Ctrl+Enter)"
			>
				<span aria-hidden="true">↑</span>
			</button>
		{/if}
	</div>
</div>

<!-- Streaming indicator -->
{#if streaming}
	<div class="streaming-indicator" aria-live="polite">
		<span class="dot"></span>
		<span class="dot"></span>
		<span class="dot"></span>
		<span class="streaming-text">Elefant is responding...</span>
	</div>
{/if}

<style>
	.message-input-wrapper {
		display: flex;
		align-items: flex-end;
		gap: var(--space-3);
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-3);
		transition: border-color var(--transition-fast);
	}

	.message-input-wrapper:focus-within {
		border-color: var(--color-primary);
	}

	.message-input {
		flex: 1;
		background: none;
		border: none;
		outline: none;
		color: var(--color-text-primary);
		font-family: var(--font-sans);
		font-size: var(--font-size-md);
		line-height: var(--line-height-base);
		resize: none;
		min-height: 24px;
		max-height: 200px;
		overflow-y: auto;
		padding: 0;
		scrollbar-width: thin;
	}

	.message-input::placeholder {
		color: var(--color-text-disabled);
	}

	.message-input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.input-actions {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	.btn-send {
		width: 32px;
		height: 32px;
		border-radius: var(--radius-md);
		border: none;
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		cursor: pointer;
		font-size: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition:
			background-color var(--transition-fast),
			opacity var(--transition-fast);
	}

	.btn-send:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn-send:not(:disabled):hover {
		background-color: var(--color-primary-hover);
	}

	.btn-stop {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-strong);
		background-color: var(--color-surface-elevated);
		color: var(--color-text-secondary);
		cursor: pointer;
		font-size: var(--font-size-sm);
		font-family: var(--font-sans);
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.btn-stop:hover {
		border-color: var(--color-error);
		color: var(--color-error);
	}

	.streaming-indicator {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding-top: var(--space-2);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background-color: var(--color-primary);
		animation: bounce 1.4s ease-in-out infinite;
	}

	.dot:nth-child(2) {
		animation-delay: 0.2s;
	}
	.dot:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes bounce {
		0%,
		80%,
		100% {
			transform: scale(0.7);
			opacity: 0.5;
		}
		40% {
			transform: scale(1);
			opacity: 1;
		}
	}

	.streaming-text {
		color: var(--color-text-muted);
	}
</style>
