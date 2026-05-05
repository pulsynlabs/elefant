<script lang="ts">
	/**
	 * OpenInEditorButton — secondary ghost button rendered in the reader pane
	 * sticky header. Asks the daemon to launch the user's external editor
	 * (`$EDITOR`, then VS Code, then system default — overrideable in
	 * Settings → Field Notes) on the currently open field note.
	 *
	 * Visual states:
	 * - idle:        external-link icon + "Open in editor"
	 * - launching:   spinner + "Open in editor" (button disabled)
	 * - success:     ✓ icon + "Opened" — auto-clears after 1.6 s
	 * - error:       ✗ icon + "Failed" — auto-clears after 3 s
	 */

	import { fieldNotesClient } from '$lib/daemon/fieldnotes-client.js';
	import {
		HugeiconsIcon,
		ExternalLinkIcon,
		CheckIcon,
		CrossIcon,
	} from '$lib/icons/index.js';

	type Status = 'idle' | 'launching' | 'success' | 'error';

	type Props = {
		projectId: string;
		filePath: string;
	};

	let { projectId, filePath }: Props = $props();

	let status = $state<Status>('idle');
	let errorMessage = $state<string | null>(null);
	let resetTimer: ReturnType<typeof setTimeout> | null = null;

	function clearTimer(): void {
		if (resetTimer !== null) {
			clearTimeout(resetTimer);
			resetTimer = null;
		}
	}

	async function openInEditor(): Promise<void> {
		clearTimer();
		status = 'launching';
		errorMessage = null;

		try {
			const result = await fieldNotesClient.openInEditor(projectId, filePath);
			if (result.launched) {
				status = 'success';
				resetTimer = setTimeout(() => {
					status = 'idle';
					resetTimer = null;
				}, 1600);
			} else {
				status = 'error';
				errorMessage = result.error ?? 'Editor failed to launch';
				resetTimer = setTimeout(() => {
					status = 'idle';
					errorMessage = null;
					resetTimer = null;
				}, 3000);
			}
		} catch (error) {
			status = 'error';
			errorMessage = error instanceof Error ? error.message : 'Editor failed to launch';
			resetTimer = setTimeout(() => {
				status = 'idle';
				errorMessage = null;
				resetTimer = null;
			}, 3000);
		}
	}
</script>

<button
	type="button"
	class="open-in-editor-btn"
	class:is-success={status === 'success'}
	class:is-error={status === 'error'}
	onclick={openInEditor}
	disabled={status === 'launching'}
	aria-busy={status === 'launching'}
	aria-label={status === 'error' && errorMessage
		? `Open in editor — last attempt failed: ${errorMessage}`
		: 'Open in external editor'}
	title={status === 'error' && errorMessage ? errorMessage : 'Open in external editor'}
>
	<span class="btn-icon" aria-hidden="true">
		{#if status === 'launching'}
			<span class="spinner-xs" />
		{:else if status === 'success'}
			<HugeiconsIcon icon={CheckIcon} size={14} strokeWidth={1.8} />
		{:else if status === 'error'}
			<HugeiconsIcon icon={CrossIcon} size={14} strokeWidth={1.8} />
		{:else}
			<HugeiconsIcon icon={ExternalLinkIcon} size={14} strokeWidth={1.8} />
		{/if}
	</span>
	<span class="btn-label">
		{#if status === 'success'}
			Opened
		{:else if status === 'error'}
			Failed
		{:else}
			Open in editor
		{/if}
	</span>
</button>

<style>
	.open-in-editor-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		background-color: transparent;
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			color var(--transition-fast);
		min-height: 32px;
	}

	.open-in-editor-btn:hover:not(:disabled) {
		background-color: var(--color-surface-hover);
		border-color: var(--color-border-strong);
		color: var(--color-text-primary);
	}

	.open-in-editor-btn:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	.open-in-editor-btn:disabled {
		opacity: 0.7;
		cursor: progress;
	}

	.open-in-editor-btn.is-success {
		color: var(--color-success);
		border-color: var(--color-success);
	}

	.open-in-editor-btn.is-error {
		color: var(--color-error);
		border-color: var(--color-error);
	}

	.btn-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
	}

	.btn-label {
		white-space: nowrap;
	}

	.spinner-xs {
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 1.5px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spinner-rotate 0.7s linear infinite;
	}

	@keyframes spinner-rotate {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner-xs {
			animation-duration: 1.6s;
		}
	}

	/* Mobile touch target */
	@media (max-width: 640px) {
		.open-in-editor-btn {
			min-height: 44px;
			padding: var(--space-2) var(--space-4);
		}
	}
</style>
