<script lang="ts">
	/**
	 * Step 3 — URL Input + Live Test.
	 *
	 * Captures the daemon URL and ensures it actually responds before
	 * letting the user advance. Two trigger paths:
	 *   - Manual: tap "Test Connection" to run a one-shot ping.
	 *   - Automatic: 800ms after the user stops typing, debounce-ping.
	 *
	 * Both paths call `wizardState.testConnection()`, which in turn fetches
	 * `<url>/health` with an 8s AbortSignal timeout and writes the result
	 * back to the store. Next is gated on `testStatus === 'success'` so the
	 * user can't proceed with a known-bad URL.
	 *
	 * UX detail: the input changes the test status back to 'idle' on every
	 * keystroke (handled in `wizardState.setDaemonUrl`), so a previously
	 * green checkmark won't carry over after the user edits the URL.
	 */
	import { onDestroy } from 'svelte';
	import { wizardState } from '../wizard-state.svelte.js';
	import { HugeiconsIcon, CheckIcon, ErrorIcon } from '$lib/icons/index.js';
	import Spinner from '$lib/components/ui/spinner/Spinner.svelte';

	type Props = {
		onNext: () => void;
		onBack: () => void;
	};

	let { onNext, onBack }: Props = $props();

	const url = $derived(wizardState.daemonUrl);
	const status = $derived(wizardState.testStatus);
	const error = $derived(wizardState.testError);

	// Debounce handle — cleared whenever the URL changes again so we don't
	// pile up overlapping requests when the user types quickly.
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	function handleUrlInput(e: Event): void {
		const value = (e.target as HTMLInputElement).value;
		wizardState.setDaemonUrl(value);

		if (debounceTimer) clearTimeout(debounceTimer);

		// Don't auto-test until the URL looks plausible — at minimum a
		// scheme + host. Saves the user from a flurry of error states
		// while they're still typing.
		const trimmed = value.trim();
		if (!/^https?:\/\/.+/.test(trimmed)) return;

		debounceTimer = setTimeout(() => {
			void wizardState.testConnection();
		}, 800);
	}

	function handleManualTest(): void {
		if (debounceTimer) clearTimeout(debounceTimer);
		void wizardState.testConnection();
	}

	function handleKeyDown(e: KeyboardEvent): void {
		// Soft-keyboard "Go" / Enter triggers the test rather than
		// submitting any enclosing form (we don't have one, but native
		// behavior on iOS/Android tends to default to form submit).
		if (e.key === 'Enter') {
			e.preventDefault();
			handleManualTest();
		}
	}

	onDestroy(() => {
		if (debounceTimer) clearTimeout(debounceTimer);
	});
</script>

