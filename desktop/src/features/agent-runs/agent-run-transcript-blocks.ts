// Pure render-block computation for AgentRunTranscript.
//
// Extracted from AgentRunTranscript.svelte so it can be unit-tested
// without a component renderer (the project has no
// @testing-library/svelte). The same extraction pattern is used by
// AgentTaskCard (see agent-task-card-state.ts) and keeps the Svelte
// template thin while covering every dispatch branch with fast tests.
//
// Dispatch rules:
//   • Consecutive `token` events fold into a single streaming
//     assistant message (so fenced code via StreamingMessage keeps
//     working end-to-end).
//   • A `tool_call` with `name === 'task'` emits a dedicated `task`
//     block (rendered as AgentTaskCard). The child run's `tool_result`
//     is suppressed — the task card already represents the whole
//     delegation; a trailing result block would be noise.
//   • A `tool_call` with `name === 'visualize'` is routed based on
//     `isOrchestrator`:
//       – Orchestrator runs (top-level, `parentRunId === null`): the
//         tool call is promoted to a `viz` block and rendered inline
//         via VizRenderer (MH3: viz blocks render inline in the chat
//         stream — including the agent-run transcript surface).
//       – Subagent runs: silently skipped (MH9: subagent transcripts
//         don't initiate or render viz). The toolkit allowlist already
//         prevents subagents from calling `visualize`, so this is a
//         defensive guard for stray calls.
//     The paired `tool_result` is always suppressed for visualize
//     calls — its content is already carried inside the `viz` block
//     (or dropped entirely for subagents).
//   • Any other `tool_call` emits a regular `tool` block and its
//     `tool_result` is merged back onto the paired display.
//   • `question` and `terminal` events produce their own blocks.

import type {
	AgentRun,
	AgentRunStatus,
	AgentRunTranscriptEntry,
} from '$lib/types/agent-run.js';
import type {
	ChatMessage,
	ContentBlock,
	ToolCallDisplay,
} from '../chat/types.js';
import { promoteVizBlock } from '../chat/viz/promote-viz-block.js';
import type { VizEnvelope } from '../chat/viz/types.js';

export type RenderBlock =
	| { kind: 'text'; id: string; message: ChatMessage }
	| { kind: 'tool'; id: string; toolCall: ToolCallDisplay }
	| { kind: 'viz'; id: string; envelope: VizEnvelope }
	| {
			kind: 'task';
			id: string;
			title: string;
			agentType: string;
			toolCallId: string;
			resolvedRunId: string | null;
	  }
	| {
			kind: 'question';
			id: string;
			question: string;
			options: Array<{ label: string; description?: string }>;
			multiple: boolean;
	  }
	| { kind: 'terminal'; id: string; status: AgentRunStatus; message: string };

/**
 * Options controlling runId resolution for `task` tool calls and viz
 * routing.
 *
 * `childRuns` is the current list of direct children of the parent run
 * (i.e. what `agentRunsStore.childRunsForRun(parentRunId)` returns).
 * Passing it in — rather than importing the store — keeps this module
 * pure and easy to unit-test, and lets the component wrap the call in a
 * `$derived` so resolution updates reactively whenever
 * `agent_run.spawned` arrives and a new child lands in the store.
 *
 * Resolution priority for each task block:
 *   1. `tool_call.metadata.runId` (carried by `agent_run.tool_call_metadata`)
 *   2. child run whose `title` matches `arguments.description`
 *   3. `null` — spawning (AgentTaskCard renders the disabled state)
 *
 * `isOrchestrator` decides whether `visualize` tool calls promote to a
 * `viz` render block (true) or are silently skipped (false). The
 * AgentRunTranscript component derives this from
 * `run.parentRunId === null` — top-level runs are orchestrator runs and
 * may render viz inline; child runs are subagents and never do (MH9).
 * Defaults to `false` so callers without a run context (early tests,
 * pre-hydration) preserve the safe-by-default subagent behaviour.
 */
export interface ComputeRenderBlocksOptions {
	childRuns?: AgentRun[];
	isOrchestrator?: boolean;
}

/**
 * Compute the ordered list of render blocks for a transcript.
 *
 * `task` tool calls are dispatched to a `task` block and their
 * corresponding `tool_result` (matched by `tool_call_id`) is dropped.
 * All other tool calls behave exactly as before.
 */
