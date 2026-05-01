<script lang="ts">
	// NewSessionDialog — modal that wraps the ModePicker for the
	// "create session" flow.
	//
	// Lifecycle
	//   The dialog is mounted by the caller when the user clicks "+"
	//   in the sidebar. It does NOT call the daemon directly; it
	//   surfaces a confirmed `(mode)` choice via `onCreate` and lets
	//   the caller own the network round-trip and any post-creation
	//   navigation. This keeps the dialog reusable and side-effect
	//   free.
	//
	// Accessibility
	//   role="dialog", aria-modal="true", labelled by the visible
	//   title. Initial focus lands on the Cancel button — the safe
	//   non-destructive default — matching DeleteProjectDialog. Esc
	//   and backdrop click both invoke `onCancel`.

	import ModePicker from './ModePicker.svelte';
	import type { SessionMode } from './mode-picker-state.js';

	type Props = {
		projectName: string;
		defaultMode?: SessionMode;
		isCreating?: boolean;
		onCreate: (mode: SessionMode) => void | Promise<void>;
		onCancel: () => void;
	};

	let {
		projectName,
		defaultMode = 'quick',
		isCreating = false,
		onCreate,
		onCancel,
	}: Props = $props();

	// Seed-once: the dialog's selection is owned by the user once it
	// opens. We intentionally do NOT track changes to `defaultMode`.
	// svelte-ignore state_referenced_locally
	let selectedMode = $state<SessionMode>(defaultMode);
	let cancelButtonEl = $state<HTMLButtonElement | null>(null);

	$effect(() => {
		// Land focus on Cancel so an accidental Enter doesn't immediately
		// create a session — the user can Tab to "Create Session" or
		// activate the picker first.
		cancelButtonEl?.focus();
	});

	function handleSelect(mode: SessionMode): void {
		selectedMode = mode;
	}

	function handleBackdropKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			onCancel();
		}
	}

	function handleBackdropClick(event: MouseEvent): void {
		// Only dismiss when the click is on the backdrop, not when it
		// bubbles up from inside the dialog card.
		if (event.target === event.currentTarget) onCancel();
	}

	async function handleCreate(event: Event): Promise<void> {
		event.preventDefault();
		if (isCreating) return;
		await onCreate(selectedMode);
	}
</script>

<svelte:window onkeydown={handleBackdropKeydown} />

<div
	class="backdrop"
	role="presentation"
	onclick={handleBackdropClick}
>
	<form
		class="dialog"
		role="dialog"
		aria-modal="true"
		aria-labelledby="new-session-title"
		aria-describedby="new-session-description"
		onsubmit={handleCreate}
	>
		<header class="dialog-header">
			<h2 id="new-session-title" class="dialog-title">New Session</h2>
			<p id="new-session-description" class="dialog-description">
				Start a session in <strong class="project-name">{projectName}</strong>.
				Choose how you want to work.
			</p>
		</header>

		<ModePicker {defaultMode} onSelect={handleSelect} />

		<footer class="dialog-actions">
			<button
				type="button"
				class="dialog-button dialog-button-secondary"
				bind:this={cancelButtonEl}
				onclick={onCancel}
				disabled={isCreating}
			>
				Cancel
			</button>
			<button
				type="submit"
				class="dialog-button dialog-button-primary"
				disabled={isCreating}
				aria-busy={isCreating}
			>
				{isCreating ? 'Creating…' : 'Create Session'}
			</button>
		</footer>
	</form>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-modal, 1000);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
		background-color: color-mix(in srgb, var(--color-bg) 75%, transparent);
		animation: fade-in var(--transition-fast) ease-out;
	}

	.dialog {
		width: 100%;
		max-width: 560px;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-6);
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-xl);
		animation: scale-in var(--transition-fast) ease-out;
		max-height: 90vh;
		overflow-y: auto;
	}

	.dialog-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.dialog-title {
		font-size: var(--font-size-lg);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
		letter-spacing: var(--tracking-snug);
		margin: 0;
	}

	.dialog-description {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		line-height: var(--line-height-relaxed);
		margin: 0;
	}

	.project-name {
		color: var(--color-text-primary);
		font-weight: var(--font-weight-semibold);
		overflow-wrap: anywhere;
	}

	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-3);
		padding-top: var(--space-2);
		border-top: 1px solid var(--color-border);
	}

	.dialog-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 96px;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		letter-spacing: var(--tracking-snug);
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			color var(--transition-fast),
			box-shadow var(--transition-fast),
			transform var(--transition-fast);
	}

	.dialog-button:active:not(:disabled) {
		transform: translateY(1px);
	}

	.dialog-button:disabled {
		cursor: progress;
		opacity: 0.7;
	}

	.dialog-button:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.dialog-button-secondary {
		border: 1px solid var(--color-border-strong);
		background-color: transparent;
		color: var(--color-text-primary);
	}

	.dialog-button-secondary:hover:not(:disabled) {
		background-color: var(--color-surface-hover);
	}

	.dialog-button-primary {
		border: 1px solid var(--color-primary);
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
	}

	.dialog-button-primary:hover:not(:disabled) {
		background-color: color-mix(in srgb, var(--color-primary) 90%, black);
		border-color: color-mix(in srgb, var(--color-primary) 90%, black);
	}

	@keyframes fade-in {
		from { opacity: 0; }
		to   { opacity: 1; }
	}

	@keyframes scale-in {
		from { opacity: 0; transform: scale(0.96); }
		to   { opacity: 1; transform: scale(1); }
	}

	@media (prefers-reduced-motion: reduce) {
		.backdrop,
		.dialog {
			animation: none;
		}

		.dialog-button:active:not(:disabled) {
			transform: none;
		}
	}

	@media (max-width: 520px) {
		.dialog {
			padding: var(--space-5);
		}

		.dialog-actions {
			flex-direction: column-reverse;
		}

		.dialog-button {
			width: 100%;
		}
	}
</style>