<section class="step">
	<header class="step-header">
		<h1 class="headline">Connect to your daemon</h1>
		<p class="subtext">
			Enter the URL of your Elefant daemon. We'll verify it responds
			before continuing.
		</p>
	</header>

	<div class="form">
		<label class="field">
			<span class="field-label">Daemon URL</span>
			<input
				type="url"
				inputmode="url"
				autocomplete="off"
				autocapitalize="off"
				autocorrect="off"
				spellcheck="false"
				class="field-input"
				placeholder="https://your-server.com:1337"
				value={url}
				oninput={handleUrlInput}
				onkeydown={handleKeyDown}
				aria-invalid={status === 'error'}
				aria-describedby="url-status"
			/>
		</label>

		<div class="test-row">
			<button
				type="button"
				class="btn-test"
				onclick={handleManualTest}
				disabled={status === 'testing' || !url.trim()}
			>
				{status === 'testing' ? 'Testing…' : 'Test Connection'}
			</button>

			<div id="url-status" class="status" data-status={status} aria-live="polite">
				{#if status === 'idle'}
					<span class="status-text status-idle">Not tested yet</span>
				{:else if status === 'testing'}
					<span class="status-icon"><Spinner size="sm" /></span>
					<span class="status-text">Connecting…</span>
				{:else if status === 'success'}
					<span class="status-icon status-success">
						<HugeiconsIcon icon={CheckIcon} size={18} strokeWidth={2.5} />
					</span>
					<span class="status-text status-success">Connected</span>
				{:else if status === 'error'}
					<span class="status-icon status-error">
						<HugeiconsIcon icon={ErrorIcon} size={18} strokeWidth={2} />
					</span>
					<span class="status-text status-error">{error || 'Connection failed'}</span>
				{/if}
			</div>
		</div>
	</div>

	<div class="actions">
		<button type="button" class="btn-secondary" onclick={onBack}>
			Back
		</button>
		<button
			type="button"
			class="btn-primary"
			onclick={onNext}
			disabled={status !== 'success'}
		>
			Next
		</button>
	</div>
</section>

<style>
	.step {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		padding: var(--space-6) var(--space-5) var(--space-5);
		min-height: 0;
	}

	.step-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.headline {
		font-size: var(--font-size-2xl, 24px);
		font-weight: 700;
		color: var(--text-prose);
		letter-spacing: -0.01em;
		line-height: 1.2;
		margin: 0;
	}

	.subtext {
		font-size: var(--font-size-sm, 14px);
		color: var(--text-meta);
		line-height: 1.5;
		margin: 0;
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		flex: 1 1 auto;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.field-label {
		font-size: var(--font-size-xs, 12px);
		font-weight: 600;
		color: var(--text-meta);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.field-input {
		min-height: 48px;
		padding: var(--space-3) var(--space-4);
		background-color: var(--surface-plate);
		color: var(--text-prose);
		border: 1.5px solid var(--border-edge);
		border-radius: var(--radius-md);
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
		font-size: var(--font-size-md, 16px);
		outline: none;
		transition: border-color var(--transition-fast);
		/* iOS auto-zoom on focus is suppressed by font-size ≥16px — keep
		   16px even on small screens for that reason alone. */
	}

	.field-input:focus {
		border-color: var(--color-primary);
		box-shadow: var(--glow-focus);
	}

	.field-input[aria-invalid='true'] {
		border-color: var(--color-error);
	}

	.test-row {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.btn-test {
		min-height: 44px;
		padding: var(--space-2) var(--space-4);
		background-color: var(--surface-leaf);
		color: var(--text-prose);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-md);
		font-size: var(--font-size-sm, 14px);
		font-weight: 500;
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			opacity var(--transition-fast);
		-webkit-tap-highlight-color: transparent;
	}

	.btn-test:hover:not(:disabled) {
		border-color: var(--border-emphasis);
		background-color: var(--surface-hover);
	}

	.btn-test:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-test:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.status {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 24px;
		font-size: var(--font-size-sm, 14px);
	}

	.status-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.status-text {
		color: var(--text-meta);
		line-height: 1.4;
	}

	.status-text.status-idle {
		color: var(--text-muted);
	}

	.status-icon.status-success,
	.status-text.status-success {
		color: var(--color-success);
	}

	.status-icon.status-error,
	.status-text.status-error {
		color: var(--color-error);
	}

	.actions {
		display: flex;
		gap: var(--space-3);
		flex-shrink: 0;
		padding-top: var(--space-2);
	}

	.btn-secondary,
	.btn-primary {
		flex: 1 1 0;
		min-height: 48px;
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		font-size: var(--font-size-md, 16px);
		font-weight: 600;
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			opacity var(--transition-fast);
		-webkit-tap-highlight-color: transparent;
	}

	.btn-secondary {
		background-color: transparent;
		color: var(--text-meta);
		border: 1px solid var(--border-edge);
	}

	.btn-secondary:hover:not(:disabled) {
		color: var(--text-prose);
		border-color: var(--border-emphasis);
	}

	.btn-primary {
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		border: none;
	}

	.btn-primary:hover:not(:disabled) {
		background-color: var(--color-primary-hover);
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-secondary:focus-visible,
	.btn-primary:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}
</style>