export function computeRenderBlocks(
	source: AgentRunTranscriptEntry[],
	options: ComputeRenderBlocksOptions = {},
): RenderBlock[] {
	const childRuns = options.childRuns ?? [];
	const isOrchestrator = options.isOrchestrator ?? false;
	const out: RenderBlock[] = [];
	const toolCallsById = new Map<string, ToolCallDisplay>();
	// Track task tool_call_ids so we can suppress their tool_result.
	const taskToolCallIds = new Set<string>();
	// Track visualize tool_call_ids: in either branch (orchestrator
	// promotion or subagent suppression) the paired `tool_result` should
	// not surface as a generic ToolCallCard. For orchestrator runs we
	// also map the id to the index of its viz render block so the
	// trailing tool_result can patch the envelope onto the block once
	// the result content arrives (mirrors `promoteVizBlock` semantics
	// in StreamingMessage).
	const vizToolCallIds = new Set<string>();
	const vizBlockIndexById = new Map<string, number>();
	// Cache pending visualize tool calls keyed by id so we can re-run
	// `promoteVizBlock` once the result lands. Until then we render a
	// placeholder ToolCallCard via the helper's fallback.
	const vizPendingToolCalls = new Map<string, ToolCallDisplay>();
	let currentText: { id: string; text: string } | null = null;

	const flushText = (): void => {
		if (!currentText) return;
		const blocks: ContentBlock[] = [{ type: 'text', text: currentText.text }];
		const message: ChatMessage = {
			id: currentText.id,
			role: 'assistant',
			content: currentText.text,
			blocks,
			timestamp: new Date(),
		};
		out.push({ kind: 'text', id: currentText.id, message });
		currentText = null;
	};

	for (const entry of source) {
		switch (entry.kind) {
			case 'token': {
				if (!currentText) {
					currentText = { id: `text-${entry.seq}`, text: entry.text };
				} else {
					currentText.text += entry.text;
				}
				break;
			}
			case 'tool_call': {
				flushText();
				if (entry.name === 'visualize') {
					vizToolCallIds.add(entry.id);
					if (!isOrchestrator) {
						// Subagent transcript — silently skip (MH9).
						break;
					}
					// Orchestrator transcript — emit a viz render block.
					// Until the matching tool_result arrives the envelope
					// cannot be parsed; render a fallback ToolCallCard via
					// the same `promoteVizBlock` helper used by
					// StreamingMessage so the running state is consistent.
					const toolCall: ToolCallDisplay = {
						id: entry.id,
						name: entry.name,
						arguments: entry.arguments,
					};
					vizPendingToolCalls.set(entry.id, toolCall);
					const promoted = promoteVizBlock(toolCall);
					if (promoted.type === 'viz') {
						vizBlockIndexById.set(entry.id, out.length);
						out.push({
							kind: 'viz',
							id: `viz-${entry.id}`,
							envelope: promoted.envelope,
						});
					} else {
						vizBlockIndexById.set(entry.id, out.length);
						out.push({
							kind: 'tool',
							id: `tool-${entry.id}`,
							toolCall,
						});
					}
					break;
				}
				if (entry.name === 'task') {
					// Dedicated task render block — AgentTaskCard consumes this.
					const title =
						typeof entry.arguments.description === 'string'
							? entry.arguments.description
							: '';
					const agentType =
						typeof entry.arguments.agent_type === 'string'
							? entry.arguments.agent_type
							: 'agent';
					taskToolCallIds.add(entry.id);

					// Three-tier runId resolution:
					//   1. Metadata attached by agent_run.tool_call_metadata
					//      (T3.3 merges this onto the tool_call entry).
					//   2. Title-match against known child runs (fallback when
					//      metadata arrives after render or is missing).
					//   3. null — the child hasn't spawned yet; AgentTaskCard
					//      renders the disabled "spawning…" state.
					let resolvedRunId: string | null = null;
					if (entry.metadata?.runId) {
						resolvedRunId = entry.metadata.runId;
					} else if (title !== '') {
						const match = childRuns.find((r) => r.title === title);
						if (match) resolvedRunId = match.runId;
					}

					out.push({
						kind: 'task',
						id: `task-${entry.id}`,
						title,
						agentType,
						toolCallId: entry.id,
						resolvedRunId,
					});
				} else {
					const display: ToolCallDisplay = {
						id: entry.id,
						name: entry.name,
						arguments: entry.arguments,
					};
					toolCallsById.set(entry.id, display);
					out.push({ kind: 'tool', id: `tool-${entry.id}`, toolCall: display });
				}
				break;
			}
			case 'tool_result': {
				// Suppress the trailing tool_result for task calls — the
				// AgentTaskCard already represents the full delegation.
				if (taskToolCallIds.has(entry.toolCallId)) {
					break;
				}
				if (vizToolCallIds.has(entry.toolCallId)) {
					// Orchestrator: re-run promotion now that the result
					// content is available and patch the existing block.
					// Subagent: nothing to patch — the call was skipped.
					const pending = vizPendingToolCalls.get(entry.toolCallId);
					const blockIdx = vizBlockIndexById.get(entry.toolCallId);
					if (pending && blockIdx !== undefined) {
						pending.result = {
							toolCallId: entry.toolCallId,
							content: entry.content,
							isError: entry.isError,
						};
						const promoted = promoteVizBlock(pending);
						if (promoted.type === 'viz') {
							out[blockIdx] = {
								kind: 'viz',
								id: `viz-${entry.toolCallId}`,
								envelope: promoted.envelope,
							};
						} else {
							// Malformed envelope — keep the tool block but
							// merge the result so the user can inspect it.
							out[blockIdx] = {
								kind: 'tool',
								id: `tool-${entry.toolCallId}`,
								toolCall: pending,
							};
						}
					}
					break;
				}
				const existing = toolCallsById.get(entry.toolCallId);
				if (existing) {
					existing.result = {
						toolCallId: entry.toolCallId,
						content: entry.content,
						isError: entry.isError,
					};
				}
				break;
			}
			case 'question': {
				flushText();
				out.push({
					kind: 'question',
					id: `q-${entry.questionId}-${entry.seq}`,
					question: entry.question,
					options: entry.options,
					multiple: entry.multiple,
				});
				break;
			}
		case 'terminal': {
			flushText();
			// Replace any prior terminal block — only the last terminal entry
			// is meaningful. This prevents duplicate "Run complete." banners
			// if the daemon emitted the event more than once (defensive guard).
			const existingTerminalIdx = out.findIndex((b) => b.kind === 'terminal');
			const terminalBlock: RenderBlock = {
				kind: 'terminal',
				id: `terminal-${entry.seq}`,
				status: entry.status,
				message: entry.message,
			};
			if (existingTerminalIdx !== -1) {
				out[existingTerminalIdx] = terminalBlock;
			} else {
				out.push(terminalBlock);
			}
			break;
		}
		}
	}

	flushText();
	return out;
}
