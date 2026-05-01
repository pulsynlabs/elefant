<script lang="ts">
	import CommandCompletions from './command-completions/CommandCompletions.svelte';
	import {
		shouldOpenOverlay,
		extractQuery,
		applySelection,
	} from './command-completions/input-state.js';

	type Props = {
		disabled?: boolean;
		streaming?: boolean;
		onSend: (content: string) => void;
		onStop: () => void;
	};

	let { disabled = false, streaming = false, onSend, onStop }: Props = $props();

	let inputValue = $state('');
	let textareaEl: HTMLTextAreaElement;
	let wrapperEl: HTMLDivElement | undefined = $state(undefined);
	let isComposing = $state(false);

	// CommandCompletions exposes its keyboard hook via bind:this.
	let completions: { handleKeydown: (e: KeyboardEvent) => boolean; hasResults: () => boolean } | undefined =
		$state(undefined);

	const overlayOpen = $derived(shouldOpenOverlay(inputValue, isComposing));
	const query = $derived(overlayOpen ? extractQuery(inputValue) : '');

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

	function handleSelect(trigger: string): void {
		inputValue = applySelection(trigger);
		// Refocus and move caret to the end so the user can keep typing args.
		queueMicrotask(() => {
			if (!textareaEl) return;
			textareaEl.focus();
			const end = textareaEl.value.length;
			textareaEl.setSelectionRange(end, end);
		});
	}

	function handleDismiss(): void {
		// The overlay is purely value-driven (overlayOpen depends on inputValue),
		// so dismissal means: clear the leading `/` token. We replace just the
		// command token, preserving any whitespace the user might have typed.
		if (inputValue.startsWith('/')) {
			inputValue = '';
		}
	}

	function handleKeydown(event: KeyboardEvent): void {
		// IME composition: defer entirely to the browser.
		if (event.isComposing || isComposing) return;

		// Overlay-aware keystrokes intercept FIRST so Enter / Escape / arrows
		// route to the dropdown instead of the textarea defaults.
		if (overlayOpen && completions) {
			const consumed = completions.handleKeydown(event);
			if (consumed) {
				event.preventDefault();
				return;
			}
			// Special case: Enter while overlay is open but the consumer chose
			// not to handle it (no results). Suppress submit so the user can
			// keep typing or Escape out — they almost certainly didn't mean
			// to send `/foo` as a literal message.
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				return;
			}
		}

		if (event.key === 'Enter' && !event.shiftKey) {
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

	// Click-outside dismissal: when the overlay is open, a pointerdown
	// anywhere outside the wrapper closes it. We listen on pointerdown
	// (not click) so the dismissal happens before any focus shifts.
	$effect(() => {
		if (!overlayOpen) return;

		function onDocPointerDown(event: PointerEvent): void {
			if (!wrapperEl) return;
			const target = event.target as Node | null;
			if (target && !wrapperEl.contains(target)) {
				handleDismiss();
			}
		}

		document.addEventListener('pointerdown', onDocPointerDown);
		return () => document.removeEventListener('pointerdown', onDocPointerDown);
	});

	const canSend = $derived(!disabled && !streaming && inputValue.trim().length > 0);
</script>

<div class="message-input-wrapper" bind:this={wrapperEl}>
	{#if overlayOpen}
		<CommandCompletions
			bind:this={completions}
			{query}
			onSelect={handleSelect}
			onDismiss={handleDismiss}
		/>
	{/if}

	<textarea
		bind:this={textareaEl}
		bind:value={inputValue}
		class="message-input"
		placeholder="Message Elefant..."
		disabled={streaming}
		rows={1}
		onkeydown={handleKeydown}
		oninput={handleInput}
		oncompositionstart={() => (isComposing = true)}
		oncompositionend={() => (isComposing = false)}
		aria-label="Message input"
		aria-autocomplete="list"
		aria-expanded={overlayOpen}
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
				title="Send message (Enter)"
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
		position: relative;
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
