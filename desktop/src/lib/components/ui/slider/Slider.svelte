<script lang="ts">
	import Button from '$lib/components/ui/button/button.svelte';
	import {
		applyKeyboardStep,
		formatValue,
		initialValue,
		snapToStep,
		valueText,
		valueToPercent,
	} from './slider-state.js';

	type Props = {
		label: string;
		min: number;
		max: number;
		step?: number;
		default?: number;
		unit?: string;
		onSubmit: (value: number) => void;
		disabled?: boolean;
		submitLabel?: string;
	};

	let {
		label,
		min,
		max,
		step,
		default: defaultValue,
		unit,
		onSubmit,
		disabled = false,
		submitLabel = 'Submit',
	}: Props = $props();

	// Internal value lives in state; it is seeded from the default on first
	// render and never reset when props change because the slider is
	// inherently a live, user-controlled input — the caller would otherwise
	// be racing the user's interaction. Svelte's state-referenced-locally
	// warning is silenced because seed-once is the intended contract.
	// svelte-ignore state_referenced_locally
	let value = $state(initialValue(min, max, step, defaultValue));
	let trackEl = $state<HTMLDivElement | null>(null);
	let isPointerDragging = $state(false);
	// Unique-per-instance id so multiple sliders in one transcript can
	// each pair their <label> / <output> with the correct thumb element.
	const thumbId = `slider-thumb-${Math.random().toString(36).slice(2, 10)}`;

	const percent = $derived(valueToPercent(value, min, max));
	const readout = $derived(formatValue(value, step, unit));
	const ariaText = $derived(valueText(value, step, unit));

	function handleKeydown(event: KeyboardEvent): void {
		if (disabled) return;
		const outcome = applyKeyboardStep(event.key, value, min, max, step);
		if (outcome.kind === 'noop') return;
		// Prevent the default for handled keys so PageUp/Down doesn't scroll
		// the surrounding chat transcript and Enter doesn't submit a parent
		// form.
		event.preventDefault();
		if (outcome.kind === 'value') {
			value = outcome.value;
		} else {
			onSubmit(value);
		}
	}

	function valueFromPointerX(clientX: number): number {
		if (!trackEl) return value;
		const rect = trackEl.getBoundingClientRect();
		if (rect.width <= 0) return value;
		const ratio = (clientX - rect.left) / rect.width;
		const clampedRatio = Math.min(1, Math.max(0, ratio));
		const raw = min + clampedRatio * (max - min);
		return snapToStep(raw, min, max, step);
	}

	function handlePointerDown(event: PointerEvent): void {
		if (disabled) return;
		// Only respond to primary-button pointer presses; ignore right-click
		// and middle-click so context menus / autoscroll still work.
		if (event.button !== 0) return;
		isPointerDragging = true;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		value = valueFromPointerX(event.clientX);
		event.preventDefault();
	}

	function handlePointerMove(event: PointerEvent): void {
		if (!isPointerDragging || disabled) return;
		value = valueFromPointerX(event.clientX);
	}

	function handlePointerUp(event: PointerEvent): void {
		if (!isPointerDragging) return;
		isPointerDragging = false;
		try {
			(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
		} catch {
			// Capture may already have been released by the browser.
		}
	}

	function handleSubmitClick(): void {
		if (disabled) return;
		onSubmit(value);
	}
</script>

<div class="slider-root" data-disabled={disabled || undefined}>
	<div class="slider-header">
		<label class="slider-label" for={thumbId}>{label}</label>
		<output class="slider-readout" for={thumbId}>{readout}</output>
	</div>

	<div
		bind:this={trackEl}
		class="slider-track"
		class:dragging={isPointerDragging}
		role="presentation"
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerUp}
	>
		<div class="slider-fill" style:width="{percent}%" aria-hidden="true"></div>
		<div
			id={thumbId}
			class="slider-thumb"
			style:left="{percent}%"
			role="slider"
			tabindex={disabled ? -1 : 0}
			aria-label={label}
			aria-valuemin={min}
			aria-valuemax={max}
			aria-valuenow={value}
			aria-valuetext={ariaText}
			aria-disabled={disabled || undefined}
			aria-orientation="horizontal"
			onkeydown={handleKeydown}
		></div>
	</div>

	<div class="slider-actions">
		<Button
			variant="default"
			size="sm"
			disabled={disabled}
			onclick={handleSubmitClick}
		>
			{submitLabel}
		</Button>
	</div>
</div>

<style>
	.slider-root {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		width: 100%;
	}

	.slider-root[data-disabled] {
		opacity: 0.6;
		pointer-events: none;
	}

	.slider-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.slider-label {
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-primary);
		line-height: 1.3;
	}

	.slider-readout {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-primary);
		font-variant-numeric: tabular-nums;
		min-width: 4ch;
		text-align: right;
	}

	.slider-track {
		position: relative;
		height: 28px;
		display: flex;
		align-items: center;
		cursor: pointer;
		touch-action: none;
		/* The clickable region is the whole 28px-tall row but the visual
		   rail is rendered via ::before so the thumb can extend above and
		   below the rail without enlarging the hit-target visually. */
	}

	.slider-track::before {
		content: '';
		position: absolute;
		inset: 50% 0 auto 0;
		height: 4px;
		transform: translateY(-50%);
		background: var(--surface-leaf);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-full);
	}

	.slider-fill {
		position: absolute;
		top: 50%;
		left: 0;
		height: 4px;
		transform: translateY(-50%);
		background: var(--color-primary);
		border-radius: var(--radius-full);
		pointer-events: none;
		min-width: 0;
		max-width: 100%;
	}

	.slider-thumb {
		position: absolute;
		top: 50%;
		width: 16px;
		height: 16px;
		transform: translate(-50%, -50%);
		background: var(--surface-leaf);
		border: 1.5px solid var(--color-primary);
		border-radius: var(--radius-full);
		box-shadow: var(--shadow-sm);
		cursor: grab;
		transition:
			box-shadow var(--transition-fast),
			border-color var(--transition-fast),
			background-color var(--transition-fast);
	}

	.slider-thumb:hover {
		background: var(--surface-hover);
	}

	.slider-thumb:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus), var(--shadow-sm);
		border-color: var(--border-focus);
	}

	.slider-track.dragging .slider-thumb {
		cursor: grabbing;
		box-shadow: var(--glow-primary), var(--shadow-md);
	}

	.slider-actions {
		display: flex;
		justify-content: flex-end;
	}

	@media (prefers-reduced-motion: reduce) {
		.slider-thumb {
			transition: none;
		}
	}
</style>
