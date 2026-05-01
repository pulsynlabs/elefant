<!--
@component
SpecVisionPane — full-screen onboarding pane for Spec Mode.

Shown when a Spec Mode session has no active workflows. The user types
their vision ("What are you looking to build?") into a centered, elevated
textarea. A "Prompt Engineer" toggle, when enabled, asks the parent to
optimize the text via a client-side transformation before submission.

Layout: full-viewport centered card. No rails, no toolbars.
Behavior:
  - Textarea is autofocused on mount, auto-grows up to 320px.
  - Cmd/Ctrl+Enter submits; Enter inserts a newline (long-form input).
  - While the parent reports `optimizing === true`, the textarea is
    disabled and a shimmer sweeps across the input container to signal
    the AI is working on the text.

Accessibility:
  - Textarea has aria-label and aria-multiline.
  - Submit button is aria-busy while optimizing.
  - Toggle uses aria-pressed.
  - Reduced-motion users get no shimmer or transitions.
-->
<script lang="ts">
	type Props = {
		onSubmit: (text: string, optimize: boolean) => Promise<void>;
		optimizing?: boolean;
	};

	let { onSubmit, optimizing = false }: Props = $props();

	let textValue = $state('');
	let optimizeEnabled = $state(false);
	let textareaEl = $state<HTMLTextAreaElement | null>(null);

	const canSubmit = $derived(textValue.trim().length > 0 && !optimizing);

	$effect(() => {
		// Autofocus the textarea once it's mounted so the user can start
		// typing immediately on first paint.
		textareaEl?.focus();
	});

	function autoGrow(el: HTMLTextAreaElement) {
		el.style.height = 'auto';
		const next = Math.min(el.scrollHeight, 320);
		el.style.height = `${next}px`;
	}

	function handleInput(event: Event) {
		const el = event.currentTarget as HTMLTextAreaElement;
		textValue = el.value;
		autoGrow(el);
	}

	function handleKeydown(event: KeyboardEvent) {
		// Cmd+Enter (mac) / Ctrl+Enter (win,linux) submits.
		// Enter alone inserts a newline — vision text is often multi-paragraph.
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			void handleSubmit();
		}
	}

	async function handleSubmit() {
		const text = textValue.trim();
		if (!text || optimizing) return;
		await onSubmit(text, optimizeEnabled);
	}

	function toggleOptimize() {
		if (optimizing) return;
		optimizeEnabled = !optimizeEnabled;
	}
</script>

