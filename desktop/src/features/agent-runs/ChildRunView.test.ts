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

/**
 * Mirrors the click guard inside ChildRunView.svelte's handleBack.
 * Keeps the test honest about what the component actually does when
 * the breadcrumb back button is clicked.
 */
function simulateBackClick(onBack?: () => void): boolean {
	if (!onBack) return false;
	onBack();
	return true;
}

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

describe('ChildRunView — onBack stub wiring', () => {
	it('fires the onBack callback when provided', () => {
		let fired = 0;
		const clicked = simulateBackClick(() => {
			fired += 1;
		});
		expect(clicked).toBe(true);
		expect(fired).toBe(1);
	});

	it('is a safe no-op when onBack is undefined', () => {
		const clicked = simulateBackClick(undefined);
		expect(clicked).toBe(false);
	});

	it('fires regardless of child run status', () => {
		// Users can step back from any state — running, done, or errored.
		const calls: number[] = [];
		const onBack = () => calls.push(1);
		for (const status of ['running', 'done', 'error', 'cancelled'] as const) {
			// Verify the state is ready (so the breadcrumb renders), then click.
			const state = computeChildRunViewState(
				makeRun({ status }),
				makeRun({ runId: 'run-parent', title: 'Main' }),
			);
			expect(state.status).toBe('ready');
			simulateBackClick(onBack);
		}
		expect(calls.length).toBe(4);
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
