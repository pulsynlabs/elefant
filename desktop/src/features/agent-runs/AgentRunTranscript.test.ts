// AgentRunTranscript dispatch tests.
//
// The project has no component renderer in its deps (no
// @testing-library/svelte), so these tests target the pure
// `computeRenderBlocks` dispatcher that drives every branch of the
// transcript template. See AgentTaskCard.test.ts for the same pattern.
//
// Focus of this suite: task-tool-call dispatch behavior.
//   • A `task` tool_call produces a `task` render block (→ AgentTaskCard)
//     instead of a generic `tool` block.
//   • A non-task tool_call still produces a regular `tool` block.
//   • The `tool_result` paired with a task tool_call is SUPPRESSED — the
//     task card already represents the whole delegation; a trailing
//     result would be a duplicate.
//   • `tool_result` for non-task calls continues to merge onto the
//     existing tool block.
//
// A few baseline tests also cover token/question/terminal dispatch to
// prevent regressions from the extraction into a pure module.

import { describe, expect, it } from 'bun:test';
import type { AgentRunTranscriptEntry } from '$lib/types/agent-run.js';
import {
	computeRenderBlocks,
	type RenderBlock,
} from './agent-run-transcript-blocks.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function taskCall(
	id: string,
	description: string,
	agentType: string,
	seq: number,
): AgentRunTranscriptEntry {
	return {
		kind: 'tool_call',
		id,
		name: 'task',
		arguments: { description, agent_type: agentType },
		seq,
	};
}

function toolCall(
	id: string,
	name: string,
	args: Record<string, unknown>,
	seq: number,
): AgentRunTranscriptEntry {
	return { kind: 'tool_call', id, name, arguments: args, seq };
}

function toolResult(
	toolCallId: string,
	content: string,
	seq: number,
	isError = false,
): AgentRunTranscriptEntry {
	return { kind: 'tool_result', toolCallId, content, isError, seq };
}

// ─── Task dispatch ───────────────────────────────────────────────────────────

