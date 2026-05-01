/**
 * Slider tool — numeric input via a rendered slider component.
 * The model calls slider() with min/max/label, the desktop renders a Slider
 * Svelte component, the user adjusts and submits, and the value flows back
 * through the same broker + emitter transport as the question tool.
 */

import type { ToolDefinition } from '../../types/tools.js';
import type { ElefantError } from '../../types/errors.js';
import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';
import { sliderBroker } from './slider-broker.js';
import type { SliderEmitter } from './types.js';

// ---------------------------------------------------------------------------
// Parameter contracts
// ---------------------------------------------------------------------------

export interface SliderParams {
	label: string;
	min: number;
	max: number;
	step?: number;
	default?: number;
	unit?: string;
	/** Transport correlation id — injected by the agent loop (not exposed in schema). */
	_toolCallId?: string;
	/** Transport hook — injected by the agent loop (not exposed in schema). */
	_sliderEmitter?: SliderEmitter;
}

export interface SliderDeps {
	sliderEmitter?: SliderEmitter;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSliderTool(deps: SliderDeps): ToolDefinition<SliderParams, { value: number }> {
	return {
		name: 'slider',
		description:
			'Present a slider to the user to collect a numeric value. The user adjusts the slider and submits a value, which is returned. Useful for numeric parameters the model wants the user to set visually.',
		parameters: {
			label: {
				type: 'string',
				description: 'Label text displayed above the slider',
				required: true,
			},
			min: {
				type: 'number',
				description: 'Minimum allowed value',
				required: true,
			},
			max: {
				type: 'number',
				description: 'Maximum allowed value',
				required: true,
			},
			step: {
				type: 'number',
				description: 'Step increment between values (must be > 0)',
				required: false,
			},
			default: {
				type: 'number',
				description: 'Default/initial value (must be between min and max)',
				required: false,
			},
			unit: {
				type: 'string',
				description: 'Optional unit suffix displayed next to the value (e.g. "px", "%", "ms")',
				required: false,
			},
		},
		execute: async (params): Promise<Result<{ value: number }, ElefantError>> => {
			// ─── validation ──────────────────────────────────────────────
			if (params.min >= params.max) {
				return err({
					code: 'VALIDATION_ERROR',
					message: `min (${params.min}) must be less than max (${params.max})`,
				});
			}

			if (params.step !== undefined && params.step <= 0) {
				return err({
					code: 'VALIDATION_ERROR',
					message: `step must be greater than 0, got ${params.step}`,
				});
			}

			if (params.default !== undefined) {
				if (params.default < params.min || params.default > params.max) {
					return err({
						code: 'VALIDATION_ERROR',
						message: `default (${params.default}) must be between min (${params.min}) and max (${params.max})`,
					});
				}
			}

			// ─── non-interactive guard ──────────────────────────────────
			if (process.env.ELEFANT_NON_INTERACTIVE === 'true') {
				// fallback: return the default or the midpoint
				const fallback = params.default ?? params.min + (params.max - params.min) / 2;
				return ok({ value: fallback });
			}

			// ─── register with broker + emit to frontend ────────────────
			const sliderId = typeof params._toolCallId === 'string' && params._toolCallId.length > 0
				? params._toolCallId
				: crypto.randomUUID();
			const emitter = params._sliderEmitter ?? deps.sliderEmitter;

			const answerPromise = sliderBroker.register(sliderId, 60_000);

			emitter?.({
				sliderId,
				label: params.label,
				min: params.min,
				max: params.max,
				step: params.step,
				default: params.default,
				unit: params.unit,
				conversationId: undefined, // set by agent loop via _sliderEmitter wrapper
			});

			try {
				const answer = await answerPromise;
				return ok({ value: answer.value });
			} catch (error) {
				return err({
					code: 'TOOL_EXECUTION_FAILED',
					message: error instanceof Error ? error.message : 'Slider timed out after 60s',
				});
			}
		},
	};
}
