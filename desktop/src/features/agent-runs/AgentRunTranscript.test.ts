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
import type {
	AgentRun,
	AgentRunTranscriptEntry,
} from '$lib/types/agent-run.js';
import {
	computeRenderBlocks,
	type RenderBlock,
} from './agent-run-transcript-blocks.js';

// ─── Helpers for child-run fixtures (runId resolution tests) ─────────────────

function childRun(runId: string, title: string, createdAt: string): AgentRun {
	return {
		runId,
		sessionId: 'session-1',
		projectId: 'project-1',
		parentRunId: 'parent-run',
		agentType: 'executor',
		title,
		status: 'running',
		contextMode: 'inherit_session',
		createdAt,
		startedAt: null,
		endedAt: null,
		errorMessage: null,
	};
}

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

// ─── runId resolution (task block) ───────────────────────────────────────────
//
// The `task` render block surfaces `resolvedRunId` to AgentTaskCard so
// the card can become clickable once a child runId is known. Resolution
// has three tiers, checked in priority order:
//
//   1. `tool_call.metadata.runId` — merged onto the tool_call entry by
//      the store's `agent_run.tool_call_metadata` handler (T3.3).
//   2. title-match fallback — look up a child run (from the parent's
//      `childRunsForRun(...)`) whose `title === arguments.description`.
//      Covers the race where `agent_run.spawned` lands before the
//      `agent_run.tool_call_metadata` event.
//   3. `null` — no child run yet; AgentTaskCard renders its disabled
//      "spawning…" state and is not a tab stop.
//
// The reactivity test doesn't need Svelte runes — `computeRenderBlocks`
// is a pure function, and recomputing with an updated `childRuns` array
// mirrors exactly what `$derived` does in the component.