describe('computeRenderBlocks — task tool dispatch', () => {
	it('emits a task block for a `task` tool_call instead of a tool block', () => {
		const entries: AgentRunTranscriptEntry[] = [
			taskCall('call-1', 'Refactor auth module', 'executor-high', 1),
		];

		const blocks = computeRenderBlocks(entries);

		expect(blocks).toHaveLength(1);
		const [block] = blocks;
		expect(block.kind).toBe('task');
		if (block.kind !== 'task') throw new Error('unreachable');
		expect(block.id).toBe('task-call-1');
		expect(block.toolCallId).toBe('call-1');
		expect(block.title).toBe('Refactor auth module');
		expect(block.agentType).toBe('executor-high');
		// resolvedRunId starts null — wave 5.3 fills it in.
		expect(block.resolvedRunId).toBeNull();
	});

	it('falls back to "agent" when the task call has no agent_type argument', () => {
		const entries: AgentRunTranscriptEntry[] = [
			{
				kind: 'tool_call',
				id: 'call-x',
				name: 'task',
				arguments: { description: 'Do the thing' },
				seq: 1,
			},
		];

		const blocks = computeRenderBlocks(entries);
		expect(blocks).toHaveLength(1);
		const [block] = blocks;
		if (block.kind !== 'task') throw new Error('expected task block');
		expect(block.agentType).toBe('agent');
		expect(block.title).toBe('Do the thing');
	});

	it('tolerates a task call with empty arguments (title stays empty, agentType defaults)', () => {
		const entries: AgentRunTranscriptEntry[] = [
			{
				kind: 'tool_call',
				id: 'call-empty',
				name: 'task',
				arguments: {},
				seq: 1,
			},
		];

		const blocks = computeRenderBlocks(entries);
		expect(blocks).toHaveLength(1);
		const [block] = blocks;
		if (block.kind !== 'task') throw new Error('expected task block');
		expect(block.title).toBe('');
		expect(block.agentType).toBe('agent');
	});

	it('suppresses the tool_result for a task call (no duplicate block)', () => {
		const entries: AgentRunTranscriptEntry[] = [
			taskCall('call-1', 'Refactor auth', 'executor-high', 1),
			toolResult('call-1', '{"runId":"run-child","status":"done"}', 2),
		];

		const blocks = computeRenderBlocks(entries);

		// Exactly one block — the task card. The tool_result is dropped.
		expect(blocks).toHaveLength(1);
		expect(blocks[0].kind).toBe('task');
	});

	it('still dispatches non-task tool_calls to the regular tool block', () => {
		const entries: AgentRunTranscriptEntry[] = [
			toolCall('call-2', 'read_file', { path: 'src/index.ts' }, 1),
		];

		const blocks = computeRenderBlocks(entries);
		expect(blocks).toHaveLength(1);
		const [block] = blocks;
		expect(block.kind).toBe('tool');
		if (block.kind !== 'tool') throw new Error('unreachable');
		expect(block.toolCall.name).toBe('read_file');
	});

	it('merges tool_result onto non-task tool_calls as before', () => {
		const entries: AgentRunTranscriptEntry[] = [
			toolCall('call-2', 'read_file', { path: 'a.ts' }, 1),
			toolResult('call-2', 'contents of a.ts', 2),
		];

		const blocks = computeRenderBlocks(entries);
		expect(blocks).toHaveLength(1);
		const [block] = blocks;
		if (block.kind !== 'tool') throw new Error('expected tool block');
		expect(block.toolCall.result).toEqual({
			toolCallId: 'call-2',
			content: 'contents of a.ts',
			isError: false,
		});
	});

	it('suppresses only the matching task tool_result, not siblings', () => {
		// Interleaved task + regular tool flow:
		//   task call-1 → regular call-2 → task result (suppressed)
		//   → regular result (merged).
		const entries: AgentRunTranscriptEntry[] = [
			taskCall('call-1', 'Spawn child', 'executor', 1),
			toolCall('call-2', 'read_file', { path: 'x.ts' }, 2),
			toolResult('call-1', '{"runId":"r-child"}', 3),
			toolResult('call-2', 'file contents', 4),
		];

		const blocks = computeRenderBlocks(entries);
		expect(blocks).toHaveLength(2);
		expect(blocks[0].kind).toBe('task');
		expect(blocks[1].kind).toBe('tool');
		if (blocks[1].kind !== 'tool') throw new Error('unreachable');
		expect(blocks[1].toolCall.result?.content).toBe('file contents');
	});

	it('dispatches multiple task calls independently', () => {
		const entries: AgentRunTranscriptEntry[] = [
			taskCall('call-a', 'First subtask', 'executor-low', 1),
			taskCall('call-b', 'Second subtask', 'executor-medium', 2),
			toolResult('call-a', 'result-a', 3),
			toolResult('call-b', 'result-b', 4),
		];

		const blocks = computeRenderBlocks(entries);
		expect(blocks.map((b) => b.kind)).toEqual(['task', 'task']);
		const [a, b] = blocks as [
			Extract<RenderBlock, { kind: 'task' }>,
			Extract<RenderBlock, { kind: 'task' }>,
		];
		expect(a.title).toBe('First subtask');
		expect(a.agentType).toBe('executor-low');
		expect(b.title).toBe('Second subtask');
		expect(b.agentType).toBe('executor-medium');
	});
});

// ─── Baseline (regression guard for the extraction) ──────────────────────────

describe('computeRenderBlocks — baseline behavior preserved', () => {
	it('returns an empty list for an empty transcript', () => {
		expect(computeRenderBlocks([])).toEqual([]);
	});

	it('coalesces consecutive token events into one text block', () => {
		const entries: AgentRunTranscriptEntry[] = [
			{ kind: 'token', text: 'Hel', seq: 1 },
			{ kind: 'token', text: 'lo ', seq: 2 },
			{ kind: 'token', text: 'world', seq: 3 },
		];

		const blocks = computeRenderBlocks(entries);
		expect(blocks).toHaveLength(1);
		const [block] = blocks;
		expect(block.kind).toBe('text');
		if (block.kind !== 'text') throw new Error('unreachable');
		expect(block.message.content).toBe('Hello world');
	});

	it('flushes buffered tokens before a tool_call', () => {
		const entries: AgentRunTranscriptEntry[] = [
			{ kind: 'token', text: 'thinking… ', seq: 1 },
			toolCall('call-1', 'read_file', { path: 'a.ts' }, 2),
		];

		const blocks = computeRenderBlocks(entries);
		expect(blocks.map((b) => b.kind)).toEqual(['text', 'tool']);
	});

	it('renders question and terminal events as their own blocks', () => {
		const entries: AgentRunTranscriptEntry[] = [
			{
				kind: 'question',
				questionId: 'q1',
				question: 'Continue?',
				options: [{ label: 'Yes' }, { label: 'No' }],
				multiple: false,
				seq: 1,
			},
			{
				kind: 'terminal',
				status: 'done',
				message: 'Finished cleanly',
				seq: 2,
			},
		];

		const blocks = computeRenderBlocks(entries);
		expect(blocks.map((b) => b.kind)).toEqual(['question', 'terminal']);
	});
});
