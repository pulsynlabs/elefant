// MessageInput integration tests.
//
// The project does not depend on @testing-library/svelte (see desktop/package.json),
// so we cannot mount the .svelte component directly. Instead, this suite simulates
// the integration logic by exercising the exact pure helpers MessageInput.svelte
// invokes, plus the keyboard precedence rules around the overlay.
//
// What is tested here:
//   - Open conditions: leading `/`, hyphenated triggers, IME composition guard.
//   - Close conditions: leading `/` removed, space appended, selection committed.
//   - Selection: applySelection produces a value that closes the overlay.
//   - Enter precedence: when overlay is open + items match, the overlay
//     consumes the keystroke; when overlay is open with no matches,
//     submit must NOT fire; when closed, submit fires normally.
//
// The Svelte component's keyboard handler is the small piece of logic that
// sits on top of these primitives — its behaviour is fully determined by
// the booleans computed below.

import { describe, it, expect, beforeEach } from 'bun:test';
import {
	shouldOpenOverlay,
	extractQuery,
	applySelection,
} from './command-completions/input-state.js';
import {
	rankCommands,
	type Command,
} from './command-completions/fuzzy.js';
import { _seedCommandsForTest, resetCommandsStore } from '$lib/stores/commands.svelte.js';

const COMMANDS: Command[] = [
	{ trigger: '/discuss', description: 'Start discovery interview.' },
	{ trigger: '/plan', description: 'Plan something.' },
	{ trigger: '/execute', description: 'Execute waves.' },
	{ trigger: '/help', description: 'List commands.' },
	{ trigger: '/map-codebase', description: 'Map the codebase.' },
];

beforeEach(() => {
	resetCommandsStore();
	_seedCommandsForTest(COMMANDS);
});

