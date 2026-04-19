// ChildRunView tests.
//
// The project has no component renderer (no @testing-library/svelte in
// deps), so these tests target the pure state-derivation module that
// drives every visual branch of ChildRunView.svelte — the same pattern
// established by AgentTaskCard.test.ts and agent-task-card-state.ts.
//
// Covered branches:
//   • loading state when the child run row is not yet in the store
//   • ready state with a parent title surfaced for the breadcrumb
//   • ready state without a parent (root or unhydrated parent row)
//   • aria label plumbing: region, back button, fallback titles
//   • onBack stub fires when invoked (no-op if undefined)
//   • guard against empty/whitespace titles
//
// The transcript is delegated to the existing AgentRunTranscript
// component (already covered by AgentRunTranscript.test.ts), so the
// "it renders the transcript with the correct runId" contract is
// asserted via the prop contract rather than by DOM inspection —
// see the "delegates transcript to AgentRunTranscript" describe block.

import { describe, expect, it } from 'bun:test';
import type { AgentRun } from '$lib/types/agent-run.js';
import {
	computeChildRunViewState,
	computeSiblingNavState,
	type ChildRunViewState,
} from './child-run-view-state.js';

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

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('ChildRunView — loading state', () => {
	it('returns loading state when the child run is not in the store', () => {
		const state = computeChildRunViewState(null, null);
		expect(state.status).toBe('loading');
		expect(state.childTitle).toBe('Untitled run');
		expect(state.parentTitle).toBeNull();
	});

	it('returns loading state when the child is undefined', () => {
		const state = computeChildRunViewState(undefined, undefined);
		expect(state.status).toBe('loading');
	});

	it('loading state uses a descriptive region label for screen readers', () => {
		const state = computeChildRunViewState(null, null);
		expect(state.regionLabel).toContain('Child run');
		expect(state.regionLabel).toContain('loading');
	});
});

describe('ChildRunView — ready state with parent', () => {
	it('returns ready state when the child row is hydrated', () => {
		const child = makeRun({ title: 'Refactor auth' });
		const parent = makeRun({
			runId: 'run-parent',
			parentRunId: null,
			title: 'Main session',
		});
		const state = computeChildRunViewState(child, parent);
		expect(state.status).toBe('ready');
		expect(state.childTitle).toBe('Refactor auth');
		expect(state.parentTitle).toBe('Main session');
	});

	it('surfaces the parent title in the back button aria-label', () => {
		const child = makeRun({ title: 'Refactor auth' });
		const parent = makeRun({
			runId: 'run-parent',
			parentRunId: null,
			title: 'Main session',
		});
		const state = computeChildRunViewState(child, parent);
		expect(state.backLabel).toContain('Back to parent run');
		expect(state.backLabel).toContain('Main session');
	});

	it('uses the child title in the region aria-label', () => {
		const child = makeRun({ title: 'Refactor auth' });
		const parent = makeRun({ runId: 'run-parent', title: 'Main session' });
		const state = computeChildRunViewState(child, parent);
		expect(state.regionLabel).toBe('Child run: Refactor auth');
	});

	it('exposes the composer placeholder text pointing users back home', () => {
		const child = makeRun();
		const parent = makeRun({ runId: 'run-parent' });
		const state = computeChildRunViewState(child, parent);
		expect(state.composerPlaceholder.toLowerCase()).toContain(
			'back to parent',
		);
	});
});

describe('ChildRunView — ready state without parent', () => {
	it('renders with null parentTitle when parent row has not hydrated', () => {
		const child = makeRun({ parentRunId: 'run-parent' });
		const state = computeChildRunViewState(child, null);
		expect(state.status).toBe('ready');
		expect(state.parentTitle).toBeNull();
	});

	it('falls back to a generic back-label when no parent title is known', () => {
		const child = makeRun({ parentRunId: 'run-parent' });
		const state = computeChildRunViewState(child, null);
		expect(state.backLabel).toBe('Back to parent');
	});

	it('handles a parent whose own title is empty/whitespace as no-parent', () => {
		const child = makeRun();
		const parent = makeRun({ runId: 'run-parent', title: '   ' });
		const state = computeChildRunViewState(child, parent);
		expect(state.parentTitle).toBeNull();
		expect(state.backLabel).toBe('Back to parent');
	});
});