describe('computeRenderBlocks — task runId resolution', () => {
	it('tier 1: uses metadata.runId when present (metadata wins over fallback)', () => {
		const entries: AgentRunTranscriptEntry[] = [
			{
				kind: 'tool_call',
				id: 'call-1',
				name: 'task',
				arguments: { description: 'Ship the thing', agent_type: 'executor-high' },
				seq: 1,
				metadata: {
					runId: 'run-from-metadata',
					parentRunId: 'parent-run',
					agentType: 'executor-high',
					title: 'Ship the thing',
				},
			},
		];

		// A stale/mismatched fallback is also present — metadata must win.
		const childRuns = [
			childRun('run-from-fallback', 'Ship the thing', '2026-04-19T10:00:00Z'),
		];

		const blocks = computeRenderBlocks(entries, { childRuns });
		expect(blocks).toHaveLength(1);
		const [block] = blocks;
		if (block.kind !== 'task') throw new Error('expected task block');
		expect(block.resolvedRunId).toBe('run-from-metadata');
	});

	it('tier 2: falls back to title-match child run when metadata is absent', () => {
		const entries: AgentRunTranscriptEntry[] = [
			// No metadata — the tool_call_metadata event hasn't arrived yet,
			// but agent_run.spawned already populated a child.
			{
				kind: 'tool_call',
				id: 'call-1',
				name: 'task',
				arguments: {
					description: 'Refactor the auth module',
					agent_type: 'executor-medium',
				},
				seq: 1,
			},
		];

		const childRuns = [
			childRun('run-sibling', 'Unrelated subtask', '2026-04-19T10:00:00Z'),
			childRun(
				'run-matched',
				'Refactor the auth module',
				'2026-04-19T10:00:01Z',
			),
		];

		const blocks = computeRenderBlocks(entries, { childRuns });
		expect(blocks).toHaveLength(1);
		const [block] = blocks;
		if (block.kind !== 'task') throw new Error('expected task block');
		expect(block.resolvedRunId).toBe('run-matched');
	});

	it('tier 3: returns null when there is no metadata and no matching child', () => {
		const entries: AgentRunTranscriptEntry[] = [
			{
				kind: 'tool_call',
				id: 'call-1',
				name: 'task',
				arguments: { description: 'Unmatched task', agent_type: 'executor' },
				seq: 1,
			},
		];

		// Empty child list (e.g., spawn event still in flight).
		const blocks1 = computeRenderBlocks(entries, { childRuns: [] });
		const b1 = blocks1[0];
		if (b1.kind !== 'task') throw new Error('expected task block');
		expect(b1.resolvedRunId).toBeNull();

		// Non-empty but no title match.
		const childRuns = [
			childRun('run-other', 'Something else entirely', '2026-04-19T10:00:00Z'),
		];
		const blocks2 = computeRenderBlocks(entries, { childRuns });
		const b2 = blocks2[0];
		if (b2.kind !== 'task') throw new Error('expected task block');
		expect(b2.resolvedRunId).toBeNull();
	});

	it('tier 3: returns null when no options are passed (defaults to empty childRuns)', () => {
		const entries: AgentRunTranscriptEntry[] = [
			{
				kind: 'tool_call',
				id: 'call-1',
				name: 'task',
				arguments: { description: 'Anything', agent_type: 'executor' },
				seq: 1,
			},
		];

		// Calling without options is the pre-T5.3 signature — must remain
		// safe and produce the spawning (null) state.
		const blocks = computeRenderBlocks(entries);
		const [block] = blocks;
		if (block.kind !== 'task') throw new Error('expected task block');
		expect(block.resolvedRunId).toBeNull();
	});

	it('does not title-match when the description is empty (avoids matching empty-titled children)', () => {
		const entries: AgentRunTranscriptEntry[] = [
			{
				kind: 'tool_call',
				id: 'call-1',
				name: 'task',
				arguments: { agent_type: 'executor' }, // no description → title stays ''
				seq: 1,
			},
		];

		// A pathological child with an empty title must not silently match.
		const childRuns = [childRun('run-empty', '', '2026-04-19T10:00:00Z')];

		const blocks = computeRenderBlocks(entries, { childRuns });
		const [block] = blocks;
		if (block.kind !== 'task') throw new Error('expected task block');
		expect(block.resolvedRunId).toBeNull();
	});

	it('picks the first child with a matching title when duplicates exist', () => {
		// `childRunsForRun` sorts children by createdAt; the first match
		// (oldest) wins — this matches AgentRunTree ordering and avoids
		// flipping IDs if a duplicate-titled sibling lands later.
		const entries: AgentRunTranscriptEntry[] = [
			{
				kind: 'tool_call',
				id: 'call-1',
				name: 'task',
				arguments: { description: 'Duplicate title', agent_type: 'executor' },
				seq: 1,
			},
		];

		const childRuns = [
			childRun('run-first', 'Duplicate title', '2026-04-19T10:00:00Z'),
			childRun('run-second', 'Duplicate title', '2026-04-19T10:00:05Z'),
		];

		const blocks = computeRenderBlocks(entries, { childRuns });
		const [block] = blocks;
		if (block.kind !== 'task') throw new Error('expected task block');
		expect(block.resolvedRunId).toBe('run-first');
	});

	it('resolves each of multiple task calls independently', () => {
		// One task resolves via metadata, another via fallback, a third
		// stays null — proves the resolver runs per-entry without
		// cross-contamination.
		const entries: AgentRunTranscriptEntry[] = [
			{
				kind: 'tool_call',
				id: 'call-a',
				name: 'task',
				arguments: { description: 'Task A', agent_type: 'executor' },
				seq: 1,
				metadata: {
					runId: 'run-a',
					parentRunId: 'parent-run',
					agentType: 'executor',
					title: 'Task A',
				},
			},
			{
				kind: 'tool_call',
				id: 'call-b',
				name: 'task',
				arguments: { description: 'Task B', agent_type: 'executor' },
				seq: 2,
			},
			{
				kind: 'tool_call',
				id: 'call-c',
				name: 'task',
				arguments: { description: 'Task C', agent_type: 'executor' },
				seq: 3,
			},
		];

		const childRuns = [
			childRun('run-b', 'Task B', '2026-04-19T10:00:00Z'),
			// No child for Task C yet.
		];

		const blocks = computeRenderBlocks(entries, { childRuns });
		expect(blocks).toHaveLength(3);
		const [a, b, c] = blocks as [
			Extract<RenderBlock, { kind: 'task' }>,
			Extract<RenderBlock, { kind: 'task' }>,
			Extract<RenderBlock, { kind: 'task' }>,
		];
		expect(a.resolvedRunId).toBe('run-a');
		expect(b.resolvedRunId).toBe('run-b');
		expect(c.resolvedRunId).toBeNull();
	});

	it('reactivity: recomputing after a spawn lands a matching child flips null → runId', () => {
		// Models the actual runtime path: the component re-runs
		// `computeRenderBlocks` whenever `childRunsForRun(parentRunId)`
		// changes (via $derived). Before agent_run.spawned arrives, the
		// task has no metadata and no child; after it arrives, the child
		// exists and the title matches.
		const entries: AgentRunTranscriptEntry[] = [
			{
				kind: 'tool_call',
				id: 'call-1',
				name: 'task',
				arguments: {
					description: 'Run the migration',
					agent_type: 'executor-high',
				},
				seq: 1,
			},
		];

		// T0: spawn hasn't happened yet — children is empty.
		let childRuns: AgentRun[] = [];
		const before = computeRenderBlocks(entries, { childRuns });
		const beforeBlock = before[0];
		if (beforeBlock.kind !== 'task') throw new Error('expected task block');
		expect(beforeBlock.resolvedRunId).toBeNull();

		// T1: agent_run.spawned event lands; the store's childrenByParent
		// index now includes a matching child. Recomputing with the new
		// list is what `$derived` does in the component.
		childRuns = [
			childRun('run-child', 'Run the migration', '2026-04-19T10:00:00Z'),
		];
		const after = computeRenderBlocks(entries, { childRuns });
		const afterBlock = after[0];
		if (afterBlock.kind !== 'task') throw new Error('expected task block');
		expect(afterBlock.resolvedRunId).toBe('run-child');
	});

	it('reactivity: metadata arriving after spawn overrides fallback on recompute', () => {
		// Realistic ordering: spawn → tool_call_metadata. Fallback is used
		// briefly, then metadata takes over once the store merges it onto
		// the tool_call entry (T3.3's handler).
		const args = {
			description: 'Fetch the user',
			agent_type: 'executor-medium',
		};

		// T0: fallback only — child is present, metadata is not.
		const childRuns = [
			childRun('run-fallback', 'Fetch the user', '2026-04-19T10:00:00Z'),
		];
		const entriesNoMeta: AgentRunTranscriptEntry[] = [
			{
				kind: 'tool_call',
				id: 'call-1',
				name: 'task',
				arguments: args,
				seq: 1,
			},
		];
		const before = computeRenderBlocks(entriesNoMeta, { childRuns });
		const beforeBlock = before[0];
		if (beforeBlock.kind !== 'task') throw new Error('expected task block');
		expect(beforeBlock.resolvedRunId).toBe('run-fallback');

		// T1: tool_call_metadata merged — metadata.runId should now win
		// even though the fallback child still exists.
		const entriesWithMeta: AgentRunTranscriptEntry[] = [
			{
				kind: 'tool_call',
				id: 'call-1',
				name: 'task',
				arguments: args,
				seq: 1,
				metadata: {
					runId: 'run-from-metadata',
					parentRunId: 'parent-run',
					agentType: 'executor-medium',
					title: 'Fetch the user',
				},
			},
		];
		const after = computeRenderBlocks(entriesWithMeta, { childRuns });
		const afterBlock = after[0];
		if (afterBlock.kind !== 'task') throw new Error('expected task block');
		expect(afterBlock.resolvedRunId).toBe('run-from-metadata');
	});
});
