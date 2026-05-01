import { describe, it, expect } from 'bun:test';
import {
	applyModeKey,
	isSessionMode,
	resolveInitialMode,
	SESSION_MODES,
} from './mode-picker-state.js';

describe('SESSION_MODES', () => {
	it('exposes spec and quick in a stable order', () => {
		expect(SESSION_MODES).toEqual(['spec', 'quick']);
	});
});

describe('isSessionMode', () => {
	it('accepts the two valid modes', () => {
		expect(isSessionMode('spec')).toBe(true);
		expect(isSessionMode('quick')).toBe(true);
	});

	it('rejects everything else', () => {
		expect(isSessionMode('')).toBe(false);
		expect(isSessionMode('SPEC')).toBe(false);
		expect(isSessionMode('plan')).toBe(false);
		expect(isSessionMode(null)).toBe(false);
		expect(isSessionMode(undefined)).toBe(false);
		expect(isSessionMode(0)).toBe(false);
		expect(isSessionMode({ mode: 'spec' })).toBe(false);
	});
});

describe('resolveInitialMode', () => {
	it('returns the value when it is a valid mode', () => {
		expect(resolveInitialMode('spec')).toBe('spec');
		expect(resolveInitialMode('quick')).toBe('quick');
	});

	it('falls back to quick for any other input', () => {
		expect(resolveInitialMode('')).toBe('quick');
		expect(resolveInitialMode(undefined)).toBe('quick');
		expect(resolveInitialMode(null)).toBe('quick');
		expect(resolveInitialMode('PLAN')).toBe('quick');
	});
});

describe('applyModeKey — movement keys', () => {
	it('ArrowRight from spec moves to quick', () => {
		expect(applyModeKey('ArrowRight', 'spec')).toEqual({
			kind: 'move',
			mode: 'quick',
		});
	});

	it('ArrowDown from spec moves to quick', () => {
		expect(applyModeKey('ArrowDown', 'spec')).toEqual({
			kind: 'move',
			mode: 'quick',
		});
	});

	it('ArrowRight wraps from quick back to spec', () => {
		expect(applyModeKey('ArrowRight', 'quick')).toEqual({
			kind: 'move',
			mode: 'spec',
		});
	});

	it('ArrowLeft from quick moves to spec', () => {
		expect(applyModeKey('ArrowLeft', 'quick')).toEqual({
			kind: 'move',
			mode: 'spec',
		});
	});

	it('ArrowUp from quick moves to spec', () => {
		expect(applyModeKey('ArrowUp', 'quick')).toEqual({
			kind: 'move',
			mode: 'spec',
		});
	});

	it('ArrowLeft wraps from spec to quick', () => {
		expect(applyModeKey('ArrowLeft', 'spec')).toEqual({
			kind: 'move',
			mode: 'quick',
		});
	});

	it('Home jumps to the first mode', () => {
		expect(applyModeKey('Home', 'quick')).toEqual({
			kind: 'move',
			mode: 'spec',
		});
		expect(applyModeKey('Home', 'spec')).toEqual({
			kind: 'move',
			mode: 'spec',
		});
	});

	it('End jumps to the last mode', () => {
		expect(applyModeKey('End', 'spec')).toEqual({
			kind: 'move',
			mode: 'quick',
		});
		expect(applyModeKey('End', 'quick')).toEqual({
			kind: 'move',
			mode: 'quick',
		});
	});
});

describe('applyModeKey — selection keys', () => {
	it('Enter selects the currently focused mode', () => {
		expect(applyModeKey('Enter', 'spec')).toEqual({
			kind: 'select',
			mode: 'spec',
		});
		expect(applyModeKey('Enter', 'quick')).toEqual({
			kind: 'select',
			mode: 'quick',
		});
	});

	it('Space selects the currently focused mode', () => {
		expect(applyModeKey(' ', 'spec')).toEqual({
			kind: 'select',
			mode: 'spec',
		});
	});

	it('"Spacebar" (legacy key name) also selects', () => {
		expect(applyModeKey('Spacebar', 'quick')).toEqual({
			kind: 'select',
			mode: 'quick',
		});
	});
});

describe('applyModeKey — noop keys', () => {
	it('returns noop for Tab so it falls through to the browser', () => {
		expect(applyModeKey('Tab', 'spec')).toEqual({ kind: 'noop' });
	});

	it('returns noop for Escape so it can be handled by the dialog', () => {
		expect(applyModeKey('Escape', 'spec')).toEqual({ kind: 'noop' });
	});

	it('returns noop for printable characters', () => {
		expect(applyModeKey('a', 'spec')).toEqual({ kind: 'noop' });
		expect(applyModeKey('1', 'quick')).toEqual({ kind: 'noop' });
	});

	it('returns noop for unknown special keys', () => {
		expect(applyModeKey('Insert', 'spec')).toEqual({ kind: 'noop' });
		expect(applyModeKey('F1', 'quick')).toEqual({ kind: 'noop' });
	});
});
