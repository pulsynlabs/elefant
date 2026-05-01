// NewSessionDialog component contract tests.
//
// Source-level wiring assertions only — same pattern as
// ModePicker.svelte.test.ts. The actual DOM behaviour (Esc dismisses,
// Cancel calls onCancel, Submit calls onCreate with the selected mode)
// is exercised manually and via the integration in Sidebar.svelte.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';

const DIALOG_SOURCE = readFileSync(
	join(import.meta.dir, 'NewSessionDialog.svelte'),
	'utf8',
);

describe('NewSessionDialog.svelte source contract', () => {
	it('imports the ModePicker and SessionMode type', () => {
		expect(DIALOG_SOURCE).toContain("import ModePicker from './ModePicker.svelte'");
		expect(DIALOG_SOURCE).toContain(
			"import type { SessionMode } from './mode-picker-state.js'",
		);
	});

	it('declares the public Props shape', () => {
		expect(DIALOG_SOURCE).toMatch(/projectName:\s*string/);
		expect(DIALOG_SOURCE).toMatch(/defaultMode\?:\s*SessionMode/);
		expect(DIALOG_SOURCE).toMatch(/isCreating\?:\s*boolean/);
		expect(DIALOG_SOURCE).toMatch(
			/onCreate:\s*\(mode:\s*SessionMode\)\s*=>\s*void\s*\|\s*Promise<void>/,
		);
		expect(DIALOG_SOURCE).toMatch(/onCancel:\s*\(\)\s*=>\s*void/);
	});

	it('renders the ModePicker with onSelect bound to the local handler', () => {
		expect(DIALOG_SOURCE).toContain('<ModePicker');
		expect(DIALOG_SOURCE).toContain('{defaultMode}');
		expect(DIALOG_SOURCE).toContain('onSelect={handleSelect}');
	});

	it('uses the modal dialog ARIA contract', () => {
		expect(DIALOG_SOURCE).toContain('role="dialog"');
		expect(DIALOG_SOURCE).toContain('aria-modal="true"');
		expect(DIALOG_SOURCE).toContain('aria-labelledby="new-session-title"');
		expect(DIALOG_SOURCE).toContain('aria-describedby="new-session-description"');
	});

	it('dismisses on Escape', () => {
		// svelte:window keydown handler routes Escape → onCancel.
		expect(DIALOG_SOURCE).toContain('<svelte:window onkeydown={handleBackdropKeydown}');
		expect(DIALOG_SOURCE).toContain("event.key === 'Escape'");
	});

	it('dismisses on backdrop click but not when clicking inside the dialog', () => {
		expect(DIALOG_SOURCE).toContain('handleBackdropClick');
		expect(DIALOG_SOURCE).toContain('event.target === event.currentTarget');
	});

	it('routes Cancel to onCancel and disables it while creating', () => {
		expect(DIALOG_SOURCE).toContain('onclick={onCancel}');
		expect(DIALOG_SOURCE).toContain('disabled={isCreating}');
		expect(DIALOG_SOURCE).toContain('Cancel');
	});

	it('submits the form and calls onCreate with the selected mode', () => {
		expect(DIALOG_SOURCE).toContain('onsubmit={handleCreate}');
		expect(DIALOG_SOURCE).toContain('await onCreate(selectedMode)');
	});

	it('disables Create while isCreating is true and shows a busy label', () => {
		// The primary button should be disabled and aria-busy when creating.
		expect(DIALOG_SOURCE).toMatch(
			/aria-busy=\{isCreating\}[\s\S]*?Creating…[\s\S]*?Create Session/,
		);
	});

	it('focuses the Cancel button on mount so Enter never auto-creates', () => {
		// Initial-focus pattern lifted from DeleteProjectDialog.
		expect(DIALOG_SOURCE).toContain('bind:this={cancelButtonEl}');
		expect(DIALOG_SOURCE).toContain('cancelButtonEl?.focus()');
	});

	it('uses Quire design tokens (no hex literals in styles)', () => {
		const styleMatch = DIALOG_SOURCE.match(/<style>([\s\S]*?)<\/style>/);
		expect(styleMatch).not.toBeNull();
		const styleBlock = styleMatch?.[1] ?? '';
		expect(styleBlock).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
	});

	it('respects prefers-reduced-motion', () => {
		expect(DIALOG_SOURCE).toContain('prefers-reduced-motion: reduce');
	});

	it('seeds the dialog selection from defaultMode', () => {
		expect(DIALOG_SOURCE).toMatch(
			/let selectedMode = \$state<SessionMode>\(defaultMode\)/,
		);
	});

	it('has a default of "quick" so the dialog is usable when caller omits the prop', () => {
		// The Props default expression in the destructuring should be 'quick'.
		expect(DIALOG_SOURCE).toMatch(/defaultMode\s*=\s*'quick'/);
	});
});
