// TaskToolCard tests.
//
// The project has no component renderer (no @testing-library/svelte in
// package.json), so these tests target the pure state/derivation module
// that powers every branch of TaskToolCard.svelte. Same pattern as
// AgentTaskCard.test.ts → agent-task-card-state.ts and
// ChildRunView.test.ts → child-run-view-state.ts.
//
// Covered cases for the MH4 acceptance criteria:
//   (a) Shows "Starting…" placeholder when no matching run is in the
//       store — i.e. resolveTaskToolCardChildRunId returns null.
//   (b) Resolves the child runId when a run whose title === the
//       tool-call description exists in agentRunsStore.runs.
//   (c) Passes the correct description and agentType through to
//       AgentTaskCard (verified by the extractor helpers the component
//       feeds into AgentTaskCard's `title` and `agentType` props).
//   (d) Wires onOpenChildRun to navigationStore.openChildRun (verified
//       via the store's exported callback contract — the component
//       literally invokes navigationStore.openChildRun(runId)).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import type { AgentRun } from '$lib/types/agent-run.js';
import type { ToolCallDisplay } from '../types.js';
import {
	DEFAULT_AGENT_TYPE,
	extractTaskAgentType,
	extractTaskDescription,
	resolveTaskToolCardChildRunId,
} from './task-tool-card-state.js';

// Read the .svelte source as text to verify wiring contracts that
// can't be exercised at runtime in a plain .ts test (Svelte's
// `$state`/`$derived` runes only resolve inside compiled components,
// so importing navigationStore from this test triggers a TDZ error —
// see the pre-existing navigation.svelte.test.ts failures).
const TASK_TOOL_CARD_SOURCE = readFileSync(
	join(import.meta.dir, 'TaskToolCard.svelte'),
	'utf8',
);

// ─── Fixtures ────────────────────────────────────────────────────────────────

const makeRun = (overrides: Partial<AgentRun> = {}): AgentRun => ({
	runId: 'run-child',
	sessionId: 'sess-1',
	projectId: 'proj-1',
	parentRunId: 'run-parent',
	agentType: 'executor',
	title: 'Refactor auth',
	status: 'running',
	contextMode: 'inherit_session',
	createdAt: '2026-04-19T00:00:00.000Z',
	startedAt: '2026-04-19T00:00:00.000Z',
	endedAt: null,
	errorMessage: null,
	...overrides,
});

const makeToolCall = (
	args: Record<string, unknown> = {},
	overrides: Partial<ToolCallDisplay> = {},
): ToolCallDisplay => ({
	id: 'tc-1',
	name: 'task',
	arguments: args,
	...overrides,
});

const indexById = (runs: AgentRun[]): Record<string, AgentRun> => {
	const out: Record<string, AgentRun> = {};
	for (const r of runs) out[r.runId] = r;
	return out;
};

// ─── (a) Placeholder branch ──────────────────────────────────────────────────

describe('TaskToolCard — placeholder branch (no matching run, no metadata)', () => {
	it('returns null when the store is empty and metadata is absent', () => {
		const resolved = resolveTaskToolCardChildRunId(
			makeToolCall({ description: 'Refactor auth' }),
			{},
		);
		expect(resolved).toBeNull();
	});

	it('returns null when no spawned run title matches the description', () => {
		const runs = indexById([
			makeRun({ runId: 'r-1', title: 'Other task' }),
			makeRun({ runId: 'r-2', title: 'Different work' }),
		]);
		const resolved = resolveTaskToolCardChildRunId(
			makeToolCall({ description: 'Refactor auth' }),
			runs,
		);
		expect(resolved).toBeNull();
	});

	it('never matches when description is empty and no metadata is present', () => {
		// Defensive: a run with an empty title must not collide with a
		// tool call whose description has not arrived yet and carries
		// no daemon metadata.
		const runs = indexById([makeRun({ runId: 'r-1', title: '' })]);
		const resolved = resolveTaskToolCardChildRunId(makeToolCall({}), runs);
		expect(resolved).toBeNull();
	});
});

// ─── (b) Metadata-first resolution (primary path) ────────────────────────────

