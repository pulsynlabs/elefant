import { describe, it, expect, beforeEach } from 'bun:test';
import {
	getMermaidThemeVars,
	_resetMermaidThemeCache,
	isMermaidError,
	mermaidErrorMessage,
} from './mermaid-state.js';

describe('getMermaidThemeVars', () => {
	beforeEach(() => _resetMermaidThemeCache());

	it('returns a fully-populated theme object with required keys', () => {
		// In bun (no DOM), the helper falls back to the constant defaults.
		const vars = getMermaidThemeVars();
		expect(vars).toHaveProperty('background');
		expect(vars).toHaveProperty('primaryColor');
		expect(vars).toHaveProperty('primaryTextColor');
		expect(vars).toHaveProperty('lineColor');
		expect(vars).toHaveProperty('secondaryColor');
		expect(vars).toHaveProperty('tertiaryColor');
		expect(vars).toHaveProperty('edgeLabelBackground');
		expect(vars).toHaveProperty('clusterBkg');
		expect(vars).toHaveProperty('titleColor');
		expect(vars).toHaveProperty('fontFamily');
	});

	it('every theme value is a non-empty string', () => {
		const vars = getMermaidThemeVars();
		for (const [, v] of Object.entries(vars)) {
			expect(typeof v).toBe('string');
			expect(v.length).toBeGreaterThan(0);
		}
	});

	it('memoizes the result across calls (same reference)', () => {
		const a = getMermaidThemeVars();
		const b = getMermaidThemeVars();
		expect(a).toBe(b);
	});

	it('cache reset returns a fresh object identity', () => {
		const a = getMermaidThemeVars();
		_resetMermaidThemeCache();
		const b = getMermaidThemeVars();
		expect(a).not.toBe(b);
		// But content should be equivalent given the same fallback path
		expect(a).toEqual(b);
	});

	it('uses fallback defaults when no DOM is available', () => {
		const vars = getMermaidThemeVars();
		// The dark fallback uses the Quire substrate colour
		expect(vars.background).toBe('#0a0a0e');
		expect(vars.primaryColor).toBe('#4049e1');
	});

	it('reads custom properties from a provided element when getComputedStyle is mocked', () => {
		// Simulate a DOM-style element by mocking getComputedStyle.
		const originalGCS = (globalThis as unknown as { getComputedStyle?: unknown })
			.getComputedStyle;
		const fakeStyles = {
			getPropertyValue: (name: string): string => {
				const map: Record<string, string> = {
					'--surface-substrate': '#000011',
					'--color-primary': '#0099ff',
					'--text-prose': '#ffffff',
					'--border-edge': 'rgba(0,0,0,0.5)',
					'--surface-plate': '#111122',
					'--surface-leaf': '#222233',
					'--font-sans': 'TestSans, sans-serif',
				};
				return map[name] ?? '';
			},
		};
		(globalThis as unknown as { getComputedStyle: (el: unknown) => unknown }).getComputedStyle =
			() => fakeStyles;

		_resetMermaidThemeCache();
		const fakeEl = {} as unknown as Element;
		const vars = getMermaidThemeVars(fakeEl);
		expect(vars.background).toBe('#000011');
		expect(vars.primaryColor).toBe('#0099ff');
		expect(vars.primaryTextColor).toBe('#ffffff');
		expect(vars.fontFamily).toBe('TestSans, sans-serif');

		// Restore
		if (originalGCS === undefined) {
			delete (globalThis as unknown as { getComputedStyle?: unknown }).getComputedStyle;
		} else {
			(globalThis as unknown as { getComputedStyle: unknown }).getComputedStyle =
				originalGCS;
		}
	});

	it('falls back when an individual token returns an empty string', () => {
		const originalGCS = (globalThis as unknown as { getComputedStyle?: unknown })
			.getComputedStyle;
		(globalThis as unknown as { getComputedStyle: (el: unknown) => unknown }).getComputedStyle =
			() => ({
				getPropertyValue: () => '   ', // whitespace-only → fallback
			});

		_resetMermaidThemeCache();
		const fakeEl = {} as unknown as Element;
		const vars = getMermaidThemeVars(fakeEl);
		expect(vars.background).toBe('#0a0a0e');
		expect(vars.fontFamily).toBe('system-ui, sans-serif');

		if (originalGCS === undefined) {
			delete (globalThis as unknown as { getComputedStyle?: unknown }).getComputedStyle;
		} else {
			(globalThis as unknown as { getComputedStyle: unknown }).getComputedStyle =
				originalGCS;
		}
	});
});

describe('isMermaidError', () => {
	it('returns true for Error instances', () => {
		expect(isMermaidError(new Error('boom'))).toBe(true);
	});

	it('returns true for string values', () => {
		expect(isMermaidError('parse error: unexpected token')).toBe(true);
	});

	it('returns true for empty strings (still string-typed)', () => {
		expect(isMermaidError('')).toBe(true);
	});

	it('returns false for null', () => {
		expect(isMermaidError(null)).toBe(false);
	});

	it('returns false for undefined', () => {
		expect(isMermaidError(undefined)).toBe(false);
	});

	it('returns false for numbers', () => {
		expect(isMermaidError(42)).toBe(false);
	});

	it('returns false for plain objects', () => {
		expect(isMermaidError({ message: 'x' })).toBe(false);
	});
});

describe('mermaidErrorMessage', () => {
	it('returns the Error message', () => {
		expect(mermaidErrorMessage(new Error('bad syntax'))).toBe('bad syntax');
	});

	it('returns string values verbatim', () => {
		expect(mermaidErrorMessage('parse error')).toBe('parse error');
	});

	it('returns the generic fallback for unknown shapes', () => {
		expect(mermaidErrorMessage(null)).toBe('Failed to render diagram');
		expect(mermaidErrorMessage(undefined)).toBe('Failed to render diagram');
		expect(mermaidErrorMessage(42)).toBe('Failed to render diagram');
		expect(mermaidErrorMessage({ msg: 'x' })).toBe('Failed to render diagram');
	});
});
