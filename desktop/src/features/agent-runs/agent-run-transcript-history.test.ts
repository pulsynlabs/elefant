// Tests for the pure transcript-history helpers.
//
// These cover both stages of the historical hydration pipeline used by
// AgentRunTranscript.svelte:
//
//   1. mapApiMessagesToEntries — DB row → AgentRunTranscriptEntry
//   2. mergeHistoricalAndLive — historical + live splice with index
//      snapshot dedup
//
// Same pure-helper testing pattern as
// agent-run-transcript-blocks.test.ts and child-run-view-state.test.ts.
// No component renderer needed; the Svelte template stays a thin shell
// over these helpers.

import { describe, expect, it } from 'bun:test';
import type { AgentRunTranscriptEntry } from '$lib/types/agent-run.js';
import {
	mapApiMessagesToEntries,
	mergeHistoricalAndLive,
	type AgentRunMessage,
} from './agent-run-transcript-history.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function row(
	overrides: Partial<AgentRunMessage> & Pick<AgentRunMessage, 'role' | 'seq' | 'content'>,
): AgentRunMessage {
	return {
		id: overrides.id ?? overrides.seq + 1,
		run_id: overrides.run_id ?? 'run-1',
		seq: overrides.seq,
		role: overrides.role,
		content: overrides.content,
		tool_name: overrides.tool_name ?? null,
		created_at: overrides.created_at ?? '2026-04-19T10:00:00Z',
	};
}

// ─── mapApiMessagesToEntries ─────────────────────────────────────────────────

