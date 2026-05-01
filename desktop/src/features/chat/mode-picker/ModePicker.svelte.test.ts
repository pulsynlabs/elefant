// ModePicker component contract tests.
//
// The desktop project does not ship @testing-library/svelte, so the
// runtime behaviour of the picker (keyboard, default selection,
// onSelect emission) is exercised through the pure helpers in
// ./mode-picker-state. The .svelte file is then verified at the
// source level for ARIA, prop wiring, and token usage — same pattern
// as Slider.svelte.test.ts and TaskToolCard.test.ts.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { applyModeKey, resolveInitialMode } from './mode-picker-state.js';

const MODE_PICKER_SOURCE = readFileSync(
	join(import.meta.dir, 'ModePicker.svelte'),
	'utf8',
);

// ---------------------------------------------------------------------------
// Pure-logic tests for the runtime behaviour
// ---------------------------------------------------------------------------

describe('ModePicker behaviour (via pure helpers)', () => {
	it('default selection is quick when no defaultMode supplied', () => {
		// The component prop default is `'quick'`; resolveInitialMode is
		// the safety net for when callers pass an unknown value.
		expect(resolveInitialMode(undefined)).toBe('quick');
	});

	it('default selection is the supplied mode when valid', () => {
		expect(resolveInitialMode('spec')).toBe('spec');
		expect(resolveInitialMode('quick')).toBe('quick');
	});

	it('Enter on a focused card emits select for that card', () => {
		expect(applyModeKey('Enter', 'spec')).toEqual({
			kind: 'select',
			mode: 'spec',
		});
		expect(applyModeKey('Enter', 'quick')).toEqual({
			kind: 'select',
			mode: 'quick',
		});
	});

	it('Space on a focused card emits select for that card', () => {
		expect(applyModeKey(' ', 'spec')).toEqual({
			kind: 'select',
			mode: 'spec',
		});
	});

	it('ArrowRight from the first card moves to the second', () => {
		expect(applyModeKey('ArrowRight', 'spec')).toEqual({
			kind: 'move',
			mode: 'quick',
		});
	});

	it('ArrowLeft from the second card moves to the first', () => {
		expect(applyModeKey('ArrowLeft', 'quick')).toEqual({
			kind: 'move',
			mode: 'spec',
		});
	});

	it('Tab is noop so it falls through to native focus order', () => {
		expect(applyModeKey('Tab', 'spec')).toEqual({ kind: 'noop' });
	});
});

// ---------------------------------------------------------------------------
// Source-level wiring assertions
// ---------------------------------------------------------------------------

describe('ModePicker.svelte source contract', () => {
	it('imports the pure state helpers from mode-picker-state', () => {
		expect(MODE_PICKER_SOURCE).toContain("from './mode-picker-state.js'");
		expect(MODE_PICKER_SOURCE).toContain('applyModeKey');
		expect(MODE_PICKER_SOURCE).toContain('resolveInitialMode');
	});

	it('declares the public Props shape from the spec', () => {
		// defaultMode is optional (defaults to 'quick'); onSelect is required.
		expect(MODE_PICKER_SOURCE).toMatch(/defaultMode\?:\s*SessionMode/);
		expect(MODE_PICKER_SOURCE).toMatch(
			/onSelect:\s*\(mode:\s*SessionMode\)\s*=>\s*void/,
		);
	});

	it('uses radiogroup as the outer container role', () => {
		expect(MODE_PICKER_SOURCE).toContain('role="radiogroup"');
		expect(MODE_PICKER_SOURCE).toContain('aria-labelledby={groupLabelId}');
	});

	it('exposes both cards as role="radio" with aria-checked', () => {
		// Strip comments before counting so the matcher is not confused
		// by inline references to role="radio" in source comments.
		const codeOnly = MODE_PICKER_SOURCE
			.replace(/<!--[\s\S]*?-->/g, '')
			.replace(/\/\/[^\n]*/g, '')
			.replace(/\/\*[\s\S]*?\*\//g, '');
		const radioMatches = codeOnly.match(/role="radio"(?!group)/g) ?? [];
		expect(radioMatches.length).toBe(2);

		// Each card binds aria-checked to the matching mode.
		expect(MODE_PICKER_SOURCE).toContain('aria-checked={selected === \'spec\'}');
		expect(MODE_PICKER_SOURCE).toContain('aria-checked={selected === \'quick\'}');
	});

	it('uses a roving tabindex (only the selected card is in the tab order)', () => {
		// Each card declares tabindex driven by its selection.
		expect(MODE_PICKER_SOURCE).toContain(
			"tabindex={selected === 'spec' ? 0 : -1}",
		);
		expect(MODE_PICKER_SOURCE).toContain(
			"tabindex={selected === 'quick' ? 0 : -1}",
		);
	});

	it('routes keydown events through applyModeKey for both cards', () => {
		// Each card has a keydown handler scoped to its own mode.
		expect(MODE_PICKER_SOURCE).toContain(
			"onkeydown={(event) => handleKeydown(event, 'spec')}",
		);
		expect(MODE_PICKER_SOURCE).toContain(
			"onkeydown={(event) => handleKeydown(event, 'quick')}",
		);
		expect(MODE_PICKER_SOURCE).toContain('applyModeKey(event.key, current)');
	});

	it('binds element refs so keyboard navigation can move focus', () => {
		expect(MODE_PICKER_SOURCE).toContain('bind:this={specEl}');
		expect(MODE_PICKER_SOURCE).toContain('bind:this={quickEl}');
		// Outcome handler explicitly focuses the destination.
		expect(MODE_PICKER_SOURCE).toContain('elementFor(outcome.mode)?.focus()');
	});

	it('renders the spec-mode title and description from the spec', () => {
		expect(MODE_PICKER_SOURCE).toContain('Spec Mode');
		expect(MODE_PICKER_SOURCE).toMatch(
			/Structured workflow with requirements, planning, and verification phases/,
		);
	});

	it('renders the quick-mode title and description from the spec', () => {
		expect(MODE_PICKER_SOURCE).toContain('Quick Mode');
		expect(MODE_PICKER_SOURCE).toMatch(
			/Free-form conversation — great for exploration and quick tasks/,
		);
	});

	it('uses Hugeicons for the mode icons', () => {
		expect(MODE_PICKER_SOURCE).toContain('SpecModeIcon');
		expect(MODE_PICKER_SOURCE).toContain('FlashIcon');
		expect(MODE_PICKER_SOURCE).toContain('HugeiconsIcon');
	});

	it('emits onSelect when a mode is chosen', () => {
		// The selectMode helper is the single funnel for both click and
		// keyboard activation.
		expect(MODE_PICKER_SOURCE).toContain('onSelect(mode)');
		expect(MODE_PICKER_SOURCE).toMatch(/onclick=\{\(\) => selectMode\('spec'\)\}/);
		expect(MODE_PICKER_SOURCE).toMatch(/onclick=\{\(\) => selectMode\('quick'\)\}/);
	});

	it('respects prefers-reduced-motion', () => {
		expect(MODE_PICKER_SOURCE).toContain('prefers-reduced-motion: reduce');
	});

	it('uses Quire design tokens (no hex literals in styles)', () => {
		const styleMatch = MODE_PICKER_SOURCE.match(/<style>([\s\S]*?)<\/style>/);
		expect(styleMatch).not.toBeNull();
		const styleBlock = styleMatch?.[1] ?? '';
		// Forbid 3- or 6-digit hex colors.
		expect(styleBlock).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
	});
});
