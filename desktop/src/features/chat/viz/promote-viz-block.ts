// Pure helper for promoting a `visualize` tool call into a `viz` ContentBlock.
//
// Background: the daemon-side `visualize` tool runs over the existing
// tool_call/tool_result SSE channel (Wave 1 audit decision). The frontend
// receives a regular `tool_call` block whose `name === 'visualize'` and
// whose `result.content` carries the validated `VizEnvelope` as JSON.
//
// `StreamingMessage.svelte` and `AgentRunTranscript.svelte` route a
// viz-shaped tool call through `<VizRenderer>` instead of the generic
// `<ToolCallCard>`. This helper centralises the routing decision so the
// template specialization stays a thin one-liner and the logic is unit-
// testable without a Svelte renderer.
//
// Behaviour:
//   • For a non-`visualize` tool call: returns a `tool_call` ContentBlock
//     unchanged.
//   • For a `visualize` tool call WITH a result whose content parses as
//     a valid VizEnvelope: returns a `viz` ContentBlock.
//   • For a `visualize` tool call WITHOUT a result yet, OR with malformed
//     result content: falls back to a `tool_call` ContentBlock (so the
//     user still sees something — usually the running ToolCallCard
//     skeleton — until the result arrives or as a permanent fallback).
//
// Pure: never mutates input, never throws.

import type { ContentBlock, ToolCallDisplay } from '../types.js';
import { isVizToolCall, parseVizEnvelope } from './parse-envelope.js';

export function promoteVizBlock(toolCall: ToolCallDisplay): ContentBlock {
	if (isVizToolCall(toolCall.name) && toolCall.result?.content) {
		const envelope = parseVizEnvelope(toolCall.result.content);
		if (envelope) {
			return { type: 'viz', envelope };
		}
	}
	return { type: 'tool_call', toolCall };
}
