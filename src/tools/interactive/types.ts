/**
 * Shared types for interactive (user-input) tools.
 * Used by slider, question, and future input types (toggle, rating, etc.).
 */

/** Payload delivered to the SliderBroker when a user submits a slider value. */
export interface SliderBrokerPayload {
	value: number;
}

/** SSE event payload emitted by the slider tool to the frontend. */
export interface SliderSsePayload {
	sliderId: string;
	label: string;
	min: number;
	max: number;
	step?: number;
	default?: number;
	unit?: string;
	conversationId?: string;
}

/** Callback type for emitting slider SSE events. */
export type SliderEmitter = (payload: SliderSsePayload) => void;
