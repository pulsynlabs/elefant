// Slider component tests.
//
// The desktop project does not ship @testing-library/svelte, so the
// runtime logic of the slider lives in `slider-state.ts` and is unit
// tested directly here. ARIA / wiring contracts that can only be
// expressed in the .svelte file are verified via readFileSync source
// assertions — same pattern as TaskToolCard.test.ts.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
	applyKeyboardStep,
	clampValue,
	formatValue,
	initialValue,
	largeStep,
	snapToStep,
	valueText,
	valueToPercent,
} from './slider-state.js';

const SLIDER_SOURCE = readFileSync(
	join(import.meta.dir, 'Slider.svelte'),
	'utf8',
);

describe('clampValue', () => {
	it('returns the value unchanged when inside [min, max]', () => {
		expect(clampValue(5, 0, 10)).toBe(5);
	});

	it('clamps below min to min', () => {
		expect(clampValue(-3, 0, 10)).toBe(0);
	});

	it('clamps above max to max', () => {
		expect(clampValue(99, 0, 10)).toBe(10);
	});

	it('returns min when value is NaN', () => {
		expect(clampValue(NaN, 0, 10)).toBe(0);
	});

	it('returns min when value is +Infinity', () => {
		// Infinity is not Number.isFinite, fallback to min per contract.
		expect(clampValue(Infinity, 0, 10)).toBe(0);
	});
});

describe('snapToStep', () => {
	it('returns clamped value unchanged when step is undefined', () => {
		expect(snapToStep(3.7, 0, 10)).toBe(3.7);
		expect(snapToStep(99, 0, 10)).toBe(10);
	});

	it('returns clamped value unchanged when step is zero or negative', () => {
		expect(snapToStep(3.7, 0, 10, 0)).toBe(3.7);
		expect(snapToStep(3.7, 0, 10, -1)).toBe(3.7);
	});

	it('snaps to the nearest integer step', () => {
		expect(snapToStep(3.4, 0, 10, 1)).toBe(3);
		expect(snapToStep(3.6, 0, 10, 1)).toBe(4);
	});

	it('snaps to fractional step grids without floating-point drift', () => {
		expect(snapToStep(0.3, 0, 1, 0.1)).toBe(0.3);
		// 0.1 + 0.2 floating-point hazard: result must be exactly 0.3
		expect(snapToStep(0.1 + 0.2, 0, 1, 0.1)).toBe(0.3);
	});

	it('clamps after snapping so the snap can never exceed max', () => {
		// raw value 11 with step=2 anchored at 0 → snap to 12 → clamped to 10
		expect(snapToStep(11, 0, 10, 2)).toBe(10);
	});

	it('snaps from a non-zero min', () => {
		// step grid anchored at min=5: 5, 7, 9, 11.
		// value 7.4 sits 2.4 above min → round(2.4/2)=1 → 5+2 = 7.
		expect(snapToStep(7.4, 5, 11, 2)).toBe(7);
		// value 8.6 sits 3.6 above min → round(3.6/2)=2 → 5+4 = 9.
		expect(snapToStep(8.6, 5, 11, 2)).toBe(9);
	});
});

describe('initialValue', () => {
	it('uses min when no default provided', () => {
		expect(initialValue(0, 100)).toBe(0);
	});

	it('uses default when provided and inside range', () => {
		expect(initialValue(0, 100, undefined, 42)).toBe(42);
	});

	it('snaps the default onto the step grid', () => {
		expect(initialValue(0, 10, 1, 4.7)).toBe(5);
	});

	it('clamps an out-of-range default into the range', () => {
		expect(initialValue(0, 10, undefined, 50)).toBe(10);
		expect(initialValue(0, 10, undefined, -50)).toBe(0);
	});
});

describe('valueToPercent', () => {
	it('returns 0 at min', () => {
		expect(valueToPercent(0, 0, 100)).toBe(0);
	});

	it('returns 100 at max', () => {
		expect(valueToPercent(100, 0, 100)).toBe(100);
	});

	it('returns 50 at midpoint', () => {
		expect(valueToPercent(50, 0, 100)).toBe(50);
	});

	it('returns 0 when min === max (degenerate)', () => {
		expect(valueToPercent(5, 5, 5)).toBe(0);
	});

	it('clamps overflow values', () => {
		expect(valueToPercent(150, 0, 100)).toBe(100);
		expect(valueToPercent(-50, 0, 100)).toBe(0);
	});
});

