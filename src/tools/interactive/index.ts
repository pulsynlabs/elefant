/**
 * Interactive tools module.
 *
 * Exports a `createInteractiveTools(deps)` factory that returns all
 * interactive (user-input) tools.  Add new tool types (toggle, rating, etc.)
 * here — one new file plus one line in this factory is all it takes.
 */

import type { ToolDefinition } from '../../types/tools.js';
import { questionTool } from '../question/index.js';
import { createSliderTool, type SliderDeps } from './slider.js';

export type { SliderBrokerPayload, SliderSsePayload, SliderEmitter } from './types.js';
export type { SliderParams, SliderDeps } from './slider.js';
export { createSliderTool } from './slider.js';
export { sliderBroker } from './slider-broker.js';

// ---------------------------------------------------------------------------
// Registry factory
// ---------------------------------------------------------------------------

export function createInteractiveTools(
	deps: SliderDeps,
): ToolDefinition[] {
	return [
		questionTool,
		createSliderTool(deps),
	];
}