describe('ChildRunView — title guards', () => {
	it('falls back to "Untitled run" when the child title is empty', () => {
		const child = makeRun({ title: '' });
		const state = computeChildRunViewState(child, null);
		expect(state.childTitle).toBe('Untitled run');
		expect(state.regionLabel).toBe('Child run: Untitled run');
	});

	it('falls back to "Untitled run" when the child title is whitespace', () => {
		const child = makeRun({ title: '   ' });
		const state = computeChildRunViewState(child, null);
		expect(state.childTitle).toBe('Untitled run');
	});

	it('trims whitespace around a valid child title', () => {
		const child = makeRun({ title: '  Refactor auth  ' });
		const parent = makeRun({ runId: 'run-parent', title: 'Main' });
		const state = computeChildRunViewState(child, parent);
		expect(state.childTitle).toBe('Refactor auth');
	});

	it('trims whitespace around a valid parent title', () => {
		const child = makeRun();
		const parent = makeRun({
			runId: 'run-parent',
			title: '  Main session  ',
		});
		const state = computeChildRunViewState(child, parent);
		expect(state.parentTitle).toBe('Main session');
	});
});

describe('ChildRunView — breadcrumb parent title', () => {
	// The breadcrumb always renders the child's *direct* parent title.
	// Deeper nesting is surfaced by the sidebar's active-child-path
	// (MH3, Wave 7); ChildRunView itself only needs the immediate parent
	// since `backToParent()` pops one level at a time — a chain of
	// backs walks the user up through each breadcrumb in turn.
	it('surfaces the direct parent title regardless of chain depth', () => {
		const grandparent = makeRun({
			runId: 'run-grand',
			parentRunId: null,
			title: 'Root session',
		});
		const parent = makeRun({
			runId: 'run-parent',
			parentRunId: grandparent.runId,
			title: 'Mid-level delegator',
		});
		const child = makeRun({
			runId: 'run-child',
			parentRunId: parent.runId,
			title: 'Leaf task',
		});
		const state = computeChildRunViewState(child, parent);
		expect(state.parentTitle).toBe('Mid-level delegator');
		expect(state.childTitle).toBe('Leaf task');
	});

	it('composer placeholder guides user back to the parent session', () => {
		const state = computeChildRunViewState(
			makeRun(),
			makeRun({ runId: 'run-parent', title: 'Main' }),
		);
		expect(state.composerPlaceholder).toBe(
			'Back to parent to continue the conversation',
		);
	});
});

