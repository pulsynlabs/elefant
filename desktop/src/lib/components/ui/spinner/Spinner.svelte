<script lang="ts">
	type Size = 'sm' | 'md' | 'lg';
	type Tone = 'primary' | 'muted';

	type Props = {
		size?: Size;
		tone?: Tone;
		class?: string;
	};

	let { size = 'md', tone = 'primary', class: className = '' }: Props = $props();

	const sizeMap: Record<Size, { box: number; stroke: number }> = {
		sm: { box: 12, stroke: 1.5 },
		md: { box: 16, stroke: 2 },
		lg: { box: 24, stroke: 2 },
	};

	const dims = $derived(sizeMap[size]);
	// Stroke-dasharray covers ~25% of the circumference, leaving the rest open.
	// Circumference of r=8 unit-circle (viewBox 20) = 2 * pi * 8 ≈ 50.27.
	// We use viewBox 24 with r=10 so circumference ≈ 62.83. Dash 16, gap rest.
</script>

<span
	class="spinner spinner-{tone} {className}"
	style:--s-box="{dims.box}px"
	style:--s-stroke="{dims.stroke}px"
	role="status"
	aria-label="Loading"
>
	<svg
		class="spinner-svg"
		viewBox="0 0 24 24"
		width={dims.box}
		height={dims.box}
		aria-hidden="true"
		focusable="false"
	>
		<circle
			class="spinner-track"
			cx="12"
			cy="12"
			r="10"
			fill="none"
			stroke-width={dims.stroke}
			stroke-linecap="round"
		/>
	</svg>
	<span class="spinner-pulse" aria-hidden="true">
		<span></span>
		<span></span>
		<span></span>
	</span>
	<span class="sr-only">Loading…</span>
</span>

<style>
	.spinner {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--s-box);
		height: var(--s-box);
		flex-shrink: 0;
		position: relative;
	}

	.spinner-primary {
		color: var(--color-primary);
	}

	.spinner-muted {
		color: var(--text-muted);
	}

	.spinner-svg {
		display: block;
		animation: spinner-rotate 800ms linear infinite;
		/* GPU-accelerated rotation only; never animate width/height. */
		transform-origin: 50% 50%;
		will-change: transform;
	}

	.spinner-track {
		stroke: currentColor;
		/* Circumference of r=10 ≈ 62.83. ~25% arc visible. */
		stroke-dasharray: 16 62;
		stroke-dashoffset: 0;
	}

	/* Reduced-motion: hide the rotating ring, show a three-dot opacity pulse. */
	.spinner-pulse {
		display: none;
		gap: 2px;
		align-items: center;
		justify-content: center;
		position: absolute;
		inset: 0;
	}

	.spinner-pulse > span {
		display: inline-block;
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: currentColor;
		opacity: 0.25;
	}

	@keyframes spinner-rotate {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	@keyframes spinner-pulse-dot {
		0%, 80%, 100% { opacity: 0.25; }
		40% { opacity: 1; }
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner-svg {
			display: none;
		}

		.spinner-pulse {
			display: inline-flex;
		}

		.spinner-pulse > span {
			animation: spinner-pulse-dot 1400ms var(--ease-standard) infinite;
		}

		.spinner-pulse > span:nth-child(2) {
			animation-delay: 180ms;
		}

		.spinner-pulse > span:nth-child(3) {
			animation-delay: 360ms;
		}
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border-width: 0;
	}
</style>
