/**
 * Pure state helpers for the Slider component.
 *
 * The project does not have @testing-library/svelte, so the runtime logic
 * lives here as plain functions and is unit-tested directly. The Svelte
 * component wires these helpers into `$state` / `$derived` runes.
 */

/**
 * Clamp a value into the [min, max] range.
 *
 * `Number.isFinite` guards against NaN / Infinity propagation when callers
 * pass through arithmetic results.
 */
export function clampValue(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	if (value < min) return min;
	if (value > max) return max;
	return value;
}

/**
 * Snap a raw value to the nearest step boundary anchored at `min`.
 *
 * When `step` is undefined (or non-positive) the raw value is returned
 * unchanged — slider becomes free-form numeric. Otherwise the value is
 * rounded onto the grid `min, min+step, min+2·step, ...` then clamped
 * back inside [min, max] so the snap can never escape the range.
 */
export function snapToStep(
	value: number,
	min: number,
	max: number,
	step?: number,
): number {
	if (step === undefined || !Number.isFinite(step) || step <= 0) {
		return clampValue(value, min, max);
	}
	const offset = value - min;
	const snapped = min + Math.round(offset / step) * step;
	// Round to step's decimal precision to avoid 0.1 + 0.2 = 0.30000000000000004
	const decimals = decimalPlaces(step);
	const rounded = decimals > 0
		? Number(snapped.toFixed(decimals))
		: snapped;
	return clampValue(rounded, min, max);
}

/**
 * Compute the initial value for a slider:
 * 1. Use `defaultValue` if provided and inside the range
 * 2. Otherwise fall back to `min`
 *
 * The initial value is also snapped to the step grid so display matches
 * the value the model will receive.
 */
export function initialValue(
	min: number,
	max: number,
	step?: number,
	defaultValue?: number,
): number {
	const seed = defaultValue !== undefined ? defaultValue : min;
	return snapToStep(seed, min, max, step);
}

/**
 * Compute the percentage (0–100) representing where a value sits inside
 * the [min, max] range. Used to position the thumb and the filled track.
 */
export function valueToPercent(value: number, min: number, max: number): number {
	if (max <= min) return 0;
	const clamped = clampValue(value, min, max);
	return ((clamped - min) / (max - min)) * 100;
}

/**
 * Compute the "large step" used by PageUp / PageDown.
 *
 * Per the spec: large step = 10× step (when step is defined)
 *               OR 10% of the range (when step is undefined or zero).
 *
 * Returns at minimum the regular step so PageUp/PageDown always move
 * at least one tick on tiny ranges.
 */
export function largeStep(min: number, max: number, step?: number): number {
	const baseStep = step !== undefined && step > 0 ? step : 0;
	const tenPercent = (max - min) / 10;
	if (baseStep > 0) {
		return Math.max(baseStep, baseStep * 10);
	}
	return Math.max(tenPercent, 1e-9);
}

/**
 * Apply a keyboard interaction to a value.
 *
 * Returns either:
 *   - `{ kind: 'value', value }` — the new clamped+snapped value
 *   - `{ kind: 'submit' }`       — the caller should fire onSubmit
 *   - `{ kind: 'noop' }`         — key was not handled; let the browser see it
 *
 * The component reads this result and either updates state or invokes
 * the submit callback. Keys handled:
 *   - ArrowLeft / ArrowDown   →  value − step
 *   - ArrowRight / ArrowUp    →  value + step
 *   - Home                    →  min
 *   - End                     →  max
 *   - PageDown                →  value − largeStep
 *   - PageUp                  →  value + largeStep
 *   - Enter                   →  submit
 *
 * Any other key returns `noop` so the browser's default behaviour
 * (Tab, Shift+Tab, etc.) is preserved.
 */
export type KeyboardOutcome =
	| { kind: 'value'; value: number }
	| { kind: 'submit' }
	| { kind: 'noop' };

export function applyKeyboardStep(
	key: string,
	current: number,
	min: number,
	max: number,
	step?: number,
): KeyboardOutcome {
	const tick = step !== undefined && step > 0 ? step : (max - min) / 100;
	const big = largeStep(min, max, step);

	switch (key) {
		case 'ArrowLeft':
		case 'ArrowDown':
			return { kind: 'value', value: snapToStep(current - tick, min, max, step) };
		case 'ArrowRight':
		case 'ArrowUp':
			return { kind: 'value', value: snapToStep(current + tick, min, max, step) };
		case 'Home':
			return { kind: 'value', value: snapToStep(min, min, max, step) };
		case 'End':
			return { kind: 'value', value: snapToStep(max, min, max, step) };
		case 'PageDown':
			return { kind: 'value', value: snapToStep(current - big, min, max, step) };
		case 'PageUp':
			return { kind: 'value', value: snapToStep(current + big, min, max, step) };
		case 'Enter':
			return { kind: 'submit' };
		default:
			return { kind: 'noop' };
	}
}

/**
 * Format the displayed value for the readout.
 *
 * - When `step` has decimal places, the readout shows that many fractional
 *   digits (so `step=0.1` always shows one decimal even at integer values).
 * - The unit suffix (when present) is appended with a hair space-equivalent
 *   normal space — kept simple so monospace tabular alignment is preserved
 *   in the parent component.
 */
export function formatValue(value: number, step?: number, unit?: string): string {
	const decimals = step !== undefined && step > 0 ? decimalPlaces(step) : 0;
	const numeric = decimals > 0 ? value.toFixed(decimals) : `${Math.round(value)}`;
	return unit && unit.length > 0 ? `${numeric} ${unit}` : numeric;
}

/**
 * Build an ARIA-friendly value-text string.
 *
 * Screen readers announce `aria-valuetext` in preference to `aria-valuenow`
 * when set, so we include the unit when relevant — a slider showing "30 px"
 * is more useful than just "30".
 */
export function valueText(value: number, step?: number, unit?: string): string {
	return formatValue(value, step, unit);
}

// ---------------------------------------------------------------------------
// internal helpers
// ---------------------------------------------------------------------------

function decimalPlaces(n: number): number {
	if (!Number.isFinite(n)) return 0;
	const s = `${n}`;
	const dot = s.indexOf('.');
	if (dot === -1) return 0;
	return s.length - dot - 1;
}