describe('TaskToolCard — metadata-first resolution (tool_call_metadata event)', () => {
	const META = {
		runId: 'run-from-daemon',
		agentType: 'executor',
		title: 'Refactor auth',
	};

	it('resolves runId from toolCall.metadata.runId without touching the store', () => {
		const toolCall = makeToolCall({}, { metadata: { ...META } });
		// Empty store proves the title-match fallback is not needed.
		expect(resolveTaskToolCardChildRunId(toolCall, {})).toBe('run-from-daemon');
	});

	it('metadata runId wins over a conflicting title-match in the store', () => {
		// Two distinct runs carry the same title (a hypothetical
		// collision). The daemon-supplied metadata must win so the
		// card navigates to the run the daemon actually spawned.
		const runs = indexById([
			makeRun({ runId: 'r-collision', title: 'Refactor auth' }),
		]);
		const toolCall = makeToolCall(
			{ description: 'Refactor auth' },
			{ metadata: { ...META, runId: 'run-from-daemon' } },
		);
		expect(resolveTaskToolCardChildRunId(toolCall, runs)).toBe(
			'run-from-daemon',
		);
	});

	it('falls back to title-match when metadata is absent (replay / slow arrival)', () => {
		// Replayed sessions don't re-emit tool_call_metadata, and the
		// project SSE can hydrate the runs store before the chat SSE
		// delivers the metadata frame. The fallback must still work.
		const runs = indexById([
			makeRun({ runId: 'r-fallback', title: 'Refactor auth' }),
		]);
		const toolCall = makeToolCall({ description: 'Refactor auth' });
		expect(resolveTaskToolCardChildRunId(toolCall, runs)).toBe('r-fallback');
	});

	it('ignores empty metadata.runId and falls through to title-match', () => {
		// Defensive: a malformed metadata event with an empty runId
		// should not "win" over a valid title-match.
		const runs = indexById([
			makeRun({ runId: 'r-fallback', title: 'Refactor auth' }),
		]);
		const toolCall = makeToolCall(
			{ description: 'Refactor auth' },
			{ metadata: { ...META, runId: '' } },
		);
		expect(resolveTaskToolCardChildRunId(toolCall, runs)).toBe('r-fallback');
	});
});

// ─── (c) Title-match fallback branch ─────────────────────────────────────────

describe('TaskToolCard — title-match fallback (no metadata)', () => {
	it('resolves to the runId of the run whose title matches the description', () => {
		const runs = indexById([
			makeRun({ runId: 'r-other', title: 'Different work' }),
			makeRun({ runId: 'r-target', title: 'Refactor auth' }),
		]);
		const toolCall = makeToolCall({ description: 'Refactor auth' });
		expect(resolveTaskToolCardChildRunId(toolCall, runs)).toBe('r-target');
	});

	it('resolves correctly across the full run lifecycle (running, done, error)', () => {
		// AgentTaskCard handles status rendering — the adapter only needs
		// to surface the runId regardless of terminal state so users can
		// click through to inspect transcripts post-completion.
		for (const status of ['running', 'done', 'error', 'cancelled'] as const) {
			const runs = indexById([
				makeRun({ runId: 'r-x', title: 'Refactor auth', status }),
			]);
			const toolCall = makeToolCall({ description: 'Refactor auth' });
			expect(resolveTaskToolCardChildRunId(toolCall, runs)).toBe('r-x');
		}
	});

	it('returns the first match when descriptions collide (oldest spawn wins)', () => {
		// Documented trade-off: identical descriptions are rare in
		// practice (prompts are effectively unique). When they do
		// collide, the iteration order is the insertion order of the
		// store's record map — first match wins, matching the
		// transcript-blocks tier-2 fallback's behaviour.
		const runs = indexById([
			makeRun({ runId: 'r-first', title: 'Refactor auth' }),
			makeRun({ runId: 'r-second', title: 'Refactor auth' }),
		]);
		const toolCall = makeToolCall({ description: 'Refactor auth' });
		expect(resolveTaskToolCardChildRunId(toolCall, runs)).toBe('r-first');
	});
});

// ─── (d) Prop pass-through to AgentTaskCard ──────────────────────────────────