<section class="spec-vision-pane" aria-labelledby="vision-heading">
	<div class="vision-card">
		<h1 id="vision-heading" class="vision-heading">
			What are you looking to build?
		</h1>
		<p class="vision-subtext">
			Describe your project, feature, or problem — Elefant will help you build it.
		</p>

		<div
			class="vision-textarea-wrapper"
			class:is-optimizing={optimizing}
			class:is-focused-within={false}
		>
			<textarea
				bind:this={textareaEl}
				class="vision-textarea"
				value={textValue}
				oninput={handleInput}
				onkeydown={handleKeydown}
				disabled={optimizing}
				aria-label="Describe your project"
				aria-multiline="true"
				placeholder="e.g. A dark mode toggle for the settings page, with smooth transitions and preference persistence..."
				rows="4"
			></textarea>
			{#if optimizing}
				<div class="vision-shimmer" aria-hidden="true"></div>
			{/if}
		</div>

		<div class="vision-actions">
			<button
				type="button"
				class="prompt-engineer-toggle"
				class:is-pressed={optimizeEnabled}
				class:is-busy={optimizing}
				aria-pressed={optimizeEnabled}
				aria-label="Toggle prompt optimization"
				onclick={toggleOptimize}
				disabled={optimizing}
			>
				<svg
					class="prompt-engineer-toggle__icon"
					viewBox="0 0 16 16"
					width="12"
					height="12"
					aria-hidden="true"
					focusable="false"
				>
					<path
						d="M8 1.5 L9.6 6.4 L14.5 8 L9.6 9.6 L8 14.5 L6.4 9.6 L1.5 8 L6.4 6.4 Z"
						fill="currentColor"
					/>
				</svg>
				<span class="prompt-engineer-toggle__label">
					{optimizing ? 'Optimizing…' : 'Prompt Engineer'}
				</span>
			</button>

			<button
				type="button"
				class="submit-button"
				onclick={handleSubmit}
				disabled={!canSubmit}
				aria-label="Submit vision and start building"
				aria-busy={optimizing}
			>
				<span class="submit-button__label">Build it</span>
				<svg
					class="submit-button__icon"
					viewBox="0 0 16 16"
					width="14"
					height="14"
					aria-hidden="true"
					focusable="false"
				>
					<path
						d="M3 8 L12 8 M8.5 4.5 L12 8 L8.5 11.5"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</button>
		</div>
	</div>
</section>

<style>
	.spec-vision-pane {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		min-height: 100%;
		padding: var(--space-7) var(--space-5);
		background-color: var(--surface-substrate);
		box-sizing: border-box;
	}

	.vision-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		width: 100%;
		max-width: 600px;
	}

	.vision-heading {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 400;
		font-size: clamp(1.5rem, 3.5vw, 2rem);
		line-height: 1.15;
		letter-spacing: -0.02em;
		color: var(--text-prose);
	}

	.vision-subtext {
		margin: 0;
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		line-height: 1.5;
		color: var(--text-muted);
	}

	/* Elevated input card — soft surface, hairline border, generous padding */
	.vision-textarea-wrapper {
		position: relative;
		overflow: hidden;
		padding: var(--space-4);
		background-color: var(--surface-leaf);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-fold);
		box-shadow: var(--shadow-md);
		transition:
			border-color var(--transition-base),
			box-shadow var(--transition-base);
	}

	.vision-textarea-wrapper:focus-within {
		border-color: var(--border-focus);
		box-shadow: var(--shadow-lg), var(--glow-focus);
	}

	.vision-textarea-wrapper.is-optimizing {
		border-color: var(--border-emphasis);
	}

	.vision-textarea {
		display: block;
		width: 100%;
		min-height: 96px;
		max-height: 320px;
		padding: 0;
		margin: 0;

		background-color: transparent;
		border: none;
		outline: none;
		resize: none;

		font-family: var(--font-sans);
		font-size: var(--font-size-md);
		line-height: 1.55;
		color: var(--text-prose);

		/* Match the wrapper's box so caret + scroll feel native */
		appearance: none;
		-webkit-appearance: none;
	}

	.vision-textarea::placeholder {
		color: var(--text-disabled);
	}

	.vision-textarea:disabled {
		cursor: progress;
		opacity: 0.85;
	}

	/* Shimmer overlay — animated gradient sweep while parent optimizes the text.
	   Sits above the textarea but does not capture pointer events. */
	.vision-shimmer {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: linear-gradient(
			90deg,
			transparent 0%,
			var(--surface-hover) 50%,
			transparent 100%
		);
		background-size: 200% 100%;
		opacity: 0.55;
		mix-blend-mode: screen;
		animation: vision-shimmer-sweep var(--transition-slow) linear infinite;
	}

	@keyframes vision-shimmer-sweep {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}

	.vision-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	/* Prompt Engineer toggle — pill, mirrors ThinkingToggle visual language */
	.prompt-engineer-toggle {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-4);
		min-height: 36px;

		background-color: var(--surface-leaf);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-full);

		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		font-weight: 500;
		line-height: 1;
		color: var(--text-meta);

		cursor: pointer;
		appearance: none;
		-webkit-appearance: none;
		user-select: none;

		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.prompt-engineer-toggle:not(.is-pressed):not(:disabled):hover {
		background-color: var(--surface-hover);
		color: var(--text-prose);
	}

	.prompt-engineer-toggle.is-pressed {
		background-color: var(--color-primary-subtle);
		border-color: var(--border-emphasis);
		color: var(--color-primary);
		box-shadow: var(--glow-primary);
	}

	.prompt-engineer-toggle.is-pressed:not(:disabled):hover {
		border-color: var(--color-primary);
	}

	.prompt-engineer-toggle:focus {
		outline: none;
	}

	.prompt-engineer-toggle:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.prompt-engineer-toggle.is-pressed:focus-visible {
		box-shadow: var(--glow-primary), var(--glow-focus);
	}

	.prompt-engineer-toggle:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}

	.prompt-engineer-toggle__icon {
		flex-shrink: 0;
		display: block;
	}

	.prompt-engineer-toggle__label {
		display: inline-block;
		letter-spacing: 0.01em;
	}

	/* Primary submit — fills the right side of the action row */
	.submit-button {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-6);
		min-height: 36px;

		background-color: var(--color-primary);
		border: 1px solid var(--color-primary);
		border-radius: var(--radius-full);

		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		font-weight: 600;
		line-height: 1;
		color: var(--color-primary-foreground);

		cursor: pointer;
		appearance: none;
		-webkit-appearance: none;
		user-select: none;
		box-shadow: var(--shadow-md);

		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			box-shadow var(--transition-fast),
			transform var(--transition-fast);
	}

	.submit-button:not(:disabled):hover {
		background-color: var(--color-primary-hover);
		border-color: var(--color-primary-hover);
		box-shadow: var(--shadow-lg), var(--glow-primary);
	}

	.submit-button:not(:disabled):active {
		transform: translateY(1px);
		box-shadow: var(--shadow-md);
	}

	.submit-button:focus {
		outline: none;
	}

	.submit-button:focus-visible {
		outline: none;
		box-shadow: var(--shadow-md), var(--glow-focus);
	}

	.submit-button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
		box-shadow: none;
	}

	.submit-button__icon {
		flex-shrink: 0;
		display: block;
	}

	.submit-button__label {
		display: inline-block;
		letter-spacing: 0.01em;
	}

	/* Reduced motion — kill shimmer and transitions */
	@media (prefers-reduced-motion: reduce) {
		.vision-textarea-wrapper,
		.prompt-engineer-toggle,
		.submit-button {
			transition: none;
		}

		.vision-shimmer {
			animation: none;
			background: var(--surface-hover);
			opacity: 0.25;
		}
	}
</style>
