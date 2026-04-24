// Pure helpers for TaskToolCard display state.
//
// TaskToolCard.svelte is the chat-surface adapter that translates a
// `task` ToolCallDisplay into props for AgentTaskCard. For a `task`
// tool call the adapter needs three things:
//
//   1. A human-readable description (for AgentTaskCard's title).
//   2. An agent_type (for AgentTaskCard's icon / aria-label).
//   3. The spawned child runId (so clicking through navigates to the
//      child transcript).
//
// Resolution precedence for every field:
//
//   (a) Primary: daemon-supplied `toolCall.metadata` (patched in by
//       `chatStore.patchToolCallMetadata` when the
//       `tool_call_metadata` SSE event arrives at spawn time). This is
//       authoritative — the daemon knows the exact runId, title, and
//       agent type it just spawned, so no guessing is required.
//   (b) Fallback for description / agent_type: the tool-call
//       `arguments` the model emitted. Still useful because the
//       model-emitted text can surface *before* the metadata event on
//       a fast connection, and AgentTaskCard can start rendering with
//       it immediately.
//   (c) Fallback for runId: title-match against the agent-runs store.
//       Retained so older sessions replayed from history (no
//       metadata event in the replay stream) and slow-arrival
//       metadata both still resolve. Same pattern the
//       AgentRunTranscript's tier-2 fallback uses.
//
// Extracting these into a pure module keeps the Svelte component thin
// and lets us unit test every branch without a component renderer (the
// project has no @testing-library/svelte — see AgentTaskCard.test.ts
// and agent-task-card-state.ts for the same pattern).

import type { AgentRun } from '$lib/types/agent-run.js';
import type { ToolCallDisplay } from '../types.js';

/** Fallback used when neither metadata nor arguments carry an `agent_type`. */
export const DEFAULT_AGENT_TYPE = 'agent';

/**
 * Resolve the human-readable description for a `task` tool call.
 *
 * Precedence: tool-call arguments → daemon metadata → empty string.
 * Arguments are preferred so the card keeps rendering the exact text
 * the user sees in the transcript (the daemon metadata title is
 * derived from the same `description` argument, so the two match in
 * practice; preferring arguments also lets the card update reactively
 * while the model is still streaming JSON).
 */
export function extractTaskDescription(toolCall: ToolCallDisplay): string {
	const fromArgs = toolCall.arguments?.description;
	if (typeof fromArgs === 'string' && fromArgs) return fromArgs;
	const fromMeta = toolCall.metadata?.title;
	return typeof fromMeta === 'string' ? fromMeta : '';
}

/**
 * Resolve the agent type for a `task` tool call.
 *
 * Precedence: tool-call arguments → daemon metadata → `'agent'`.
 * Same rationale as `extractTaskDescription` — args-first keeps the
 * card's icon/aria-label reactive to the in-flight model stream.
 */
export function extractTaskAgentType(toolCall: ToolCallDisplay): string {
	const fromArgs = toolCall.arguments?.agent_type;
	if (typeof fromArgs === 'string' && fromArgs) return fromArgs;
	const fromMeta = toolCall.metadata?.agentType;
	return typeof fromMeta === 'string' && fromMeta
		? fromMeta
		: DEFAULT_AGENT_TYPE;
}

/**
 * Resolve the spawned child runId for a `task` tool call.
 *
 * Resolution precedence:
 *   (1) `toolCall.metadata.runId` — delivered by the daemon's
 *       `tool_call_metadata` SSE event at spawn time. This is the
 *       authoritative path: no scanning, no title collisions, and
 *       resolves the instant the event lands.
 *   (2) Title match — scan `runsById` for a run whose `title` equals
 *       the tool call's `description`. Kept as a fallback for:
 *         - Replayed / historical sessions where no metadata event
 *           is present in the saved stream.
 *         - Slow-arrival metadata where the agent-runs store is
 *           already hydrated (via project SSE) but the chat stream
 *           has not yet delivered the tool_call_metadata frame.
 *       First match wins (see existing trade-off — effectively
 *       unique descriptions in practice).
 *
 * Returns `null` until either source provides a runId.
 */
export function resolveTaskToolCardChildRunId(
	toolCall: ToolCallDisplay,
	runsById: Record<string, AgentRun>,
): string | null {
	// (1) Primary: daemon-supplied metadata.
	const fromMeta = toolCall.metadata?.runId;
	if (typeof fromMeta === 'string' && fromMeta) return fromMeta;

	// (2) Fallback: title-match against the agent-runs store.
	const description = extractTaskDescription(toolCall);
	if (!description) return null;
	for (const run of Object.values(runsById)) {
		if (run.title === description) return run.runId;
	}
	return null;
}
