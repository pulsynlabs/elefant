<script lang="ts">
	/**
	 * Step 2 — Connection Type.
	 *
	 * Two large radio-style cards: "Remote daemon" (recommended, the
	 * canonical mobile path) and "This device" (advanced). Mobile is
	 * remote-only per spec MH7, so the "This device" option is disabled
	 * with a hint explaining why — exposing the option preserves the
	 * mental model that running locally is *theoretically* possible while
	 * making the recommended path obvious.
	 *
	 * Pre-selection: 'remote' is set on first mount so users can tap Next
	 * immediately if that's their intent. Tapping the disabled "This
	 * device" card is a no-op (no state change, no navigation forward).
	 */
	import { wizardState, type ConnectionType } from '../wizard-state.svelte.js';

	type Props = {
		onNext: () => void;
		onBack: () => void;
	};

	let { onNext, onBack }: Props = $props();

	const selected = $derived(wizardState.connectionType);

	function selectType(type: ConnectionType): void {
		// Block selection of 'local' — the card is rendered as disabled
		// but defense in depth here keeps the state machine honest if the
		// disabled attribute is bypassed.
		if (type === 'local') return;
		wizardState.setConnectionType(type);
	}
</script>

<section class="step">
	<header class="step-header">
		<h1 class="headline">How do you use Elefant?</h1>
		<p class="subtext">
			Choose where the Elefant daemon runs. You can change this later in
			Settings.
		</p>
	</header>

	<div class="options" role="radiogroup" aria-label="Connection type">
		<button
			type="button"
			class="option-card"
			class:active={selected === 'remote'}
			role="radio"
			aria-checked={selected === 'remote'}
			onclick={() => selectType('remote')}
		>
			<div class="card-header">
				<span class="card-title">Remote daemon</span>
				<span class="card-badge">Recommended</span>
			</div>
			<p class="card-description">
				Connect to Elefant running on another machine — your laptop, a
				home server, or a VPS. The typical mobile setup.
			</p>
		</button>

		<button
			type="button"
			class="option-card disabled"
			role="radio"
			aria-checked={selected === 'local'}
			aria-disabled="true"
			disabled
			onclick={() => selectType('local')}
		>
			<div class="card-header">
				<span class="card-title">This device</span>
				<span class="card-badge subdued">Advanced</span>
			</div>
			<p class="card-description">
				Run the daemon locally on this phone. Requires a separate local
				setup — not supported in this build.
			</p>
		</button>
	</div>

	<div class="actions">
		<button type="button" class="btn-secondary" onclick={onBack}>
			Back
		</button>
		<button
			type="button"
			class="btn-primary"
			onclick={onNext}
			disabled={selected === 'local'}
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

	.options {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		flex: 1 1 auto;
	}

	/* Each option card is a tappable region with text content laid out
	   left-aligned — kept as a <button> for native semantics + keyboard
	   accessibility. The active border uses --color-primary so selection
	   reads instantly. */
	.option-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-4);
		background-color: var(--surface-plate);
		border: 1.5px solid var(--border-edge);
		border-radius: var(--radius-plate);
		text-align: left;
		cursor: pointer;
		transition:
			border-color var(--transition-fast),
			background-color var(--transition-fast),
			transform var(--duration-fast) var(--ease-out-expo);
		-webkit-tap-highlight-color: transparent;
		/* Touch target ≥44px even on the shortest variant. */
		min-height: 88px;
	}

	.option-card:hover:not(.disabled):not(:disabled) {
		border-color: var(--border-emphasis);
		background-color: var(--surface-leaf);
	}

	.option-card:active:not(.disabled):not(:disabled) {
		transform: scale(0.99);
	}

	.option-card.active {
		border-color: var(--color-primary);
		background-color: var(--color-primary-subtle);
	}

	.option-card.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.option-card:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.card-title {
		font-size: var(--font-size-md, 16px);
		font-weight: 600;
		color: var(--text-prose);
	}

	.card-badge {
		font-size: var(--font-size-xs, 12px);
		font-weight: 500;
		padding: 2px 8px;
		border-radius: var(--radius-full);
		background-color: var(--color-primary-subtle);
		color: var(--color-primary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.card-badge.subdued {
		background-color: var(--surface-hover);
		color: var(--text-muted);
	}

	.card-description {
		font-size: var(--font-size-sm, 14px);
		color: var(--text-meta);
		line-height: 1.5;
		margin: 0;
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

	@media (prefers-reduced-motion: reduce) {
		.option-card,
		.btn-secondary,
		.btn-primary {
			transition: none;
		}
		.option-card:active {
			transform: none;
		}
	}
</style>
