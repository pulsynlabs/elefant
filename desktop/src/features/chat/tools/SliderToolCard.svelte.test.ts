// SliderToolCard tests.
//
// As with TaskToolCard, runtime logic lives in `slider-tool-card-state.ts`
// because the project ships no Svelte component renderer. The pure
// helpers are unit-tested here, and component-side wiring (which call
// it makes on submit, what ARIA props it threads to <Slider>, which
// state path it renders) is asserted via readFileSync.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import type { ToolCallDisplay } from '../types.js';
import {
	buildSubmitEnvelope,
	deriveDisplayStatus,
	parseSliderArgs,
} from './slider-tool-card-state.js';

const SLIDER_TOOL_CARD_SOURCE = readFileSync(
	join(import.meta.dir, 'SliderToolCard.svelte'),
	'utf8',
);

const REGISTRY_SOURCE = readFileSync(
	join(import.meta.dir, 'registry.ts'),
	'utf8',
);

const makeToolCall = (overrides: Partial<ToolCallDisplay> = {}): ToolCallDisplay => ({
	id: 'slider-1',
	name: 'slider',
	arguments: {
		label: 'Choose intensity',
		min: 0,
		max: 100,
		step: 5,
		default: 25,
		unit: '%',
	},
	...overrides,
});

// ─── parseSliderArgs ─────────────────────────────────────────────────────────

describe('parseSliderArgs', () => {
	it('parses a fully-populated tool call', () => {
		const result = parseSliderArgs({
			label: 'Speed',
			min: 0,
			max: 100,
			step: 1,
			default: 50,
			unit: 'mph',
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({
				label: 'Speed',
				min: 0,
				max: 100,
				step: 1,
				default: 50,
				unit: 'mph',
			});
		}
	});

	it('parses a minimal tool call (only required fields)', () => {
		const result = parseSliderArgs({ label: 'Volume', min: 0, max: 11 });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.label).toBe('Volume');
			expect(result.value.min).toBe(0);
			expect(result.value.max).toBe(11);
			expect(result.value.step).toBeUndefined();
			expect(result.value.default).toBeUndefined();
			expect(result.value.unit).toBeUndefined();
		}
	});

	it('rejects missing arguments object', () => {
		const result = parseSliderArgs(undefined);
		expect(result.ok).toBe(false);
	});

	it('rejects missing or empty label', () => {
		expect(parseSliderArgs({ min: 0, max: 1 }).ok).toBe(false);
		expect(parseSliderArgs({ label: '', min: 0, max: 1 }).ok).toBe(false);
	});

	it('rejects non-numeric or NaN min/max', () => {
		expect(parseSliderArgs({ label: 'x', min: 'a', max: 1 }).ok).toBe(false);
		expect(parseSliderArgs({ label: 'x', min: 0, max: NaN }).ok).toBe(false);
		expect(parseSliderArgs({ label: 'x', min: 0, max: Infinity }).ok).toBe(false);
	});

	it('rejects min >= max', () => {
		expect(parseSliderArgs({ label: 'x', min: 5, max: 5 }).ok).toBe(false);
		expect(parseSliderArgs({ label: 'x', min: 10, max: 5 }).ok).toBe(false);
	});

	it('drops invalid optional fields rather than failing', () => {
		// Non-numeric step / default → omit but keep parse successful.
		const result = parseSliderArgs({
			label: 'x',
			min: 0,
			max: 10,
			step: 'no',
			default: NaN,
			unit: 42,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.step).toBeUndefined();
			expect(result.value.default).toBeUndefined();
			expect(result.value.unit).toBeUndefined();
		}
	});
});

// ─── deriveDisplayStatus ──────────────────────────────────────────────────────

describe('deriveDisplayStatus', () => {
	it('shows running while pending and no result', () => {
		expect(deriveDisplayStatus('pending', false, false)).toBe('running');
	});

	it('shows running while submitting and no result', () => {
		expect(deriveDisplayStatus('submitting', false, false)).toBe('running');
	});

	it('shows success after local submitted', () => {
		expect(deriveDisplayStatus('submitted', false, false)).toBe('success');
	});

	it('shows error when local state is error', () => {
		expect(deriveDisplayStatus('error', false, false)).toBe('error');
	});

	it('prefers tool result success when present and pending locally', () => {
		expect(deriveDisplayStatus('pending', true, false)).toBe('success');
	});

	it('prefers tool result error when present', () => {
		expect(deriveDisplayStatus('pending', true, true)).toBe('error');
	});
});

