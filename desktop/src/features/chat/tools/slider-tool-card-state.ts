/**
 * Pure state helpers for SliderToolCard.
 *
 * Mirrors the `task-tool-card-state` / `agent-task-card-state` pattern:
 * Svelte component testing is awkward here (no Testing Library), so the
 * component delegates parsing and state-machine logic to this module
 * which is unit-tested directly.
 */

import type { ToolCallDisplay } from '../types.js';

/**
 * Shape of the slider tool's arguments as the daemon emits them.
 * `step`, `default`, and `unit` are optional per the tool schema.
 */
export interface SliderToolArgs {
	label: string;
	min: number;
	max: number;
	step?: number;
	default?: number;
	unit?: string;
}

/**
 * Status of the slider interaction, mirroring `QuestionToolCard`'s state
 * machine for visual consistency in the transcript.
 *
 * - `pending`     — slider rendered, waiting for user input
 * - `submitting`  — user clicked submit; HTTP request in-flight
 * - `submitted`   — server accepted the value (or tool result arrived)
 * - `error`       — submission failed (network or 4xx/5xx)
 */
export type SliderAnswerState = 'pending' | 'submitting' | 'submitted' | 'error';

/**
 * Map our local slider state to the generic `ToolCardShell` status so
 * the visual treatment (running / success / error) stays consistent
 * with every other tool card.
 *
 * If a `tool_result` already exists on the toolCall (eg. it arrived via
 * SSE before the user interacted, or this is a historical replay) the
 * shell renders the success/error from that result regardless of local
 * state.
 */
export function deriveDisplayStatus(
	answerState: SliderAnswerState,
	hasResult: boolean,
	resultIsError: boolean,
): 'running' | 'success' | 'error' {
	if (answerState === 'error') return 'error';
	if (hasResult) return resultIsError ? 'error' : 'success';
	if (answerState === 'submitted') return 'success';
	// Both `pending` and `submitting` show as running because the model
	// is still blocked waiting on the user's response.
	return 'running';
}

/**
 * Parse and validate the slider tool call arguments.
 *
 * Returns either the typed args object or a string describing why
 * parsing failed (component renders the error path). We are deliberately
 * conservative: type-checks every field rather than trusting the wire
 * shape, because the daemon emits this through SSE and any mismatch
 * would otherwise crash the renderer.
 */
export function parseSliderArgs(
	args: Record<string, unknown> | undefined,
): { ok: true; value: SliderToolArgs } | { ok: false; error: string } {
	if (!args || typeof args !== 'object') {
		return { ok: false, error: 'slider tool call missing arguments' };
	}
	if (typeof args.label !== 'string' || args.label.length === 0) {
		return { ok: false, error: 'slider tool call missing "label"' };
	}
	if (typeof args.min !== 'number' || !Number.isFinite(args.min)) {
		return { ok: false, error: 'slider tool call missing numeric "min"' };
	}
	if (typeof args.max !== 'number' || !Number.isFinite(args.max)) {
		return { ok: false, error: 'slider tool call missing numeric "max"' };
	}
	if (args.min >= args.max) {
		return {
			ok: false,
			error: `slider tool call: min (${args.min}) must be less than max (${args.max})`,
		};
	}

	const step = typeof args.step === 'number' && Number.isFinite(args.step)
		? args.step
		: undefined;
	const defaultValue = typeof args.default === 'number' && Number.isFinite(args.default)
		? args.default
		: undefined;
	const unit = typeof args.unit === 'string' && args.unit.length > 0
		? args.unit
		: undefined;

	return {
		ok: true,
		value: {
			label: args.label,
			min: args.min,
			max: args.max,
			step,
			default: defaultValue,
			unit,
		},
	};
}

/**
 * Build the envelope sent to the daemon when the user submits a value.
 *
 * Centralised so the SSE/tests can assert the exact shape sent on the
 * wire. The HTTP route side is verified separately by the daemon
 * tests; this only fixes the contract from the desktop's POV.
 */
export interface SliderSubmitEnvelope {
	sliderId: string;
	value: number;
}

export function buildSubmitEnvelope(
	toolCall: ToolCallDisplay,
	value: number,
): SliderSubmitEnvelope {
	return {
		sliderId: toolCall.id,
		value,
	};
}
