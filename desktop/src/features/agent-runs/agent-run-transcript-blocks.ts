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
//   • Any other `tool_call` emits a regular `tool` block and its
//     `tool_result` is merged back onto the paired display.
//   • `question` and `terminal` events produce their own blocks.

import type {
	AgentRunStatus,
	AgentRunTranscriptEntry,
} from '$lib/types/agent-run.js';
import type {
	ChatMessage,
	ContentBlock,
	ToolCallDisplay,
} from '../chat/types.js';

export type RenderBlock =
	| { kind: 'text'; id: string; message: ChatMessage }
	| { kind: 'tool'; id: string; toolCall: ToolCallDisplay }
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
 * Compute the ordered list of render blocks for a transcript.
 *
 * `task` tool calls are dispatched to a `task` block and their
 * corresponding `tool_result` (matched by `tool_call_id`) is dropped.
 * All other tool calls behave exactly as before.
 */
export function computeRenderBlocks(
	source: AgentRunTranscriptEntry[],
): RenderBlock[] {
	const out: RenderBlock[] = [];
	const toolCallsById = new Map<string, ToolCallDisplay>();
	// Track task tool_call_ids so we can suppress their tool_result.
	const taskToolCallIds = new Set<string>();
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
				if (entry.name === 'task') {
					// Dedicated task render block — AgentTaskCard consumes this.
					// `resolvedRunId` stays null here; wave 5.3 will populate it
					// from metadata + childRunsForRun fallback resolution.
					const title =
						typeof entry.arguments.description === 'string'
							? entry.arguments.description
							: '';
					const agentType =
						typeof entry.arguments.agent_type === 'string'
							? entry.arguments.agent_type
							: 'agent';
					taskToolCallIds.add(entry.id);
					out.push({
						kind: 'task',
						id: `task-${entry.id}`,
						title,
						agentType,
						toolCallId: entry.id,
						resolvedRunId: null,
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
				out.push({
					kind: 'terminal',
					id: `terminal-${entry.seq}`,
					status: entry.status,
					message: entry.message,
				});
				break;
			}
		}
	}

	flushText();
	return out;
}
