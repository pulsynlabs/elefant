<!--
@component
PhaseRail — horizontal step indicator for the spec-mode workflow phases.
Reads the active workflow's phase from the store and shows the user where they
are in the journey: Discuss → Plan → Specify → Execute → Audit → Accept.

Mobile/responsive: on screens narrower than ~640px the rail collapses to show
only the current phase plus prev/next arrows so it never overflows.

Accessibility:
  - aria-label on the nav names it ("Workflow phase progress").
  - aria-current="step" marks the active phase.
  - Each step is a button (or static span when not actionable).
-->
<script lang="ts">
	import { specModeStore } from '$lib/stores/spec-mode.svelte.js';
	import { HugeiconsIcon, CheckIcon, ChevronRightIcon } from '$lib/icons/index.js';

	export const PHASES = [
		'discuss',
		'plan',
		'research',
		'specify',
		'execute',
		'audit',
		'accept',
	] as const;
	type Phase = (typeof PHASES)[number];

	const PHASE_LABELS: Record<Phase, string> = {
		discuss: 'Discuss',
		plan: 'Plan',
		research: 'Research',
		specify: 'Specify',
		execute: 'Execute',
		audit: 'Audit',
		accept: 'Accept',
	};

	const activeWorkflow = $derived(specModeStore.activeWorkflow);
	const currentPhase = $derived<Phase>(
		(activeWorkflow?.phase as Phase | undefined) ?? 'discuss',
	);
	const currentIndex = $derived<number>(PHASES.indexOf(currentPhase));

	function statusFor(phase: Phase): 'complete' | 'current' | 'upcoming' {
		const index = PHASES.indexOf(phase);
		if (index < currentIndex) return 'complete';
		if (index === currentIndex) return 'current';
		return 'upcoming';
	}
</script>

<nav aria-label="Workflow phase progress" class="w-full">
	<!-- Wide screens: full rail -->
	<ol class="hidden items-center gap-1 sm:flex" role="list">
		{#each PHASES as phase, idx (phase)}
			{@const status = statusFor(phase)}
			<li class="flex items-center gap-1">
				<span
					class={[
						'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
						status === 'complete'
							? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-900/30 dark:text-emerald-300'
							: status === 'current'
								? 'border-emerald-600 bg-emerald-600 text-white shadow-sm'
								: 'border-gray-200 bg-transparent text-gray-400 dark:border-gray-700 dark:text-gray-500',
					].join(' ')}
					aria-current={status === 'current' ? 'step' : undefined}
				>
					<span
						class={[
							'inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px]',
							status === 'complete'
								? 'bg-emerald-600 text-white'
								: status === 'current'
									? 'bg-white text-emerald-700'
									: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
						].join(' ')}
						aria-hidden="true"
					>
						{#if status === 'complete'}
							<HugeiconsIcon icon={CheckIcon} size={10} strokeWidth={2.5} />
						{:else}
							{idx + 1}
						{/if}
					</span>
					{PHASE_LABELS[phase]}
				</span>
				{#if idx < PHASES.length - 1}
					<span aria-hidden="true" class="text-gray-300 dark:text-gray-700">
						<HugeiconsIcon icon={ChevronRightIcon} size={12} strokeWidth={1.5} />
					</span>
				{/if}
			</li>
		{/each}
	</ol>

	<!-- Narrow screens: compact view -->
	<div class="flex items-center justify-between gap-2 sm:hidden" aria-live="polite">
		<span class="text-xs text-gray-500 dark:text-gray-400">
			Step {currentIndex + 1} / {PHASES.length}
		</span>
		<span
			class="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"
			aria-current="step"
		>
			{PHASE_LABELS[currentPhase] ?? currentPhase}
		</span>
		<span class="text-xs text-gray-400 dark:text-gray-500">
			{#if currentIndex + 1 < PHASES.length}
				next: {PHASE_LABELS[PHASES[currentIndex + 1]]}
			{:else}
				—
			{/if}
		</span>
	</div>
</nav>
