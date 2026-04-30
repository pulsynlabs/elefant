<script lang="ts">
	// DeleteProjectDialog — accessible confirmation modal for destructive
	// project deletion. Renders a centered card over a dimmed backdrop.
	//
	// Accessibility:
	//   - role="dialog" + aria-modal + aria-labelledby/aria-describedby
	//   - Initial focus lands on the Cancel button (the non-destructive option)
	//   - Esc or backdrop click invokes `onCancel` (never auto-deletes)
	//   - Confirm button exposes an `aria-busy` state while a delete is in flight
	//   - Page scroll is preserved; the backdrop is `position: fixed`

	import type { Project } from '$lib/types/project.js';

	type Props = {
		project: Project;
		onConfirm: () => void | Promise<void>;
		onCancel: () => void;
		isDeleting?: boolean;
	};

	let { project, onConfirm, onCancel, isDeleting = false }: Props = $props();

	let cancelButtonEl = $state<HTMLButtonElement | null>(null);
	const titleId = $derived(`delete-dialog-title-${project.id}`);
	const descriptionId = $derived(`delete-dialog-description-${project.id}`);

	// Focus the Cancel button when the dialog appears so the default
	// keyboard action is always the safe one.
	$effect(() => {
		cancelButtonEl?.focus();
	});

	function handleBackdropKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			onCancel();
		}
	}

	function handleBackdropClick(event: MouseEvent): void {
		// Only dismiss when the click is on the backdrop itself, not
		// when it bubbles up from the dialog card.
		if (event.target === event.currentTarget) {
			onCancel();
		}
	}

	async function handleConfirm(): Promise<void> {
		await onConfirm();
	}
</script>

<svelte:window onkeydown={handleBackdropKeydown} />

<div
	class="backdrop"
	role="presentation"
	onclick={handleBackdropClick}
>
	<div
		class="dialog"
		role="dialog"
		aria-modal="true"
		aria-labelledby={titleId}
		aria-describedby={descriptionId}
	>
		<h2 id={titleId} class="dialog-title">
			Delete <span class="project-name">{project.name}</span>?
		</h2>

		<p id={descriptionId} class="dialog-description">
			This removes the project from Elefant. The
			<code class="dialog-code">.elefant/</code>
			folder on disk will be kept, so you can re-open it later.
		</p>

		<div class="dialog-actions">
			<button
				type="button"
				class="dialog-button dialog-button-secondary"
				bind:this={cancelButtonEl}
				onclick={onCancel}
				disabled={isDeleting}
			>
				Cancel
			</button>
			<button
				type="button"
				class="dialog-button dialog-button-danger"
				onclick={handleConfirm}
				disabled={isDeleting}
				aria-busy={isDeleting}
			>
				{isDeleting ? 'Deleting…' : 'Delete'}
			</button>
		</div>
	</div>
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
		max-width: 440px;
		padding: var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-xl);
		animation: scale-in var(--transition-fast) ease-out;
	}

	.dialog-title {
		font-size: var(--font-size-lg);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
		letter-spacing: var(--tracking-snug);
		line-height: var(--line-height-snug);
		margin: 0;
	}

	.project-name {
		color: var(--color-text-primary);
		font-weight: var(--font-weight-bold);
		overflow-wrap: anywhere;
	}

	.dialog-description {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		line-height: var(--line-height-relaxed);
		margin: 0;
	}

	.dialog-code {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		background-color: var(--color-surface);
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
	}

	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-3);
		margin-top: var(--space-2);
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

	.dialog-button:active {
		transform: translateY(1px);
	}

	.dialog-button:disabled {
		cursor: progress;
		opacity: 0.7;
	}

	.dialog-button-secondary {
		border: 1px solid var(--color-border-strong);
		background-color: transparent;
		color: var(--color-text-primary);
	}

	.dialog-button-secondary:hover:not(:disabled) {
		background-color: var(--color-surface-hover);
		border-color: var(--color-border-strong);
	}

	.dialog-button-secondary:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.dialog-button-danger {
		border: 1px solid var(--color-error);
		background-color: var(--color-error);
		color: var(--color-primary-foreground);
	}

	.dialog-button-danger:hover:not(:disabled) {
		background-color: color-mix(in srgb, var(--color-error) 88%, black);
		border-color: color-mix(in srgb, var(--color-error) 88%, black);
	}

	.dialog-button-danger:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
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
	}

	@media (max-width: 480px) {
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
