<script lang="ts">
	/**
	 * Step 1 — Welcome.
	 *
	 * First impression of the wizard. Centered logo, headline, subtext, and
	 * a single primary CTA. No form fields, no decisions to make — the
	 * intent is to set tone and reassure the user that setup is short.
	 *
	 * Logo source matches the existing OnboardingView (`/elefant-dark.png`
	 * for dark, `/elefant-light.png` for light) so users see the same
	 * brand mark they'd see on desktop.
	 */
	import { themeStore } from '$lib/stores/theme.svelte.js';

	type Props = {
		onNext: () => void;
	};

	let { onNext }: Props = $props();

	const logoSrc = $derived(
		themeStore.isDark ? '/elefant-dark.png' : '/elefant-light.png',
	);
</script>

<section class="step">
	<div class="hero">
		<img
			src={logoSrc}
			alt="Elefant"
			class="brand-logo"
			width="96"
			height="96"
		/>
		<h1 class="headline">Welcome to Elefant</h1>
		<p class="subtext">Your AI coding agent, everywhere.</p>
	</div>

	<div class="actions">
		<button type="button" class="cta-primary" onclick={onNext}>
			Get Started
			<span class="arrow" aria-hidden="true">→</span>
		</button>
	</div>
</section>

<style>
	.step {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		align-items: stretch;
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
		/* Pull the hero up slightly from absolute center for visual balance —
		   matches the convention of mobile splash screens where content sits
		   in the upper-third rather than dead center. */
		padding-bottom: var(--space-9);
	}

	.brand-logo {
		width: 96px;
		height: 96px;
		object-fit: contain;
		border-radius: var(--radius-2xl);
		/* Soft ambient glow so the logo doesn't feel pasted onto the dark
		   substrate — the glow uses the same primary tint as everything
		   else in the brand system. */
		box-shadow: var(--glow-ambient);
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
			transform var(--duration-fast) var(--ease-out-expo);
		-webkit-tap-highlight-color: transparent;
	}

	.cta-primary:hover:not(:disabled) {
		background-color: var(--color-primary-hover);
	}

	.cta-primary:active:not(:disabled) {
		transform: scale(0.98);
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
