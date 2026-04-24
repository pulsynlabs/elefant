// Pure helpers for hydrating an AgentRunTranscript from persisted history.
//
// Extracted from AgentRunTranscript.svelte so the conversion + merge
// logic can be unit-tested without a component renderer (the project
// has no @testing-library/svelte). Same pattern as
// agent-run-transcript-blocks.ts and child-run-view-state.ts.
//
// Two stages:
//
//   1. mapApiMessagesToEntries — convert daemon-persisted
//      `agent_run_messages` rows into the same `AgentRunTranscriptEntry`
//      shape the live SSE pipeline produces, so the existing
//      `computeRenderBlocks` dispatcher renders them identically.
//
//   2. mergeHistoricalAndLive — splice live entries that arrived AFTER
//      the historical fetch resolved onto the end of the historical
//      list. Uses an index snapshot (not seq comparison) because the
//      historical seq counter (per persisted row) and the live SSE seq
//      counter (per emitted event) advance at different rates inside
//      the daemon and are not directly comparable.

import type {
	AgentRunTranscriptEntry,
	AgentRunStatus,
} from '$lib/types/agent-run.js';

/**
 * Shape of a single row returned by
 * `GET /api/projects/:projectId/runs/:runId/messages`.
 *
 * Mirrors the daemon's `AgentRunMessage` (src/runs/messages.ts). Defined
 * locally to avoid a cross-package dependency until the Eden Treaty
 * client is wired (see daemon/client.ts comment).
 */
export interface AgentRunMessage {
	id: number;
	run_id: string;
	seq: number;
	role: 'system' | 'user' | 'assistant' | 'tool_call' | 'tool_result';
	content: string;
	tool_name: string | null;
	created_at: string;
}

/**
 * Successful body shape from the messages endpoint.
 *
 * The daemon wraps everything in `DaemonResult<T>`; the wrapped data is
 * `{ messages }`. See src/runs/routes.ts.
 */
export interface AgentRunMessagesResponse {
	messages: AgentRunMessage[];
}

interface ParsedToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

/**
 * Parse the JSON body of a persisted `tool_call` message back into
 * `{ id, name, arguments }`. Tolerates malformed rows by returning null
 * — a corrupt row is dropped rather than poisoning the whole transcript.
 */
function parseToolCallContent(content: string): ParsedToolCall | null {
	try {
		const value = JSON.parse(content) as unknown;
		if (!value || typeof value !== 'object') return null;
		const v = value as Record<string, unknown>;
		const id = typeof v.id === 'string' ? v.id : '';
		const name = typeof v.name === 'string' ? v.name : '';
		if (!id || !name) return null;
		const args =
			typeof v.arguments === 'object' && v.arguments !== null
				? (v.arguments as Record<string, unknown>)
				: {};
		return { id, name, arguments: args };
	} catch {
		return null;
	}
}

/**
 * Convert persisted DB messages into transcript entries that match the
 * shape the live SSE pipeline appends to `agentRunsStore.transcripts`.
 *
 * Mapping rules (intentionally narrow — anything we can't faithfully
 * reconstruct is dropped rather than fabricated):
 *
 *   • `system` and `user` rows are skipped. The live transcript also
 *     omits these — they are the delegation prelude (`<delegation_context>`
 *     and the user prompt) injected by the task tool, not output the
 *     child agent emitted.
 *
 *   • `assistant` rows render as a single `token` entry carrying the
 *     full text. computeRenderBlocks coalesces consecutive tokens into
 *     one streaming-message block, so a single token-per-row is
 *     equivalent to the live flush-on-tool-call behavior.
 *
 *   • `tool_call` rows carry a JSON-stringified `{ id, name, arguments }`
 *     in `content` (see src/tools/task/index.ts persistMessage path).
 *     We parse it back to recover the real `id` so subsequent
 *     `tool_result` rows can pair correctly via toolCallId.
 *
 *   • `tool_result` rows persist only `tool_name` + content (no
 *     toolCallId column on the table). We pair each result with the
 *     most-recent unmatched `tool_call` of the same `tool_name` —
 *     monotonic seq order from the DAL guarantees temporal ordering.
 *     If no match is found (orphan result), we synthesize a
 *     placeholder toolCallId so the renderer still has something stable.
 *
 *   • `terminal`-shape entries are NOT emitted from history. Terminal
 *     events are SSE-only; they are not persisted to `agent_run_messages`.
 *     A reloaded completed run shows the same body the live run showed
 *     minus the trailing terminal banner — acceptable, and matches the
 *     SPEC (MH5 says messages, not terminal events).
 */