describe('mapApiMessagesToEntries', () => {
	it('returns an empty array for empty input', () => {
		expect(mapApiMessagesToEntries([])).toEqual([]);
	});

	it('skips system and user rows (delegation prelude is not part of the visible transcript)', () => {
		const entries = mapApiMessagesToEntries([
			row({ role: 'system', seq: 0, content: '<delegation_context>...</delegation_context>' }),
			row({ role: 'user', seq: 1, content: 'Run the migration.' }),
		]);
		expect(entries).toEqual([]);
	});

	it('maps an assistant row to a single token entry', () => {
		const entries = mapApiMessagesToEntries([
			row({ role: 'assistant', seq: 2, content: 'Hello world' }),
		]);
		expect(entries).toEqual([
			{ kind: 'token', text: 'Hello world', seq: 2 },
		]);
	});

	it('drops empty assistant rows (no token entry produced)', () => {
		const entries = mapApiMessagesToEntries([
			row({ role: 'assistant', seq: 2, content: '' }),
		]);
		expect(entries).toEqual([]);
	});

	it('parses a tool_call row back to {id, name, arguments}', () => {
		const entries = mapApiMessagesToEntries([
			row({
				role: 'tool_call',
				seq: 3,
				content: JSON.stringify({
					id: 'call-abc',
					name: 'read_file',
					arguments: { path: 'src/index.ts' },
				}),
				tool_name: 'read_file',
			}),
		]);
		expect(entries).toEqual([
			{
				kind: 'tool_call',
				id: 'call-abc',
				name: 'read_file',
				arguments: { path: 'src/index.ts' },
				seq: 3,
			},
		]);
	});

	it('drops a tool_call row whose JSON cannot be parsed (corrupt persisted payload)', () => {
		const entries = mapApiMessagesToEntries([
			row({ role: 'tool_call', seq: 3, content: 'not-json{', tool_name: 'read_file' }),
		]);
		expect(entries).toEqual([]);
	});

	it('drops a tool_call row missing id or name (cannot be paired with a result)', () => {
		const entries = mapApiMessagesToEntries([
			row({
				role: 'tool_call',
				seq: 3,
				content: JSON.stringify({ name: 'read_file' }), // missing id
				tool_name: 'read_file',
			}),
		]);
		expect(entries).toEqual([]);
	});

	it('pairs a tool_result with the most-recent unmatched tool_call of the same tool_name', () => {
		const entries = mapApiMessagesToEntries([
			row({
				role: 'tool_call',
				seq: 3,
				content: JSON.stringify({ id: 'call-1', name: 'read_file', arguments: {} }),
				tool_name: 'read_file',
			}),
			row({
				role: 'tool_result',
				seq: 4,
				content: 'file contents',
				tool_name: 'read_file',
			}),
		]);
		expect(entries).toHaveLength(2);
		expect(entries[1]).toEqual({
			kind: 'tool_result',
			toolCallId: 'call-1',
			content: 'file contents',
			isError: false,
			seq: 4,
		});
	});

	it('FIFO-pairs multiple unmatched tool_calls of the same name (oldest first)', () => {
		// Two reads queued, then two results — first result pairs with
		// first call, second with second.
		const entries = mapApiMessagesToEntries([
			row({
				role: 'tool_call',
				seq: 1,
				content: JSON.stringify({ id: 'call-A', name: 'read_file', arguments: {} }),
				tool_name: 'read_file',
			}),
			row({
				role: 'tool_call',
				seq: 2,
				content: JSON.stringify({ id: 'call-B', name: 'read_file', arguments: {} }),
				tool_name: 'read_file',
			}),
			row({ role: 'tool_result', seq: 3, content: 'A-result', tool_name: 'read_file' }),
			row({ role: 'tool_result', seq: 4, content: 'B-result', tool_name: 'read_file' }),
		]);

		const results = entries.filter((e) => e.kind === 'tool_result');
		expect(results).toEqual([
			{ kind: 'tool_result', toolCallId: 'call-A', content: 'A-result', isError: false, seq: 3 },
			{ kind: 'tool_result', toolCallId: 'call-B', content: 'B-result', isError: false, seq: 4 },
		]);
	});

	it('synthesises an orphan toolCallId when a tool_result has no matching tool_call', () => {
		// Result row arriving alone (e.g., a corrupt/missing matching
		// call_row earlier). Renderer still gets a stable id rather
		// than crashing or merging onto a wrong call.
		const entries = mapApiMessagesToEntries([
			row({ role: 'tool_result', seq: 5, content: 'orphan', tool_name: 'unknown' }),
		]);
		expect(entries).toEqual([
			{
				kind: 'tool_result',
				toolCallId: 'historical-orphan-5',
				content: 'orphan',
				isError: false,
				seq: 5,
			},
		]);
	});

	it('preserves ordering across mixed roles (assistant → tool_call → tool_result → assistant)', () => {
		const entries = mapApiMessagesToEntries([
			row({ role: 'system', seq: 0, content: '...' }), // dropped
			row({ role: 'user', seq: 1, content: '...' }), // dropped
			row({ role: 'assistant', seq: 2, content: 'Reading file...' }),
			row({
				role: 'tool_call',
				seq: 3,
				content: JSON.stringify({ id: 'call-1', name: 'read_file', arguments: { path: 'x' } }),
				tool_name: 'read_file',
			}),
			row({ role: 'tool_result', seq: 4, content: 'file body', tool_name: 'read_file' }),
			row({ role: 'assistant', seq: 5, content: 'Done.' }),
		]);

		expect(entries.map((e) => e.kind)).toEqual([
			'token',
			'tool_call',
			'tool_result',
			'token',
		]);
		expect(entries.map((e) => e.seq)).toEqual([2, 3, 4, 5]);
	});

	it('round-trips a task tool_call so computeRenderBlocks can dispatch it as a task block', () => {
		// The shape produced here must match what the live SSE pipeline
		// produces for `tool_call` so the dispatcher can't tell the
		// difference. (This is the contract the merge relies on.)
		const entries = mapApiMessagesToEntries([
			row({
				role: 'tool_call',
				seq: 3,
				content: JSON.stringify({
					id: 'call-task-1',
					name: 'task',
					arguments: { description: 'Spawn child', agent_type: 'executor-high' },
				}),
				tool_name: 'task',
			}),
		]);

		expect(entries).toEqual([
			{
				kind: 'tool_call',
				id: 'call-task-1',
				name: 'task',
				arguments: { description: 'Spawn child', agent_type: 'executor-high' },
				seq: 3,
			},
		]);
	});
});

// ─── mergeHistoricalAndLive ──────────────────────────────────────────────────