// ─── buildSubmitEnvelope ──────────────────────────────────────────────────────

describe('buildSubmitEnvelope', () => {
	it('uses toolCall.id as the sliderId', () => {
		const tc = makeToolCall({ id: 'abc-123' });
		expect(buildSubmitEnvelope(tc, 42)).toEqual({ sliderId: 'abc-123', value: 42 });
	});

	it('passes the value through verbatim (caller is responsible for clamp/snap)', () => {
		const tc = makeToolCall();
		expect(buildSubmitEnvelope(tc, 17.5).value).toBe(17.5);
	});
});

// ─── Source-level wiring assertions ──────────────────────────────────────────

describe('SliderToolCard.svelte source contract', () => {
	it('renders inside the shared ToolCardShell', () => {
		expect(SLIDER_TOOL_CARD_SOURCE).toContain('ToolCardShell');
		expect(SLIDER_TOOL_CARD_SOURCE).toContain('toolName="slider"');
	});

	it('renders the Slider component from the ui barrel', () => {
		// Imports the Slider via the ui/slider barrel; passes through the
		// six props from the parsed tool call.
		expect(SLIDER_TOOL_CARD_SOURCE).toContain("from '$lib/components/ui/slider");
		expect(SLIDER_TOOL_CARD_SOURCE).toContain('<Slider');
		expect(SLIDER_TOOL_CARD_SOURCE).toContain('label={parsed.value.label}');
		expect(SLIDER_TOOL_CARD_SOURCE).toContain('min={parsed.value.min}');
		expect(SLIDER_TOOL_CARD_SOURCE).toContain('max={parsed.value.max}');
		expect(SLIDER_TOOL_CARD_SOURCE).toContain('step={parsed.value.step}');
		expect(SLIDER_TOOL_CARD_SOURCE).toContain('default={parsed.value.default}');
		expect(SLIDER_TOOL_CARD_SOURCE).toContain('unit={parsed.value.unit}');
		expect(SLIDER_TOOL_CARD_SOURCE).toContain('onSubmit={handleSubmit}');
	});

	it('parses arguments through the pure helper', () => {
		expect(SLIDER_TOOL_CARD_SOURCE).toContain('parseSliderArgs(toolCall.arguments)');
	});

	it('builds the submit envelope through the pure helper', () => {
		expect(SLIDER_TOOL_CARD_SOURCE).toContain('buildSubmitEnvelope(toolCall, value)');
	});

	it('dispatches the submit through DaemonClient.answerSlider', () => {
		// Visual behaviour: the user clicks Submit (or hits Enter) → the
		// component calls daemonClient.answerSlider with the envelope's
		// sliderId + value. This contract is asserted at the source level
		// so a refactor that drops the daemon call fails the test.
		expect(SLIDER_TOOL_CARD_SOURCE).toContain('client.answerSlider(envelope.sliderId, envelope.value)');
	});

	it('handles error result by surfacing message + retry path', () => {
		expect(SLIDER_TOOL_CARD_SOURCE).toContain("answerState = 'error'");
		expect(SLIDER_TOOL_CARD_SOURCE).toContain('handleRetry');
	});

	it('respects an inbound tool result (historical replay)', () => {
		// $effect updates state when toolResult lands.
		expect(SLIDER_TOOL_CARD_SOURCE).toContain('$effect');
		expect(SLIDER_TOOL_CARD_SOURCE).toContain('toolResult');
	});

	it('uses Quire design tokens (no hex literals in <style>)', () => {
		const styleMatch = SLIDER_TOOL_CARD_SOURCE.match(/<style>([\s\S]*?)<\/style>/);
		expect(styleMatch).not.toBeNull();
		const styleBlock = styleMatch?.[1] ?? '';
		expect(styleBlock).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
	});
});

describe('tools/registry.ts wiring', () => {
	it('registers SliderToolCard for the "slider" tool name', () => {
		expect(REGISTRY_SOURCE).toContain('SliderToolCard');
		expect(REGISTRY_SOURCE).toMatch(/slider:\s*SliderToolCard/);
	});

	it('imports SliderToolCard from the local module', () => {
		expect(REGISTRY_SOURCE).toContain("from './SliderToolCard.svelte'");
	});
});