describe('largeStep', () => {
	it('returns 10× step when step is defined', () => {
		expect(largeStep(0, 100, 1)).toBe(10);
	});

	it('returns 10% of range when step is undefined', () => {
		expect(largeStep(0, 100)).toBe(10);
	});

	it('falls back to 10% of range when step is zero', () => {
		expect(largeStep(0, 50, 0)).toBe(5);
	});
});

describe('applyKeyboardStep', () => {
	const min = 0;
	const max = 100;
	const step = 5;

	it('decrements on ArrowLeft', () => {
		expect(applyKeyboardStep('ArrowLeft', 50, min, max, step)).toEqual({
			kind: 'value',
			value: 45,
		});
	});

	it('decrements on ArrowDown', () => {
		expect(applyKeyboardStep('ArrowDown', 50, min, max, step)).toEqual({
			kind: 'value',
			value: 45,
		});
	});

	it('increments on ArrowRight', () => {
		expect(applyKeyboardStep('ArrowRight', 50, min, max, step)).toEqual({
			kind: 'value',
			value: 55,
		});
	});

	it('increments on ArrowUp', () => {
		expect(applyKeyboardStep('ArrowUp', 50, min, max, step)).toEqual({
			kind: 'value',
			value: 55,
		});
	});

	it('jumps to min on Home', () => {
		expect(applyKeyboardStep('Home', 50, min, max, step)).toEqual({
			kind: 'value',
			value: 0,
		});
	});

	it('jumps to max on End', () => {
		expect(applyKeyboardStep('End', 50, min, max, step)).toEqual({
			kind: 'value',
			value: 100,
		});
	});

	it('decrements by large step on PageDown', () => {
		expect(applyKeyboardStep('PageDown', 50, min, max, step)).toEqual({
			kind: 'value',
			value: 0,
		});
	});

	it('increments by large step on PageUp', () => {
		expect(applyKeyboardStep('PageUp', 50, min, max, step)).toEqual({
			kind: 'value',
			value: 100,
		});
	});

	it('returns submit on Enter', () => {
		expect(applyKeyboardStep('Enter', 50, min, max, step)).toEqual({ kind: 'submit' });
	});

	it('returns noop on unhandled keys', () => {
		expect(applyKeyboardStep('Tab', 50, min, max, step)).toEqual({ kind: 'noop' });
		expect(applyKeyboardStep('a', 50, min, max, step)).toEqual({ kind: 'noop' });
	});

	it('clamps decrement at min', () => {
		expect(applyKeyboardStep('ArrowLeft', 0, min, max, step)).toEqual({
			kind: 'value',
			value: 0,
		});
	});

	it('clamps increment at max', () => {
		expect(applyKeyboardStep('ArrowRight', 100, min, max, step)).toEqual({
			kind: 'value',
			value: 100,
		});
	});

	it('uses 1% of range when step is undefined', () => {
		// range = 100, step undefined → tick = 1 → 50 + 1 = 51 (no snap)
		expect(applyKeyboardStep('ArrowRight', 50, min, max)).toEqual({
			kind: 'value',
			value: 51,
		});
	});
});

describe('formatValue', () => {
	it('rounds to integer when step is undefined or whole', () => {
		expect(formatValue(3.7)).toBe('4');
		expect(formatValue(3.7, 1)).toBe('4');
	});

	it('preserves decimal precision matching step', () => {
		expect(formatValue(3.14, 0.01)).toBe('3.14');
		expect(formatValue(3, 0.1)).toBe('3.0');
	});

	it('appends a unit suffix when present', () => {
		expect(formatValue(50, 1, '%')).toBe('50 %');
		expect(formatValue(120, 1, 'ms')).toBe('120 ms');
	});

	it('omits the unit space when unit is empty string', () => {
		expect(formatValue(50, 1, '')).toBe('50');
	});
});

