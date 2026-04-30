<script lang="ts">
	type Size = 'sm' | 'md';
	type Tone = 'primary' | 'success' | 'warning' | 'error';

	type Props = {
		value?: number;
		max?: number;
		size?: Size;
		tone?: Tone;
		indeterminate?: boolean;
		shimmer?: boolean;
		label?: string;
		showLabel?: boolean;
		class?: string;
	};

	let {
		value = 0,
		max = 100,
		size = 'md',
		tone = 'primary',
		indeterminate = false,
		shimmer = false,
		label,
		showLabel = false,
		class: className = '',
	}: Props = $props();

	const safeMax = $derived(max > 0 ? max : 100);
	const clampedValue = $derived(Math.min(safeMax, Math.max(0, value)));
	const percent = $derived((clampedValue / safeMax) * 100);
</script>

<div class="progress-wrapper progress-wrapper-{size} {className}">
	{#if label || showLabel}
		<div class="progress-header">
			{#if label}<span class="text-caption">{label}</span>{/if}
			{#if showLabel && !indeterminate}
				<span class="text-caption tabular-nums">{Math.round(percent)}%</span>
			{/if}
		</div>
	{/if}

	<div
		class="progress-track progress-tone-{tone}"
		role="progressbar"
		aria-label={label ?? 'Progress'}
		aria-valuemin={0}
		aria-valuemax={safeMax}
		aria-valuenow={indeterminate ? undefined : clampedValue}
	>
		{#if indeterminate}
			<div class="progress-indeterminate"></div>
		{:else}
			<div
				class="progress-fill"
				class:progress-fill-shimmer={shimmer}
				style:width="{percent}%"
			></div>
		{/if}
	</div>
</div>

<style>
	.progress-wrapper {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: 100%;
	}

	.progress-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-3);
	}

	.progress-track {
		position: relative;
		width: 100%;
		background: var(--surface-leaf);
		border-radius: var(--radius-full);
		overflow: hidden;
		isolation: isolate;
	}

	.progress-wrapper-md .progress-track {
		height: 3px;
	}

	.progress-wrapper-sm .progress-track {
		height: 2px;
	}

	/* Tone colors expose --progress-color for fill / indeterminate shared use. */
	.progress-tone-primary {
		--progress-color: var(--color-primary);
	}

	.progress-tone-success {
		--progress-color: var(--color-success);
	}

	.progress-tone-warning {
		--progress-color: var(--color-warning);
	}

	.progress-tone-error {
		--progress-color: var(--color-error);
	}

	.progress-fill {
		height: 100%;
		background: var(--progress-color);
		border-radius: inherit;
		/* width animation is the documented exception per BLUEPRINT W5.T2 — progress fill */
		transition: width var(--transition-base);
		min-width: 0;
		position: relative;
	}

	/* Shimmer sweep — translateX only, never background-position. */
	.progress-fill-shimmer::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			90deg,
			transparent 0%,
			rgba(255, 255, 255, 0.18) 50%,
			transparent 100%
		);
		transform: translateX(-100%);
		animation: progress-shimmer 1600ms var(--ease-standard) infinite;
		will-change: transform;
		pointer-events: none;
	}

	:global([data-theme='light']) .progress-fill-shimmer::after {
		background: linear-gradient(
			90deg,
			transparent 0%,
			rgba(255, 255, 255, 0.55) 50%,
			transparent 100%
		);
	}

	@keyframes progress-shimmer {
		from { transform: translateX(-100%); }
		to { transform: translateX(100%); }
	}

	/* Indeterminate: 30%-wide thumb sliding left → right, transform only. */
	.progress-indeterminate {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 30%;
		background: var(--progress-color);
		border-radius: inherit;
		transform: translateX(-100%);
		animation: progress-indeterminate 1500ms var(--ease-standard) infinite;
		will-change: transform;
	}

	@keyframes progress-indeterminate {
		from { transform: translateX(-100%); }
		to { transform: translateX(333%); }
	}

	@media (prefers-reduced-motion: reduce) {
		.progress-fill-shimmer::after,
		.progress-indeterminate {
			animation: none;
		}

		.progress-indeterminate {
			width: 100%;
			transform: translateX(0);
			opacity: 0.5;
		}
	}
</style>