export function mapApiMessagesToEntries(
	messages: AgentRunMessage[],
): AgentRunTranscriptEntry[] {
	const entries: AgentRunTranscriptEntry[] = [];
	// Stack of unmatched tool_call ids keyed by tool_name. We pop the
	// oldest unmatched entry of the same name when a tool_result arrives
	// — matches the FIFO emission order the daemon actually produces.
	const unmatchedByName = new Map<string, string[]>();

	for (const row of messages) {
		switch (row.role) {
			case 'system':
			case 'user':
				// Delegation prelude — not part of the visible transcript.
				continue;
			case 'assistant': {
				if (!row.content) continue;
				entries.push({ kind: 'token', text: row.content, seq: row.seq });
				break;
			}
			case 'tool_call': {
				const parsed = parseToolCallContent(row.content);
				if (!parsed) continue;
				const queue = unmatchedByName.get(parsed.name) ?? [];
				queue.push(parsed.id);
				unmatchedByName.set(parsed.name, queue);
				entries.push({
					kind: 'tool_call',
					id: parsed.id,
					name: parsed.name,
					arguments: parsed.arguments,
					seq: row.seq,
				});
				break;
			}
			case 'tool_result': {
				const name = row.tool_name ?? '';
				const queue = unmatchedByName.get(name);
				const toolCallId = queue && queue.length > 0
					? (queue.shift() as string)
					: `historical-orphan-${row.seq}`;
				if (queue && queue.length === 0) unmatchedByName.delete(name);
				entries.push({
					kind: 'tool_result',
					toolCallId,
					content: row.content,
					isError: false,
					seq: row.seq,
				});
				break;
			}
		}
	}

	return entries;
}

/**
 * Merge historical entries with live SSE entries.
 *
 * Strategy: when historical loads, we capture the length of the live
 * entries array at that exact moment (`liveBaselineLength`). Anything
 * already in the live array is assumed to be covered by historical
 * (the daemon persisted those messages before the fetch returned).
 * Anything appended after the snapshot is genuinely new and gets
 * spliced onto the end of the historical list.
 *
 * Why not seq-based dedup? The historical `seq` (per-message in
 * agent_run_messages) and the live SSE `seq` (per-event in
 * publishRunEvent) are independent counters in the daemon. They cannot
 * be compared directly to decide overlap. Index-snapshot dedup is
 * source-agnostic and degrades gracefully: an in-flight run that
 * received zero live events before the fetch returned starts with
 * baseline = 0 and appends every subsequent SSE entry; a completed run
 * has no further live entries, so the slice is empty and only
 * historical renders.
 *
 * If history hasn't loaded yet, we surface the live array as-is so the
 * UI keeps working exactly as it did before this change.
 */
export function mergeHistoricalAndLive(params: {
	historical: AgentRunTranscriptEntry[];
	live: AgentRunTranscriptEntry[];
	liveBaselineLength: number;
	historicalLoaded: boolean;
}): AgentRunTranscriptEntry[] {
	const { historical, live, liveBaselineLength, historicalLoaded } = params;
	if (!historicalLoaded) return live;
	const overflow = live.slice(Math.max(0, liveBaselineLength));
	if (overflow.length === 0) return historical;
	return [...historical, ...overflow];
}

/**
 * Stable sentinel exported for the component's "loading" branch.
 * Kept here so the helper module owns the full contract.
 */
export const HISTORICAL_INITIAL_BASELINE = 0;

/**
 * Re-export for callers that want to type the run status alongside
 * the merged entries (e.g. for `aria-busy`). Avoids a separate import
 * for downstream code.
 */
export type { AgentRunStatus };