describe('valueText (ARIA)', () => {
	it('mirrors formatValue (screen readers prefer aria-valuetext)', () => {
		expect(valueText(50, 1, 'px')).toBe('50 px');
		expect(valueText(0.5, 0.1)).toBe('0.5');
	});
});

// ---------------------------------------------------------------------------
// Source-level wiring assertions
// ---------------------------------------------------------------------------
//
// These verify the .svelte file actually wires the pure helpers and
// emits the ARIA contract the spec requires. They run as plain string
// matches against the source — fast, deterministic, and resilient to
// the lack of a Svelte component renderer in this project.

describe('Slider.svelte source contract', () => {
	it('imports the pure state helpers from slider-state', () => {
		expect(SLIDER_SOURCE).toContain("from './slider-state.js'");
		expect(SLIDER_SOURCE).toContain('applyKeyboardStep');
		expect(SLIDER_SOURCE).toContain('initialValue');
		expect(SLIDER_SOURCE).toContain('snapToStep');
	});

	it('declares the public Props shape from the spec', () => {
		// label, min, max are required; step/default/unit optional;
		// onSubmit is the response callback.
		expect(SLIDER_SOURCE).toMatch(/label:\s*string/);
		expect(SLIDER_SOURCE).toMatch(/min:\s*number/);
		expect(SLIDER_SOURCE).toMatch(/max:\s*number/);
		expect(SLIDER_SOURCE).toMatch(/step\?:\s*number/);
		expect(SLIDER_SOURCE).toMatch(/default\?:\s*number/);
		expect(SLIDER_SOURCE).toMatch(/unit\?:\s*string/);
		expect(SLIDER_SOURCE).toMatch(/onSubmit:\s*\(value:\s*number\)\s*=>\s*void/);
	});

	it('exposes the slider role with full ARIA value contract', () => {
		expect(SLIDER_SOURCE).toContain('role="slider"');
		expect(SLIDER_SOURCE).toContain('aria-valuemin={min}');
		expect(SLIDER_SOURCE).toContain('aria-valuemax={max}');
		expect(SLIDER_SOURCE).toContain('aria-valuenow={value}');
		expect(SLIDER_SOURCE).toContain('aria-valuetext={ariaText}');
		expect(SLIDER_SOURCE).toContain('aria-orientation="horizontal"');
	});

	it('makes the thumb keyboard-focusable when enabled', () => {
		// tabindex driven by disabled prop so the thumb takes focus.
		expect(SLIDER_SOURCE).toMatch(/tabindex=\{disabled\s*\?\s*-1\s*:\s*0\}/);
	});

	it('routes keydown through applyKeyboardStep', () => {
		expect(SLIDER_SOURCE).toContain('onkeydown={handleKeydown}');
		expect(SLIDER_SOURCE).toContain('applyKeyboardStep(event.key');
	});

	it('calls onSubmit on the submit button click and on Enter', () => {
		// Submit button onclick handler
		expect(SLIDER_SOURCE).toContain('onclick={handleSubmitClick}');
		expect(SLIDER_SOURCE).toContain('onSubmit(value)');
	});

	it('uses Quire design tokens (no hex literals in styles)', () => {
		// Extract <style> block(s) and assert no raw hex colors.
		const styleMatch = SLIDER_SOURCE.match(/<style>([\s\S]*?)<\/style>/);
		expect(styleMatch).not.toBeNull();
		const styleBlock = styleMatch?.[1] ?? '';
		// Forbid 3- or 6-digit hex colors. rgba() is allowed where it
		// references existing palette tokens via var(--*), but we don't
		// emit any rgba directly in this component.
		expect(styleBlock).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
	});

	it('respects prefers-reduced-motion', () => {
		expect(SLIDER_SOURCE).toContain('prefers-reduced-motion: reduce');
	});

	it('binds the track element and uses pointer events for drag', () => {
		expect(SLIDER_SOURCE).toContain('bind:this={trackEl}');
		expect(SLIDER_SOURCE).toContain('onpointerdown={handlePointerDown}');
		expect(SLIDER_SOURCE).toContain('onpointermove={handlePointerMove}');
		expect(SLIDER_SOURCE).toContain('onpointerup={handlePointerUp}');
	});
});
