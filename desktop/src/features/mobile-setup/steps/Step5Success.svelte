<script lang="ts">
	/**
	 * Step 5 — Success.
	 *
	 * Confirmation screen with a single CTA. Tapping the CTA invokes the
	 * `onComplete` callback, which the wizard shell wraps with
	 * `wizardState.saveConfig()` so the writes happen exactly once at this
	 * boundary (rather than after each step). That keeps the Capacitor
	 * Preferences round-trip off the critical path until the user has
	 * actually committed to finishing.
	 *
	 * The check icon uses --color-success rather than --color-primary so
	 * the visual reads as "done" not "in progress" — the indigo bar at the
	 * top of the wizard already conveys forward motion through Steps 1–4.
	 */
	import { HugeiconsIcon, CheckIcon } from '$lib/icons/index.js';

	type Props = {
		onComplete: () => void | Promise<void>;
	};

	let { onComplete }: Props = $props();

	let pending = $state(false);

	async function handleClick(): Promise<void> {
		if (pending) return;
		pending = true;
		try {
			await onComplete();
		} finally {
			// `pending` only matters until the wizard unmounts, but reset
			// just in case onComplete throws and the user wants to retry.
			pending = false;
		}
	}
</script>

<section class="step">
	<div class="hero">
		<div class="check-circle" aria-hidden="true">
			<HugeiconsIcon icon={CheckIcon} size={48} strokeWidth={2.5} />
		</div>
		<h1 class="headline">You're all set</h1>
		<p class="subtext">Elefant is connected to your daemon.</p>
	</div>

	<div class="actions">
		<button
			type="button"
			class="cta-primary"
			onclick={handleClick}
			disabled={pending}
		>
			{pending ? 'Saving…' : 'Start using Elefant'}
			{#if !pending}
				<span class="arrow" aria-hidden="true">→</span>
			{/if}
		</button>
	</div>
</section>

<style>
	.step {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		padding: var(--space-7) var(--space-5) var(--space-6);
		min-height: 0;
	}

	.hero {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-4);
		text-align: center;
		padding-bottom: var(--space-9);
	}

	.check-circle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 96px;
		height: 96px;
		border-radius: var(--radius-full);
		background-color: color-mix(
			in oklch,
			var(--color-success) 15%,
			transparent
		);
		color: var(--color-success);
		/* Soft halo so the success state reads as celebratory without
		   breaking the muted Quire palette. */
		box-shadow: 0 0 32px
			color-mix(in oklch, var(--color-success) 25%, transparent);
		animation: success-pulse var(--duration-slow) var(--ease-out-expo);
	}

	@keyframes success-pulse {
		0% {
			transform: scale(0.85);
			opacity: 0;
		}
		100% {
			transform: scale(1);
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.check-circle {
			animation: none;
		}
	}

	.headline {
		font-size: var(--font-size-3xl, 28px);
		font-weight: 700;
		color: var(--text-prose);
		letter-spacing: -0.02em;
		line-height: 1.1;
		margin: 0;
	}

	.subtext {
		font-size: var(--font-size-md, 16px);
		color: var(--text-meta);
		line-height: 1.5;
		max-width: 320px;
		margin: 0;
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		flex-shrink: 0;
	}

	.cta-primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: 52px;
		padding: var(--space-3) var(--space-5);
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		border: none;
		border-radius: var(--radius-plate);
		font-size: var(--font-size-md, 16px);
		font-weight: 600;
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			transform var(--duration-fast) var(--ease-out-expo),
			opacity var(--transition-fast);
		-webkit-tap-highlight-color: transparent;
	}

	.cta-primary:hover:not(:disabled) {
		background-color: var(--color-primary-hover);
	}

	.cta-primary:active:not(:disabled) {
		transform: scale(0.98);
	}

	.cta-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.cta-primary:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.arrow {
		font-size: 18px;
		line-height: 1;
		transition: transform var(--duration-fast) var(--ease-out-expo);
	}

	.cta-primary:hover .arrow {
		transform: translateX(2px);
	}

	@media (prefers-reduced-motion: reduce) {
		.cta-primary,
		.arrow {
			transition: none;
		}
		.cta-primary:active {
			transform: none;
		}
	}
</style>