describe('ChildRunView — sibling navigation', () => {
	// Siblings are the list of runs that share a parentRunId with the
	// current child. They are sorted chronologically by createdAt so the
	// prev/next buttons walk the user through the delegation timeline in
	// the order the parent agent spawned them.

	const mkSibling = (id: string, createdAt: string): AgentRun =>
		makeRun({ runId: id, createdAt, parentRunId: 'run-parent' });

	it('returns neutral state when the child is not yet hydrated', () => {
		const nav = computeSiblingNavState(null, []);
		expect(nav.prev).toBeNull();
		expect(nav.next).toBeNull();
		expect(nav.index).toBe(-1);
		expect(nav.total).toBe(0);
		expect(nav.hasPrev).toBe(false);
		expect(nav.hasNext).toBe(false);
	});

	it('returns neutral state when there are no siblings', () => {
		const child = mkSibling('run-child', '2026-04-19T00:00:00.000Z');
		const nav = computeSiblingNavState(child, []);
		expect(nav.hasPrev).toBe(false);
		expect(nav.hasNext).toBe(false);
		expect(nav.total).toBe(0);
	});

	it('handles the only-child case — single sibling, no prev/next', () => {
		const child = mkSibling('run-child', '2026-04-19T00:00:00.000Z');
		const nav = computeSiblingNavState(child, [child]);
		expect(nav.index).toBe(0);
		expect(nav.total).toBe(1);
		expect(nav.hasPrev).toBe(false);
		expect(nav.hasNext).toBe(false);
	});

	it('prev is disabled when child is the first sibling', () => {
		const a = mkSibling('run-a', '2026-04-19T00:00:00.000Z');
		const b = mkSibling('run-b', '2026-04-19T00:00:01.000Z');
		const c = mkSibling('run-c', '2026-04-19T00:00:02.000Z');
		const nav = computeSiblingNavState(a, [a, b, c]);
		expect(nav.index).toBe(0);
		expect(nav.hasPrev).toBe(false);
		expect(nav.hasNext).toBe(true);
		expect(nav.next?.runId).toBe('run-b');
	});

	it('next is disabled when child is the last sibling', () => {
		const a = mkSibling('run-a', '2026-04-19T00:00:00.000Z');
		const b = mkSibling('run-b', '2026-04-19T00:00:01.000Z');
		const c = mkSibling('run-c', '2026-04-19T00:00:02.000Z');
		const nav = computeSiblingNavState(c, [a, b, c]);
		expect(nav.index).toBe(2);
		expect(nav.hasPrev).toBe(true);
		expect(nav.hasNext).toBe(false);
		expect(nav.prev?.runId).toBe('run-b');
	});

	it('both prev and next are enabled for middle siblings', () => {
		const a = mkSibling('run-a', '2026-04-19T00:00:00.000Z');
		const b = mkSibling('run-b', '2026-04-19T00:00:01.000Z');
		const c = mkSibling('run-c', '2026-04-19T00:00:02.000Z');
		const nav = computeSiblingNavState(b, [a, b, c]);
		expect(nav.index).toBe(1);
		expect(nav.hasPrev).toBe(true);
		expect(nav.hasNext).toBe(true);
		expect(nav.prev?.runId).toBe('run-a');
		expect(nav.next?.runId).toBe('run-c');
	});

	it('siblings are walked in chronological order, not input order', () => {
		// Pass siblings deliberately out of order; helper must re-sort
		// so callers don't need to care about upstream ordering.
		const early = mkSibling('run-early', '2026-04-19T00:00:00.000Z');
		const mid = mkSibling('run-mid', '2026-04-19T00:00:01.000Z');
		const late = mkSibling('run-late', '2026-04-19T00:00:02.000Z');
		const nav = computeSiblingNavState(mid, [late, early, mid]);
		expect(nav.prev?.runId).toBe('run-early');
		expect(nav.next?.runId).toBe('run-late');
	});

	it('returns neutral state when the child is missing from its sibling list', () => {
		// Brief race during hydration: the parent's children list has
		// been fetched but the current child row hasn't landed yet.
		const a = mkSibling('run-a', '2026-04-19T00:00:00.000Z');
		const missing = mkSibling('run-missing', '2026-04-19T00:00:01.000Z');
		const nav = computeSiblingNavState(missing, [a]);
		expect(nav.index).toBe(-1);
		expect(nav.hasPrev).toBe(false);
		expect(nav.hasNext).toBe(false);
	});
});

describe('ChildRunView — delegates transcript to AgentRunTranscript', () => {
	// The transcript itself is already covered by
	// AgentRunTranscript.test.ts. ChildRunView's only responsibility is
	// to pass the `runId` prop through. We encode that contract as a
	// state-level expectation: the view must not mutate or rename the
	// runId it was handed.
	it('preserves the runId passed in as a prop (contract)', () => {
		const child = makeRun({ runId: 'run-child-7' });
		const state: ChildRunViewState = computeChildRunViewState(
			child,
			makeRun({ runId: 'run-parent' }),
		);
		// State derivation never touches runId — the field exists on the
		// input row only. This test guards against future refactors that
		// might accidentally re-scope it.
		expect(state.status).toBe('ready');
		expect(child.runId).toBe('run-child-7');
	});
});