describe('mergeHistoricalAndLive', () => {
	function token(seq: number, text: string): AgentRunTranscriptEntry {
		return { kind: 'token', text, seq };
	}

	it('returns live entries unchanged when historical has not loaded yet', () => {
		const live = [token(1, 'hi'), token(2, ' there')];
		const merged = mergeHistoricalAndLive({
			historical: [],
			live,
			liveBaselineLength: 0,
			historicalLoaded: false,
		});
		expect(merged).toBe(live); // same reference — pre-load behavior is identity
	});

	it('returns historical alone when no live entries arrived after the snapshot', () => {
		// Reload of a completed run: historical has everything, live is
		// either empty or fully covered by the baseline snapshot.
		const historical = [token(0, 'completed run output')];
		const merged = mergeHistoricalAndLive({
			historical,
			live: [token(0, 'completed run output')], // already in historical
			liveBaselineLength: 1,
			historicalLoaded: true,
		});
		expect(merged).toBe(historical); // unchanged reference when slice is empty
	});

	it('returns historical alone when live is empty after load', () => {
		// In-flight fetch resolves on a fresh navigation where no SSE
		// events have arrived yet.
		const historical = [token(0, 'persisted output')];
		const merged = mergeHistoricalAndLive({
			historical,
			live: [],
			liveBaselineLength: 0,
			historicalLoaded: true,
		});
		expect(merged).toEqual(historical);
	});

	it('appends live entries past the baseline onto the historical list', () => {
		// In-progress run: historical covers messages 0–2, two more
		// arrived via SSE after the fetch returned.
		const historical = [token(0, 'a'), token(1, 'b'), token(2, 'c')];
		const live = [
			token(0, 'a'),
			token(1, 'b'),
			token(2, 'c'),
			token(3, 'd'), // arrived after baseline
			token(4, 'e'),
		];
		const merged = mergeHistoricalAndLive({
			historical,
			live,
			liveBaselineLength: 3,
			historicalLoaded: true,
		});
		expect(merged.map((e) => (e.kind === 'token' ? e.text : e.kind))).toEqual([
			'a',
			'b',
			'c',
			'd',
			'e',
		]);
	});

	it('does not duplicate entries when liveBaselineLength matches live.length exactly', () => {
		// Baseline captured the full live array; nothing has arrived
		// since. The merge must NOT duplicate any historical content.
		const historical = [token(0, 'x'), token(1, 'y')];
		const live = [token(0, 'x'), token(1, 'y')];
		const merged = mergeHistoricalAndLive({
			historical,
			live,
			liveBaselineLength: 2,
			historicalLoaded: true,
		});
		expect(merged).toEqual(historical);
	});

	it('clamps a negative baseline to 0 (defensive — should never happen, but guarded)', () => {
		const historical = [token(0, 'h')];
		const live = [token(1, 'L1'), token(2, 'L2')];
		const merged = mergeHistoricalAndLive({
			historical,
			live,
			liveBaselineLength: -5,
			historicalLoaded: true,
		});
		// Negative baseline → entire live array is overflow. With both
		// historical and overflow, all four items render; first the
		// historical entry, then the two live entries.
		expect(merged.map((e) => (e.kind === 'token' ? e.text : e.kind))).toEqual([
			'h',
			'L1',
			'L2',
		]);
	});

	it('handles the in-flight race: baseline > 0 with live appending afterwards', () => {
		// Realistic scenario: when ChildRunView mounts, the project SSE
		// stream has already pushed a few entries into the store. The
		// fetch returns history that covers them; baseline = current
		// live.length; subsequent SSE entries are spliced cleanly.
		const historical = [token(0, 'persisted-1'), token(1, 'persisted-2')];
		// Live started with 2 entries that the historical covers...
		const liveAtSnapshot = [token(0, 'persisted-1'), token(1, 'persisted-2')];
		const baseline = liveAtSnapshot.length;
		// ...then more entries streamed in after the snapshot.
		const liveNow = [...liveAtSnapshot, token(2, 'new-3'), token(3, 'new-4')];

		const merged = mergeHistoricalAndLive({
			historical,
			live: liveNow,
			liveBaselineLength: baseline,
			historicalLoaded: true,
		});

		expect(merged).toHaveLength(4);
		expect(merged.map((e) => (e.kind === 'token' ? e.text : e.kind))).toEqual([
			'persisted-1',
			'persisted-2',
			'new-3',
			'new-4',
		]);
	});
});
