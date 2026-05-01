<script lang="ts">
	/**
	 * UnifiedChatInput — the shared chat input surface used by both Quick
	 * Mode and Spec Mode (post-vision). Composes the auto-growing textarea
	 * with `ModelSelector`, `ThinkingToggle`, and a context-aware Send/Stop
	 * button into a single floating card.
	 *
	 * Drop-in replacement for `MessageInput.svelte` — props match exactly so
	 * callers can swap with no change. Command completions overlay is
	 * preserved verbatim from the legacy input.
	 *
	 * Visual design:
	 *   - Floating card: --surface-leaf bg, --radius-fold corners, hairline
	 *     --border-edge that emphasises on focus-within.
	 *   - Shadow lifts from --shadow-md to --shadow-lg as the card gains
	 *     focus, signalling the active write surface.
	 *   - Two stacked rows: textarea (full width) above, toolbar below.
	 *   - Toolbar: ModelSelector + ThinkingToggle on the left,
	 *     Send-or-Stop on the right.
	 *
	 * Tokens only — no Tailwind classes, no hex literals, no blur/backdrop.
	 */
	import CommandCompletions from './command-completions/CommandCompletions.svelte';
	import {
		shouldOpenOverlay,
		extractQuery,
		applySelection,
	} from './command-completions/input-state.js';
	import ModelSelector from './ModelSelector.svelte';
	import ThinkingToggle from './ThinkingToggle.svelte';
	import { chatStore } from './chat.svelte.js';

	type Props = {
		disabled?: boolean;
		streaming?: boolean;
		onSend: (content: string) => void;
		onStop: () => void;
	};

	let { disabled = false, streaming = false, onSend, onStop }: Props = $props();

	// --- Input state ----------------------------------------------------

	let inputValue = $state('');
	let textareaEl: HTMLTextAreaElement;
	let wrapperEl: HTMLDivElement | undefined = $state(undefined);
	let isComposing = $state(false);

	// CommandCompletions exposes its keyboard hook via bind:this so the
	// dropdown can intercept Arrow / Enter / Escape before the textarea
	// applies its defaults.
	let completions:
		| { handleKeydown: (e: KeyboardEvent) => boolean; hasResults: () => boolean }
		| undefined = $state(undefined);

	const overlayOpen = $derived(shouldOpenOverlay(inputValue, isComposing));
	const query = $derived(overlayOpen ? extractQuery(inputValue) : '');

	// --- Thinking toggle ------------------------------------------------
	//
	// State and capability detection live on `chatStore`:
	//   - `chatStore.thinkingEnabled` — whether the next turn should run
	//     in extended-thinking mode (resets per session).
	//   - `chatStore.currentModelSupportsThinking` — derived from the
	//     active provider/model id; a best-effort heuristic that falls
	//     back to `false` for unknown models (REQ-004 disabled-by-default).
	//
	// The component itself stays purely presentational: it reads the two
	// flags and routes the click back through `setThinkingEnabled`.

	function onThinkingToggle(): void {
		chatStore.setThinkingEnabled(!chatStore.thinkingEnabled);
	}

	// --- Send / handlers ------------------------------------------------

	function handleSend(): void {
		const content = inputValue.trim();
		if (!content || disabled || streaming) return;
		onSend(content);
		inputValue = '';
		// Reset textarea height after the send so the next message starts
		// from a single row again.
		if (textareaEl) {
			textareaEl.style.height = 'auto';
		}
	}

	function handleSelect(trigger: string): void {
		inputValue = applySelection(trigger);
		// Refocus the textarea and move the caret to the end so the user
		// can keep typing arguments after the trigger.
		queueMicrotask(() => {
			if (!textareaEl) return;
			textareaEl.focus();
			const end = textareaEl.value.length;
			textareaEl.setSelectionRange(end, end);
		});
	}

	function handleDismiss(): void {
		// The overlay is value-driven (overlayOpen depends on inputValue),
		// so dismissal means clearing the leading `/` token.
		if (inputValue.startsWith('/')) {
			inputValue = '';
		}
	}

	function handleKeydown(event: KeyboardEvent): void {
		// IME composition: defer entirely to the browser.
		if (event.isComposing || isComposing) return;

		// Overlay-aware keystrokes intercept FIRST so Enter / Escape /
		// arrows route to the dropdown instead of the textarea defaults.
		if (overlayOpen && completions) {
			const consumed = completions.handleKeydown(event);
			if (consumed) {
				event.preventDefault();
				return;
			}
			// Special case: Enter while overlay is open but the consumer
			// chose not to handle it (no results). Suppress submit so the
			// user can keep typing or Escape out — they almost certainly
			// didn't mean to send `/foo` as a literal message.
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
	// (not click) so dismissal happens before any focus shift.
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

	const canSend = $derived(
		!disabled && !streaming && inputValue.trim().length > 0,
	);
</script>

<div class="unified-input-wrapper" bind:this={wrapperEl}>
	{#if overlayOpen}
		<CommandCompletions
			bind:this={completions}
			{query}
			onSelect={handleSelect}
			onDismiss={handleDismiss}
		/>
	{/if}

	<!-- Row 1: textarea -->
	<textarea
		bind:this={textareaEl}
		bind:value={inputValue}
		class="unified-input"
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

	<!-- Row 2: toolbar -->
	<div class="toolbar">
		<div class="toolbar-left">
			<ModelSelector />
			<ThinkingToggle
				pressed={chatStore.thinkingEnabled}
				disabled={!chatStore.currentModelSupportsThinking}
				disabledReason={!chatStore.currentModelSupportsThinking
					? "Model doesn't support extended thinking"
					: undefined}
				onToggle={onThinkingToggle}
			/>
		</div>

		<div class="toolbar-right">
			{#if streaming}
				<button
					type="button"
					class="btn-stop"
					onclick={onStop}
					aria-label="Stop generating"
					title="Stop generating"
				>
					<span class="btn-stop__icon" aria-hidden="true">⬛</span>
					<span class="btn-stop__label">Stop</span>
				</button>
			{:else}
				<button
					type="button"
					class="btn-send"
					onclick={handleSend}
					disabled={!canSend}
					aria-label="Send message"
					title="Send message (Enter)"
				>
					<span class="btn-send__icon" aria-hidden="true">↑</span>
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	/* ----- Wrapper card ------------------------------------------------- */

	.unified-input-wrapper {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);

		background-color: var(--surface-leaf);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-fold);
		box-shadow: var(--shadow-md);

		transition:
			border-color var(--transition-fast),
			box-shadow var(--transition-base);
	}

	/* Lift the card on focus-within: stronger border + deeper shadow.
	   This is the visual signal that the user is actively writing. */
	.unified-input-wrapper:focus-within {
		border-color: var(--border-emphasis);
		box-shadow: var(--shadow-lg);
	}

	/* ----- Textarea ----------------------------------------------------- */

	.unified-input {
		width: 100%;
		min-height: 24px;
		max-height: 200px;
		padding: 0;

		background: none;
		border: none;
		outline: none;

		color: var(--text-prose);
		font-family: var(--font-sans);
		font-size: var(--font-size-md);
		line-height: 1.5;

		resize: none;
		overflow-y: auto;
		scrollbar-width: thin;
	}

	.unified-input::placeholder {
		color: var(--text-disabled);
	}

	.unified-input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	/* ----- Toolbar row -------------------------------------------------- */

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.toolbar-left {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		flex: 1 1 auto;
	}

	.toolbar-right {
		display: flex;
		align-items: center;
		flex: 0 0 auto;
	}

	/* ----- Send button -------------------------------------------------- */

	.btn-send {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;

		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		border: 1px solid transparent;
		border-radius: var(--radius-lg);

		font-family: inherit;
		font-size: var(--font-size-md);
		line-height: 1;
		cursor: pointer;

		transition:
			background-color var(--transition-fast),
			opacity var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.btn-send:not(:disabled):hover {
		background-color: var(--color-primary-hover);
	}

	.btn-send:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.btn-send:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn-send__icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-weight: 600;
		/* Tighten the arrow glyph so it sits visually centred in a 32px
		   button regardless of the ambient line-height */
		line-height: 1;
	}

	/* ----- Stop button -------------------------------------------------- */

	.btn-stop {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: 32px;
		padding: 0 var(--space-3);

		background-color: var(--surface-leaf);
		color: var(--text-prose);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-full);

		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		line-height: 1;
		cursor: pointer;

		transition:
			color var(--transition-fast),
			border-color var(--transition-fast),
			background-color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.btn-stop:hover {
		border-color: var(--color-error);
		color: var(--color-error);
		background-color: var(--surface-hover);
	}

	.btn-stop:focus-visible {
		outline: none;
		border-color: var(--border-focus);
		box-shadow: var(--glow-focus);
	}

	.btn-stop__icon {
		display: inline-flex;
		font-size: var(--font-size-sm);
		line-height: 1;
	}

	.btn-stop__label {
		display: inline-block;
	}

	/* ----- Reduced motion ----------------------------------------------- */

	@media (prefers-reduced-motion: reduce) {
		.unified-input-wrapper,
		.btn-send,
		.btn-stop {
			transition: none;
		}
	}
</style>
