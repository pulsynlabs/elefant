<script lang="ts">
	// NumberInput — Quire-tokenised number input with stepper buttons.
	//
	// Wraps a native <input type="number"> with explicit +/− stepper controls,
	// hides the native browser spinner chrome (-webkit-inner-spin-button),
	// and lets the outer wrapper own the border / focus ring so the trio
	// reads as a single composed control. Bind value with `bind:value`.

	import { HugeiconsIcon, PlusIcon, MinusIcon } from '$lib/icons/index.js';

	type Props = {
		value?: number;
		min?: number;
		max?: number;
		step?: number;
		id?: string;
		placeholder?: string;
		disabled?: boolean;
		'aria-label'?: string;
	};

	let {
		value = $bindable(0),
		min,
		max,
		step = 1,
		id,
		placeholder,
		disabled = false,
		'aria-label': ariaLabel,
	}: Props = $props();

	const canDecrement = $derived(
		!disabled && (min === undefined || value > min)
	);
	const canIncrement = $derived(
		!disabled && (max === undefined || value < max)
	);

	function clamp(n: number): number {
		let next = n;
		if (min !== undefined) next = Math.max(next, min);
		if (max !== undefined) next = Math.min(next, max);
		return next;
	}

	function increment(): void {
		if (disabled) return;
		value = clamp((value ?? 0) + step);
	}

	function decrement(): void {
		if (disabled) return;
		value = clamp((value ?? 0) - step);
	}

	function handleKeyDown(event: KeyboardEvent): void {
		if (disabled) return;
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			increment();
		} else if (event.key === 'ArrowDown') {
			event.preventDefault();
			decrement();
		}
	}

	// Native <input type="number">'s `valueAsNumber` returns NaN for empty/
	// invalid; map that back to undefined-style by leaving prior value alone.
	function handleInput(event: Event): void {
		const target = event.currentTarget as HTMLInputElement;
		const next = target.valueAsNumber;
		if (Number.isNaN(next)) return;
		value = clamp(next);
	}
</script>

<div
	class="number-input-wrapper"
	class:disabled
	role="group"
	aria-label={ariaLabel}
>
	<button
		type="button"
		class="stepper-btn"
		aria-label="Decrement"
		tabindex="-1"
		disabled={!canDecrement}
		onclick={decrement}
	>
		<HugeiconsIcon icon={MinusIcon} size={14} strokeWidth={2} />
	</button>

	<span class="stepper-divider" aria-hidden="true"></span>

	<input
		{id}
		type="number"
		class="number-input-field"
		{min}
		{max}
		{step}
		{placeholder}
		{disabled}
		aria-label={ariaLabel}
		value={value ?? ''}
		oninput={handleInput}
		onkeydown={handleKeyDown}
	/>

	<span class="stepper-divider" aria-hidden="true"></span>

	<button
		type="button"
		class="stepper-btn"
		aria-label="Increment"
		tabindex="-1"
		disabled={!canIncrement}
		onclick={increment}
	>
		<HugeiconsIcon icon={PlusIcon} size={14} strokeWidth={2} />
	</button>
</div>

<style>
	.number-input-wrapper {
		display: inline-flex;
		align-items: center;
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-md);
		background-color: var(--surface-plate);
		transition: border-color var(--duration-fast) var(--ease-out-expo),
			box-shadow var(--duration-fast) var(--ease-out-expo);
		overflow: hidden;
	}

	.number-input-wrapper:hover:not(.disabled) {
		border-color: var(--border-emphasis);
	}

	.number-input-wrapper:focus-within {
		border-color: var(--border-focus);
		box-shadow: var(--glow-focus);
	}

	.number-input-wrapper.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.stepper-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		flex-shrink: 0;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: color var(--duration-fast) var(--ease-out-expo),
			background-color var(--duration-fast) var(--ease-out-expo);
	}

	.stepper-btn:hover:not(:disabled) {
		color: var(--text-prose);
		background-color: var(--color-primary-subtle);
	}

	.stepper-btn:focus-visible {
		outline: none;
		color: var(--color-primary);
	}

	.stepper-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.stepper-divider {
		width: 1px;
		height: 20px;
		background-color: var(--border-edge);
		flex-shrink: 0;
	}

	/* Native <input type="number"> styling — defang the global forms.css
	   defaults so the wrapper owns the visual surface. The input keeps
	   accessibility + native arrow-key handling but renders as a transparent
	   text-aligned numeric field. */
	.number-input-field {
		flex: 1;
		min-width: 60px;
		width: 100%;
		padding: 6px 8px;
		border: none;
		outline: none;
		background: transparent;
		color: var(--text-prose);
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		text-align: center;
		/* Hide native Firefox spinner. */
		-moz-appearance: textfield;
		appearance: textfield;
		-webkit-appearance: none;
	}

	/* Aggressively neutralise global forms.css :hover/:focus border + glow
	   that would otherwise paint a second ring inside the wrapper. */
	.number-input-field:hover:not(:disabled),
	.number-input-field:focus,
	.number-input-field:focus-visible {
		border: none;
		outline: none;
		box-shadow: none;
		background: transparent;
	}

	.number-input-field::placeholder {
		color: var(--text-muted);
	}

	.number-input-field:disabled {
		color: var(--text-disabled, var(--text-muted));
		cursor: not-allowed;
		opacity: 1; /* wrapper.disabled already dims the whole control */
		background: transparent;
	}

	/* Hide native WebKit spinner. */
	.number-input-field::-webkit-outer-spin-button,
	.number-input-field::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.number-input-wrapper,
		.stepper-btn {
			transition: none;
		}
	}
</style>
