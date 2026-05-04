<script lang="ts">
	/**
	 * MobileSetupWizard — first-launch flow for Capacitor builds.
	 *
	 * Spec: MH4. Renders 5 steps in sequence (Welcome → Connection Type →
	 * URL+Test → Auth → Success). State machine lives in
	 * `wizard-state.svelte.ts`; each step is its own component so the shell
	 * stays small and steps can be unit-mounted in isolation.
	 *
	 * Layout: full-viewport flex column. Progress bar pinned at the top
	 * (one hairline tall) so users get a sense of forward motion without
	 * the chrome stealing focus from the step content. Content area scrolls
	 * vertically — important on devices with the soft keyboard open during
	 * the URL/auth steps.
	 *
	 * Safe area: `padding-top: env(safe-area-inset-top)` so the progress
	 * bar clears the status bar on devices with a notch / punch-hole.
	 * Bottom padding lives inside individual steps so each step can place
	 * its CTA exactly where it needs it.
	 *
	 * Mounting: only ever mounted by App.svelte under the
	 * `isCapacitorRuntime && !daemonUrlConfigured` gate. The component
	 * itself doesn't recheck the runtime — App.svelte is the gatekeeper
	 * and that responsibility stays in one place.
	 */
	import { wizardState } from './wizard-state.svelte.js';
	import Step1Welcome from './steps/Step1Welcome.svelte';
	import Step2ConnectionType from './steps/Step2ConnectionType.svelte';
	import Step3UrlTest from './steps/Step3UrlTest.svelte';
	import Step4Auth from './steps/Step4Auth.svelte';
	import Step5Success from './steps/Step5Success.svelte';

	type Props = {
		onComplete?: () => void | Promise<void>;
	};

	let { onComplete }: Props = $props();

	const totalSteps = 5;
	const step = $derived(wizardState.currentStep);
	// Progress bar fills from 0 (step 1) to 1 (step 5). Step 1 reads as
	// "just started" rather than empty because the user is already engaged.
	const progress = $derived((step - 1) / (totalSteps - 1));

	async function handleComplete(): Promise<void> {
		await wizardState.saveConfig();
		await onComplete?.();
	}
</script>

<div class="wizard-root">
	<div
		class="progress-track"
		role="progressbar"
		aria-valuenow={step}
		aria-valuemin={1}
		aria-valuemax={totalSteps}
		aria-label="Setup progress"
	>
		<div class="progress-fill" style="width: {progress * 100}%"></div>
	</div>

	<div class="wizard-content">
		{#if step === 1}
			<Step1Welcome onNext={() => wizardState.nextStep()} />
		{:else if step === 2}
			<Step2ConnectionType
				onNext={() => wizardState.nextStep()}
				onBack={() => wizardState.prevStep()}
			/>
		{:else if step === 3}
			<Step3UrlTest
				onNext={() => wizardState.nextStep()}
				onBack={() => wizardState.prevStep()}
			/>
		{:else if step === 4}
			<Step4Auth
				onNext={() => wizardState.nextStep()}
				onBack={() => wizardState.prevStep()}
				onSkip={() => wizardState.nextStep()}
			/>
		{:else if step === 5}
			<Step5Success onComplete={handleComplete} />
		{/if}
	</div>
</div>

<style>
	.wizard-root {
		/* Full viewport — `100dvh` first for browsers that respect dynamic
		   viewport units (modern Android Chrome / iOS Safari), with a
		   `100vh` fallback for older WebViews. The two declarations don't
		   conflict; the second simply overrides if 100dvh isn't supported. */
		display: flex;
		flex-direction: column;
		height: 100vh;
		height: 100dvh;
		background-color: var(--surface-substrate);
		padding-top: env(safe-area-inset-top, 0px);
		overflow: hidden;
	}

	/* Progress track — a single hairline that fills from left as the user
	   advances. Border-hairline gives the unfilled portion a barely-there
	   tone; the filled portion is full-strength primary so the eye reads
	   "progress" without the bar competing with the step content. */
	.progress-track {
		position: relative;
		height: 2px;
		width: 100%;
		background-color: var(--border-hairline);
		flex-shrink: 0;
	}

	.progress-fill {
		height: 100%;
		background-color: var(--color-primary);
		transition: width var(--duration-base) var(--ease-out-expo);
	}

	@media (prefers-reduced-motion: reduce) {
		.progress-fill {
			transition: none;
		}
	}

	.wizard-content {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
		display: flex;
		flex-direction: column;
		/* Bottom safe-area inset so the last child (typically a CTA) clears
		   the home indicator when steps don't paint to the viewport edge. */
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}
</style>