describe('MessageInput overlay integration', () => {
	describe('open conditions', () => {
		it('opens the overlay when the user types `/`', () => {
			expect(shouldOpenOverlay('/', false)).toBe(true);
		});

		it('keeps the overlay open while the user narrows the query', () => {
			expect(shouldOpenOverlay('/d', false)).toBe(true);
			expect(shouldOpenOverlay('/dis', false)).toBe(true);
			expect(shouldOpenOverlay('/discuss', false)).toBe(true);
		});

		it('keeps the overlay open for hyphenated triggers', () => {
			expect(shouldOpenOverlay('/map-co', false)).toBe(true);
			expect(shouldOpenOverlay('/map-codebase', false)).toBe(true);
		});

		it('does NOT open during IME composition', () => {
			expect(shouldOpenOverlay('/dis', true)).toBe(false);
		});
	});

	describe('close conditions', () => {
		it('closes when the user removes the leading `/`', () => {
			expect(shouldOpenOverlay('', false)).toBe(false);
			expect(shouldOpenOverlay('hello', false)).toBe(false);
		});

		it('closes when a space is added (multi-token input)', () => {
			expect(shouldOpenOverlay('/discuss ', false)).toBe(false);
			expect(shouldOpenOverlay('/discuss now', false)).toBe(false);
		});

		it('closes after a selection is applied (trailing space breaks the pattern)', () => {
			const next = applySelection('/discuss');
			expect(shouldOpenOverlay(next, false)).toBe(false);
		});
	});

	describe('query narrowing', () => {
		it('narrows the result list as the user types', () => {
			let value = '/';
			expect(rankCommands(COMMANDS, extractQuery(value)).length).toBe(COMMANDS.length);

			value = '/d';
			const dResults = rankCommands(COMMANDS, extractQuery(value));
			expect(dResults.length).toBeGreaterThan(0);
			expect(dResults.length).toBeLessThan(COMMANDS.length);

			value = '/dis';
			const disResults = rankCommands(COMMANDS, extractQuery(value));
			expect(disResults.length).toBe(1);
			expect(disResults[0]?.command.trigger).toBe('/discuss');
		});

		it('narrows to zero matches for a query with no results', () => {
			const ranked = rankCommands(COMMANDS, 'zzqq');
			expect(ranked.length).toBe(0);
		});
	});

	describe('Enter precedence with overlay state', () => {
		// The MessageInput keyboard handler follows this contract:
		//
		//   if (overlayOpen && completions.handleKeydown(event) === true) preventDefault
		//   else if (overlayOpen && Enter) preventDefault  (no submit)
		//   else if (Enter && !shift) handleSend()
		//
		// We model the same decision tree here using only the pure helpers,
		// which is what the component routes through.

		function decide(args: {
			value: string;
			isComposing: boolean;
			key: string;
			shiftKey: boolean;
			hasResults: boolean;
		}): 'overlay-consumes' | 'suppress-submit' | 'submit' | 'pass-through' {
			const overlayOpen = shouldOpenOverlay(args.value, args.isComposing);

			if (overlayOpen) {
				if (
					args.key === 'ArrowDown' ||
					args.key === 'ArrowUp' ||
					args.key === 'Tab' ||
					args.key === 'Escape'
				) {
					return 'overlay-consumes';
				}
				if (args.key === 'Enter' && !args.shiftKey) {
					return args.hasResults ? 'overlay-consumes' : 'suppress-submit';
				}
			}

			if (args.key === 'Enter' && !args.shiftKey) return 'submit';
			return 'pass-through';
		}

		it('overlay open + matches + Enter → overlay consumes (no submit)', () => {
			const decision = decide({
				value: '/dis',
				isComposing: false,
				key: 'Enter',
				shiftKey: false,
				hasResults: true,
			});
			expect(decision).toBe('overlay-consumes');
		});

		it('overlay open + NO matches + Enter → suppress submit, do not send', () => {
			const decision = decide({
				value: '/zzqq',
				isComposing: false,
				key: 'Enter',
				shiftKey: false,
				hasResults: false,
			});
			expect(decision).toBe('suppress-submit');
		});

		it('overlay closed + Enter → submit fires normally', () => {
			const decision = decide({
				value: 'hello world',
				isComposing: false,
				key: 'Enter',
				shiftKey: false,
				hasResults: false,
			});
			expect(decision).toBe('submit');
		});

		it('Shift+Enter is always pass-through (newline)', () => {
			const decisionWithOverlay = decide({
				value: '/dis',
				isComposing: false,
				key: 'Enter',
				shiftKey: true,
				hasResults: true,
			});
			const decisionNoOverlay = decide({
				value: 'hi',
				isComposing: false,
				key: 'Enter',
				shiftKey: true,
				hasResults: false,
			});
			expect(decisionWithOverlay).toBe('pass-through');
			expect(decisionNoOverlay).toBe('pass-through');
		});

		it('overlay open + Escape → overlay consumes (dismiss)', () => {
			const decision = decide({
				value: '/dis',
				isComposing: false,
				key: 'Escape',
				shiftKey: false,
				hasResults: true,
			});
			expect(decision).toBe('overlay-consumes');
		});

		it('overlay open + ArrowDown → overlay consumes', () => {
			const decision = decide({
				value: '/',
				isComposing: false,
				key: 'ArrowDown',
				shiftKey: false,
				hasResults: true,
			});
			expect(decision).toBe('overlay-consumes');
		});

		it('IME composition + Enter while value starts with `/` → still submits (overlay closed)', () => {
			// During composition the overlay must be closed, so Enter falls
			// through to the submit path. In practice the textarea also
			// suppresses Enter during composition via event.isComposing,
			// but our state machine treats it as a regular submit.
			const decision = decide({
				value: '/dis',
				isComposing: true,
				key: 'Enter',
				shiftKey: false,
				hasResults: true,
			});
			expect(decision).toBe('submit');
		});
	});

	describe('selection wiring', () => {
		it('applySelection produces a value that closes the overlay', () => {
			const ranked = rankCommands(COMMANDS, 'dis');
			const top = ranked[0];
			expect(top).toBeDefined();
			const nextValue = applySelection(top!.command.trigger);
			expect(nextValue).toBe('/discuss ');
			expect(shouldOpenOverlay(nextValue, false)).toBe(false);
		});

		it('applySelection preserves hyphenated triggers', () => {
			const next = applySelection('/map-codebase');
			expect(next).toBe('/map-codebase ');
			expect(shouldOpenOverlay(next, false)).toBe(false);
		});
	});
});
