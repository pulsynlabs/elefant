/**
 * Tests for the slider tool — schema validation, error cases, hook emission,
 * and broker round-trip.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { createSliderTool, type SliderParams } from './slider.js';
import { sliderBroker } from './slider-broker.js';
import type { ElefantError } from '../../types/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertError<T>(result: { ok: true; data: T } | { ok: false; error: ElefantError }): ElefantError {
	if (result.ok) throw new Error('Expected error but got success');
	return (result as { ok: false; error: ElefantError }).error;
}

function validParams(overrides: Partial<SliderParams> = {}): SliderParams {
	return {
		label: 'Size',
		min: 0,
		max: 100,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSliderTool', () => {
	let emittedPayloads: unknown[] = [];
	const testEmitter = (payload: unknown) => { emittedPayloads.push(payload); };

	afterEach(() => {
		sliderBroker.clearAll();
		emittedPayloads = [];
		delete process.env.ELEFANT_NON_INTERACTIVE;
	});

	// ── tool definition shape ──────────────────────────────────────────

	it('has the correct tool name', () => {
		const tool = createSliderTool({});
		expect(tool.name).toBe('slider');
	});

	it('has a non-empty description', () => {
		const tool = createSliderTool({});
		expect(tool.description.length).toBeGreaterThan(0);
	});

	it('declares all six parameters', () => {
		const tool = createSliderTool({});
		const keys = Object.keys(tool.parameters);
		expect(keys).toContain('label');
		expect(keys).toContain('min');
		expect(keys).toContain('max');
		expect(keys).toContain('step');
		expect(keys).toContain('default');
		expect(keys).toContain('unit');
	});

	it('marks required params correctly', () => {
		const tool = createSliderTool({});
		expect(tool.parameters.label.required).toBe(true);
		expect(tool.parameters.min.required).toBe(true);
		expect(tool.parameters.max.required).toBe(true);
		expect(tool.parameters.step.required).toBe(false);
		expect(tool.parameters.default.required).toBe(false);
		expect(tool.parameters.unit.required).toBe(false);
	});

	// ── validation errors ──────────────────────────────────────────────

	it('rejects when min >= max', async () => {
		const tool = createSliderTool({});
		const r = await tool.execute(validParams({ min: 10, max: 5 }));
		const err = assertError(r);
		expect(err.code).toBe('VALIDATION_ERROR');
		expect(err.message).toContain('must be less than max');
	});

	it('rejects when min equals max', async () => {
		const tool = createSliderTool({});
		const r = await tool.execute(validParams({ min: 50, max: 50 }));
		const err = assertError(r);
		expect(err.code).toBe('VALIDATION_ERROR');
	});

	it('rejects when step <= 0', async () => {
		const tool = createSliderTool({});
		const r = await tool.execute(validParams({ step: 0 }));
		const err = assertError(r);
		expect(err.code).toBe('VALIDATION_ERROR');
		expect(err.message).toContain('step must be greater than 0');
	});

	it('rejects when step is negative', async () => {
		const tool = createSliderTool({});
		const r = await tool.execute(validParams({ step: -5 }));
		const err = assertError(r);
		expect(err.code).toBe('VALIDATION_ERROR');
	});

	it('rejects when default < min', async () => {
		const tool = createSliderTool({});
		const r = await tool.execute(validParams({ min: 10, max: 100, default: 5 }));
		const err = assertError(r);
		expect(err.code).toBe('VALIDATION_ERROR');
		expect(err.message).toContain('must be between min');
	});

	it('rejects when default > max', async () => {
		const tool = createSliderTool({});
		const r = await tool.execute(validParams({ min: 0, max: 50, default: 75 }));
		const err = assertError(r);
		expect(err.code).toBe('VALIDATION_ERROR');
	});

	// ── non-interactive fallback ───────────────────────────────────────

	it('returns default value in non-interactive mode', async () => {
		process.env.ELEFANT_NON_INTERACTIVE = 'true';
		const tool = createSliderTool({});
		const r = await tool.execute(validParams({ default: 42 }));
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.data.value).toBe(42);
	});

	it('returns midpoint fallback in non-interactive mode when no default', async () => {
		process.env.ELEFANT_NON_INTERACTIVE = 'true';
		const tool = createSliderTool({});
		const r = await tool.execute(validParams({ min: 0, max: 100 }));
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.data.value).toBe(50);
	});

	// ── broker round-trip (happy path) ─────────────────────────────────

	it('resolves with user value via broker', async () => {
		const tool = createSliderTool({ sliderEmitter: testEmitter });
		const executePromise = tool.execute(validParams({ label: 'Volume', min: 0, max: 100 }));

		// Wait for broker registration
		await new Promise((r) => setTimeout(r, 50));

		// Verify emitter was called
		expect(emittedPayloads.length).toBe(1);
		const payload = emittedPayloads[0] as Record<string, unknown>;
		expect(payload.label).toBe('Volume');
		expect(payload.min).toBe(0);
		expect(payload.max).toBe(100);

		// Answer via broker
		const sliderId = payload.sliderId as string;
		sliderBroker.answer(sliderId, { value: 73 });

		const result = await executePromise;
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.data.value).toBe(73);
	});

	it('emits with _sliderEmitter override when present', async () => {
		const overridePayloads: unknown[] = [];
		const tool = createSliderTool({ sliderEmitter: testEmitter });
		const executePromise = tool.execute({
			...validParams({ label: 'Opacity' }),
			_sliderEmitter: (p) => overridePayloads.push(p),
		});

		await new Promise((r) => setTimeout(r, 50));

		// The _sliderEmitter should take priority over deps.sliderEmitter
		expect(overridePayloads.length).toBe(1);
		const payload = overridePayloads[0] as Record<string, unknown>;
		sliderBroker.answer(payload.sliderId as string, { value: 88 });

		const r = await executePromise;
		expect(r.ok).toBe(true);
	});

	it('uses injected tool call id as the slider broker id', async () => {
		const tool = createSliderTool({ sliderEmitter: testEmitter });
		const executePromise = tool.execute({
			...validParams({ label: 'Temperature' }),
			_toolCallId: 'tool-call-123',
		});

		await new Promise((r) => setTimeout(r, 50));

		const payload = emittedPayloads[0] as Record<string, unknown>;
		expect(payload.sliderId).toBe('tool-call-123');
		sliderBroker.answer('tool-call-123', { value: 64 });

		const r = await executePromise;
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.data.value).toBe(64);
	});

	// ── timeout ────────────────────────────────────────────────────────

	it('rejects on broker timeout', async () => {
		const tool = createSliderTool({ sliderEmitter: testEmitter });
		// Use a very short timeout by answering nothing; the default broker
		// timeout is 60s which is too long for a test. We test broker
		// timeout separately.
		//
		// The slider tool uses the singleton broker with 60s timeout.
		// Test the broker timeout directly instead.
		const p = sliderBroker.register('timeout-test', 100);

		try {
			await p;
			throw new Error('Expected timeout');
		} catch (error) {
			expect(error instanceof Error).toBe(true);
			expect((error as Error).message).toContain('timed out');
		}
	});
});
