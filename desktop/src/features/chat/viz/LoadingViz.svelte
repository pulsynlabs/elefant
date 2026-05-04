<script lang="ts">
	// Premium loading viz renderer — the canonical first concrete
	// renderer registered against the viz registry. Animated card with
	// a primary-accented left edge, optional step list, and optional
	// progress bar. Honors `prefers-reduced-motion` (the global guard
	// in tokens.css already neutralises CSS animation, but we also
	// fade the spinner in our own block so the intent is explicit).

	import type { VizRendererProps } from './types.js';
	import {
		clampPct,
		activeStepIndex,
		type LoadingData,
	} from './loading-state.js';

	let { envelope }: VizRendererProps = $props();

	// Daemon-side Zod has already validated the envelope's payload;
	// the cast surfaces the typed shape to the rest of the component.
	const data = $derived(envelope.data as unknown as LoadingData);
	const pct = $derived(clampPct(data.pct));
	const active = $derived(activeStepIndex(data));
	const hasSteps = $derived(
		Array.isArray(data.steps) && data.steps.length > 0,
	);
	const hasProgress = $derived(data.pct !== undefined);
</script>

<div
	class="loading-viz"
	role="status"
	aria-live="polite"
	aria-label={data.msg}
>
	<div class="header">
		<span class="spinner" aria-hidden="true"></span>
		<span class="msg">{data.msg}</span>
	</div>

	{#if hasSteps && data.steps}
		<ol class="steps" aria-label="Progress steps">
			{#each data.steps as step, i (i)}
				<li
					class="step"
					class:active={i === active}
					class:done={active !== null && i < active}
				>
					<span class="step-dot" aria-hidden="true"></span>
					<span class="step-label">{step}</span>
				</li>
			{/each}
		</ol>
	{/if}

	{#if hasProgress}
		<div
			class="progress-track"
			role="progressbar"
			aria-valuenow={pct}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-label="Progress"
		>
			<div class="progress-fill" style="width: {pct}%"></div>
		</div>
	{/if}
</div>

<style>
	.loading-viz {
		margin: var(--space-2) 0;
		padding: var(--space-4);
		background: var(--surface-leaf);
		border: 1px solid var(--border-hairline);
		border-left: 3px solid var(--color-primary);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-xs);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid var(--border-edge);
		border-top-color: var(--color-primary);
		border-radius: var(--radius-full);
		animation: spin var(--duration-slow) linear infinite;
		flex-shrink: 0;
	}

	.msg {
		color: var(--text-prose);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		font-weight: 500;
		line-height: 1.5;
	}

	/* Steps */
	.steps {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.step {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.step-dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--border-edge);
		flex-shrink: 0;
		transition: background var(--transition-fast);
	}

	.step.active .step-dot {
		background: var(--color-primary);
		box-shadow: var(--glow-primary);
	}

	.step.done .step-dot {
		background: var(--color-success);
	}

	.step-label {
		color: var(--text-muted);
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		line-height: 1.5;
	}

	.step.active .step-label {
		color: var(--text-prose);
	}

	.step.done .step-label {
		color: var(--text-meta);
	}

	/* Progress bar */
	.progress-track {
		background: var(--surface-hover);
		border-radius: var(--radius-sm);
		height: 4px;
		overflow: hidden;
	}

	.progress-fill {
		background: var(--color-primary);
		height: 100%;
		border-radius: inherit;
		transition: width var(--transition-base);
	}

	/* Animation keyframes */
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Reduced motion: tokens.css already neutralises animations
	   globally, but we also dim the spinner so the static state
	   reads as intentional rather than broken. */
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
			opacity: 0.5;
		}
		.progress-fill {
			transition: none;
		}
	}
</style>
