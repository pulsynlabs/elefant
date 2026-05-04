<script lang="ts">
	/**
	 * Step 4 — Authentication (optional).
	 *
	 * Single token field with show/hide toggle. Token is optional — daemons
	 * exposed on a private network or behind another reverse-proxy auth
	 * layer don't need an app-level bearer. The Skip path is rendered as
	 * a peer to Continue, not buried, because for many users it's the
	 * correct choice.
	 *
	 * The token is sent as `Authorization: Bearer <token>` by both
	 * `wizardState.testConnection()` (Step 3) and the daemon client after
	 * persistence. We don't validate format here — daemons may issue any
	 * shape of token (UUID, JWT, opaque random) and the Step 3 ping
	 * already proved the URL works. Making the user re-test here would be
	 * friction without payoff.
	 */
	import { wizardState } from '../wizard-state.svelte.js';
	import { HugeiconsIcon, ViewIcon, ViewOffIcon } from '$lib/icons/index.js';

	type Props = {
		onNext: () => void;
		onBack: () => void;
		onSkip: () => void;
	};

	let { onNext, onBack, onSkip }: Props = $props();

	const token = $derived(wizardState.authToken);
	let showToken = $state(false);

	function handleInput(e: Event): void {
		wizardState.setAuthToken((e.target as HTMLInputElement).value);
	}

	function handleSkip(): void {
		// Clear any partially-typed token before skipping so the user
		// doesn't accidentally send half a credential to the daemon.
		wizardState.setAuthToken('');
		onSkip();
	}
</script>

<section class="step">
	<header class="step-header">
		<h1 class="headline">Authentication (optional)</h1>
		<p class="subtext">
			If your daemon requires an API key or bearer token, paste it
			below. You can add or change this later in Settings.
		</p>
	</header>

	<div class="form">
		<label class="field">
			<span class="field-label">API Key / Token</span>
			<div class="input-row">
				<input
					type={showToken ? 'text' : 'password'}
					autocomplete="off"
					autocapitalize="off"
					autocorrect="off"
					spellcheck="false"
					class="field-input"
					placeholder="Optional — leave blank if not required"
					value={token}
					oninput={handleInput}
				/>
				<button
					type="button"
					class="visibility-toggle"
					onclick={() => (showToken = !showToken)}
					aria-label={showToken ? 'Hide token' : 'Show token'}
				>
					<HugeiconsIcon
						icon={showToken ? ViewOffIcon : ViewIcon}
						size={18}
					/>
				</button>
			</div>
			<p class="field-hint">
				Stored locally on your device. Sent as a bearer token in the
				Authorization header.
			</p>
		</label>
	</div>

	<div class="actions">
		<div class="row-top">
			<button type="button" class="btn-secondary" onclick={onBack}>
				Back
			</button>
			<button type="button" class="btn-primary" onclick={onNext}>
				Continue
			</button>
		</div>
		<button type="button" class="btn-skip" onclick={handleSkip}>
			Skip — no authentication needed
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

	.input-row {
		display: flex;
		gap: var(--space-2);
		align-items: stretch;
	}

	.field-input {
		flex: 1 1 auto;
		min-width: 0;
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
	}

	.field-input:focus {
		border-color: var(--color-primary);
		box-shadow: var(--glow-focus);
	}

	.visibility-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 48px;
		min-height: 48px;
		flex-shrink: 0;
		background: transparent;
		color: var(--text-meta);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast);
		-webkit-tap-highlight-color: transparent;
	}

	.visibility-toggle:hover {
		color: var(--text-prose);
		border-color: var(--border-emphasis);
	}

	.visibility-toggle:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.field-hint {
		font-size: var(--font-size-xs, 12px);
		color: var(--text-muted);
		line-height: 1.5;
		margin: 0;
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		flex-shrink: 0;
		padding-top: var(--space-2);
	}

	.row-top {
		display: flex;
		gap: var(--space-3);
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

	.btn-secondary:hover {
		color: var(--text-prose);
		border-color: var(--border-emphasis);
	}

	.btn-primary {
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		border: none;
	}

	.btn-primary:hover {
		background-color: var(--color-primary-hover);
	}

	.btn-secondary:focus-visible,
	.btn-primary:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.btn-skip {
		min-height: 44px;
		padding: var(--space-2) var(--space-3);
		background: transparent;
		color: var(--text-muted);
		border: none;
		border-radius: var(--radius-sm);
		font-size: var(--font-size-sm, 14px);
		font-weight: 500;
		text-decoration: underline;
		text-underline-offset: 4px;
		cursor: pointer;
		transition: color var(--transition-fast);
		-webkit-tap-highlight-color: transparent;
	}

	.btn-skip:hover {
		color: var(--text-meta);
	}

	.btn-skip:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}
</style>
