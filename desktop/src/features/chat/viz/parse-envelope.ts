// Defensive parsing helpers for viz envelopes arriving
// through tool result content strings.
//
// Daemon-side `VizEnvelope` (src/tools/visualize/types.ts)
// is serialised as JSON inside `ToolResult.content`. These
// helpers parse that string into a frontend `VizEnvelope`
// without ever throwing, validating only the minimum required
// structural fields so malformed or malicious payloads are
// silently dropped (return null).

import type { VizEnvelope } from './types.js';

/**
 * Parse a tool result content string into a frontend `VizEnvelope`.
 *
 * Performs minimal structural validation:
 * - Input must be a non-empty string containing valid JSON.
 * - The parsed object must have `id` (string), `type` (string),
 *   `intent` (string), and `data` (non-null object).
 *
 * Returns `null` for any invalid input — never throws.
 */
export function parseVizEnvelope(
	content: string | undefined | null,
): VizEnvelope | null {
	if (!content) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return null;
	}

	if (parsed === null || typeof parsed !== 'object') return null;

	const obj = parsed as Record<string, unknown>;

	if (
		typeof obj.id !== 'string' ||
		typeof obj.type !== 'string' ||
		typeof obj.intent !== 'string' ||
		obj.data === null ||
		typeof obj.data !== 'object'
	) {
		return null;
	}

	return obj as unknown as VizEnvelope;
}

/**
 * Determine whether a tool call name corresponds to the `visualize` tool.
 *
 * This is the single canonical check for routing a tool call into the
 * viz renderer path instead of the generic `ToolCallCard`.
 */
export function isVizToolCall(toolCallName: string): boolean {
	return toolCallName === 'visualize';
}