describe('TaskToolCard — passes description and agentType through to AgentTaskCard', () => {
	it('extracts the description string from tool-call arguments', () => {
		const toolCall = makeToolCall({
			description: 'Refactor auth',
			agent_type: 'executor',
		});
		expect(extractTaskDescription(toolCall)).toBe('Refactor auth');
	});

	it('extracts the agent_type string from tool-call arguments', () => {
		const toolCall = makeToolCall({
			description: 'Refactor auth',
			agent_type: 'executor',
		});
		expect(extractTaskAgentType(toolCall)).toBe('executor');
	});

	it('falls back to metadata.title when arguments.description is absent', () => {
		// Mid-stream arguments can be empty even after metadata has
		// landed (metadata arrives at spawn time, independent of
		// JSON streaming). Surface the metadata title so the card
		// has a label to render.
		const toolCall = makeToolCall(
			{},
			{
				metadata: {
					runId: 'r-1',
					agentType: 'executor',
					title: 'Refactor auth',
				},
			},
		);
		expect(extractTaskDescription(toolCall)).toBe('Refactor auth');
	});

	it('falls back to metadata.agentType when arguments.agent_type is absent', () => {
		const toolCall = makeToolCall(
			{},
			{
				metadata: {
					runId: 'r-1',
					agentType: 'researcher',
					title: 'Refactor auth',
				},
			},
		);
		expect(extractTaskAgentType(toolCall)).toBe('researcher');
	});

	it('arguments win over metadata when both are present', () => {
		// Arguments reflect the exact model-emitted text and stay in
		// sync with the transcript. Metadata mirrors the same values
		// in practice, but on the rare occasion they diverge (e.g.
		// testing) the arguments are the user-visible source of truth.
		const toolCall = makeToolCall(
			{ description: 'Args title', agent_type: 'executor' },
			{
				metadata: {
					runId: 'r-1',
					agentType: 'researcher',
					title: 'Meta title',
				},
			},
		);
		expect(extractTaskDescription(toolCall)).toBe('Args title');
		expect(extractTaskAgentType(toolCall)).toBe('executor');
	});

	it('falls back to a safe blank description when arguments are mid-stream and no metadata', () => {
		// While the model is still emitting tool-call JSON and the
		// metadata event has not yet landed, the placeholder branch
		// needs an empty string (not undefined) so the optional-chain
		// reads don't throw.
		expect(extractTaskDescription(makeToolCall({}))).toBe('');
		expect(extractTaskDescription(makeToolCall({ description: 42 }))).toBe('');
		expect(
			extractTaskDescription(makeToolCall({ description: null })),
		).toBe('');
	});

	it('falls back to "agent" when both arguments and metadata are missing agent_type', () => {
		// AgentTaskCard's icon/aria-label remain sensible mid-stream
		// thanks to this default.
		expect(extractTaskAgentType(makeToolCall({}))).toBe(DEFAULT_AGENT_TYPE);
		expect(extractTaskAgentType(makeToolCall({ agent_type: 0 }))).toBe(
			DEFAULT_AGENT_TYPE,
		);
		expect(DEFAULT_AGENT_TYPE).toBe('agent');
	});
});

// ─── (d) onOpenChildRun callback wiring ──────────────────────────────────────

describe('TaskToolCard — onOpenChildRun wiring (navigationStore)', () => {
	// The component must wire AgentTaskCard's onOpenChildRun prop to
	// navigationStore.openChildRun. We verify this against the component
	// source rather than via runtime invocation because (a) the test
	// has no component renderer and (b) importing navigationStore in a
	// plain .ts test triggers a Svelte runes TDZ error.
	//
	// AgentTaskCard.test.ts already covers the click-fires-callback
	// behaviour for AgentTaskCard itself; this suite covers the
	// adapter's responsibility to plug the right callback in.

	it('imports navigationStore from the canonical store module', () => {
		expect(TASK_TOOL_CARD_SOURCE).toMatch(
			/import\s*\{\s*navigationStore\s*\}\s*from\s*['"]\$lib\/stores\/navigation\.svelte\.js['"]/,
		);
	});

	it('passes onOpenChildRun as a prop to AgentTaskCard', () => {
		expect(TASK_TOOL_CARD_SOURCE).toContain('onOpenChildRun=');
	});

	it('invokes navigationStore.openChildRun inside the click handler', () => {
		// The handler delegates 1:1 to the store so the chat surface and
		// the agent-runs surface share a single navigation entry point.
		expect(TASK_TOOL_CARD_SOURCE).toMatch(
			/navigationStore\.openChildRun\s*\(\s*runId\s*\)/,
		);
	});

	it('forwards the resolved runId (not a hardcoded value) to AgentTaskCard', () => {
		// Defensive: catch a future regression where someone wires a
		// stub like onOpenChildRun={() => {}} or a literal id.
		expect(TASK_TOOL_CARD_SOURCE).toMatch(
			/onOpenChildRun=\{handleOpenChildRun\}/,
		);
		// Svelte shorthand: `{resolvedRunId}` is equivalent to
		// `resolvedRunId={resolvedRunId}` — accept either form.
		expect(TASK_TOOL_CARD_SOURCE).toMatch(
			/(?:resolvedRunId=\{resolvedRunId\}|\{resolvedRunId\})/,
		);
	});
});
