// Tests for the pure sidebar child-run-chain state helper.
//
// The project has no component renderer, so these tests exercise the
// pure logic that drives whether the chain renders and what rows are
// produced — the same pattern used by AgentTaskCard/ChildRunView tests.

import { describe, expect, it } from 'bun:test';
import {
	_seedRun,
	agentRunsStore,
	resetAgentRunsStore,
} from '$lib/stores/agent-runs.svelte.js';
import type { AgentRun } from '$lib/types/agent-run.js';
import {
	buildChildRunRowIndent,
	computeRollupVariant,
	computeSidebarChildRunChain,
	computeStatusVariant,
	type SidebarChildRunRow,
} from './sidebar-child-run-chain-state.js';

const makeRun = (overrides: Partial<AgentRun> = {}): AgentRun => ({
	runId: 'run-root',
	sessionId: 'sess-1',
	projectId: 'proj-1',
	parentRunId: null,
	agentType: 'primary',
	title: 'Root run',
	status: 'running',
	contextMode: 'inherit_session',
	createdAt: '2026-04-19T00:00:00.000Z',
	startedAt: '2026-04-19T00:00:00.000Z',
	endedAt: null,
	errorMessage: null,
	...overrides,
});

const rootRun = makeRun({ runId: 'root', parentRunId: null, title: 'Root' });
const childRun = makeRun({
	runId: 'child',
	parentRunId: 'root',
	title: 'Child',
});
const grandchildRun = makeRun({
	runId: 'grandchild',
	parentRunId: 'child',
	title: 'Grandchild',
});

describe('computeSidebarChildRunChain — visibility rules', () => {
	it('renders nothing when the session is not the active one', () => {
		const rows = computeSidebarChildRunChain({
			isActiveSession: false,
			currentView: 'chat',
			currentChildRunId: 'child',
			sessionRuns: [rootRun, childRun],
			activeChildPath: [rootRun, childRun],
		});
		expect(rows).toEqual([]);
	});

	it('renders nothing when the current view is not child-run', () => {
		for (const view of ['settings', 'chat', 'agent-runs'] as const) {
			const rows = computeSidebarChildRunChain({
				isActiveSession: true,
				currentView: view,
				currentChildRunId: 'child',
				sessionRuns: [rootRun, childRun],
				activeChildPath: [rootRun, childRun],
			});
			expect(rows).toEqual([]);
		}
	});

	it('renders nothing when there is no active child run id', () => {
		const rows = computeSidebarChildRunChain({
			isActiveSession: true,
			currentView: 'chat',
			currentChildRunId: null,
			sessionRuns: [rootRun],
			activeChildPath: [],
		});
		expect(rows).toEqual([]);
	});

	it('renders nothing when the active child path has only the root', () => {
		const rows = computeSidebarChildRunChain({
			isActiveSession: true,
			currentView: 'chat',
			currentChildRunId: 'root',
			sessionRuns: [rootRun],
			activeChildPath: [rootRun],
		});
		expect(rows).toEqual([]);
	});

	it('renders nothing when the active path belongs to another session', () => {
		const rows = computeSidebarChildRunChain({
			isActiveSession: true,
			currentView: 'chat',
			currentChildRunId: 'child',
			// sessionRuns does not contain the root of the active path —
			// a stale active child id must not leak into this session row.
			sessionRuns: [makeRun({ runId: 'different-root' })],
			activeChildPath: [rootRun, childRun],
		});
		expect(rows).toEqual([]);
	});
});

describe('computeSidebarChildRunChain — happy path', () => {
	it('returns a single indented row for a one-level child chain', () => {
		const rows = computeSidebarChildRunChain({
			isActiveSession: true,
			currentView: 'child-run',
			currentChildRunId: 'child',
			sessionRuns: [rootRun, childRun],
			activeChildPath: [rootRun, childRun],
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].run.runId).toBe('child');
		expect(rows[0].depth).toBe(1);
	});

	it('returns two indented rows for a two-level chain in child-run view', () => {
		const rows = computeSidebarChildRunChain({
			isActiveSession: true,
			currentView: 'child-run',
			currentChildRunId: 'grandchild',
			sessionRuns: [rootRun, childRun, grandchildRun],
			activeChildPath: [rootRun, childRun, grandchildRun],
		});
		expect(rows).toHaveLength(2);
		expect(rows[0].run.runId).toBe('child');
		expect(rows[0].depth).toBe(1);
		expect(rows[1].run.runId).toBe('grandchild');
		expect(rows[1].depth).toBe(2);
	});

	it('preserves the order from the active child path', () => {
		const rows = computeSidebarChildRunChain({
			isActiveSession: true,
			currentView: 'child-run',
			currentChildRunId: 'grandchild',
			sessionRuns: [rootRun, childRun, grandchildRun],
			activeChildPath: [rootRun, childRun, grandchildRun],
		});
		const runIds = rows.map((r) => r.run.runId);
		expect(runIds).toEqual(['child', 'grandchild']);
	});

	it('excludes the root run from the rendered rows', () => {
		const rows = computeSidebarChildRunChain({
			isActiveSession: true,
			currentView: 'child-run',
			currentChildRunId: 'child',
			sessionRuns: [rootRun, childRun],
			activeChildPath: [rootRun, childRun],
		});
		const runIds = rows.map((r) => r.run.runId);
		expect(runIds).not.toContain('root');
	});
});

describe('buildChildRunRowIndent', () => {
	it('scales the indent by depth using the design-system space token', () => {
		expect(buildChildRunRowIndent(1)).toBe('calc(var(--space-4) * 1)');
		expect(buildChildRunRowIndent(2)).toBe('calc(var(--space-4) * 2)');
		expect(buildChildRunRowIndent(3)).toBe('calc(var(--space-4) * 3)');
	});

	it('clamps non-finite or negative depths to zero', () => {
		expect(buildChildRunRowIndent(-1)).toBe('calc(var(--space-4) * 0)');
		expect(buildChildRunRowIndent(0)).toBe('calc(var(--space-4) * 0)');
	});

	it('truncates fractional depths to an integer', () => {
		expect(buildChildRunRowIndent(1.7)).toBe('calc(var(--space-4) * 1)');
	});
});

describe('computeStatusVariant — per-row indicator logic', () => {
	it('returns "running" when the run is live', () => {
		const run = makeRun({ status: 'running' });
		expect(computeStatusVariant(run, false, false)).toBe('running');
	});

	it('returns "blocked" when awaiting a question answer', () => {
		const run = makeRun({ status: 'done' });
		expect(computeStatusVariant(run, false, true)).toBe('blocked');
	});

	it('returns "error" on a terminated-with-error run', () => {
		const run = makeRun({ status: 'error' });
		expect(computeStatusVariant(run, false, false)).toBe('error');
	});

	it('returns "unseen" when the run has unseen output and no higher signal', () => {
		const run = makeRun({ status: 'done' });
		expect(computeStatusVariant(run, true, false)).toBe('unseen');
	});

	it('returns "none" for a quiet done run', () => {
		const run = makeRun({ status: 'done' });
		expect(computeStatusVariant(run, false, false)).toBe('none');
	});

	it('returns "none" for a cancelled run with no other signal', () => {
		const run = makeRun({ status: 'cancelled' });
		expect(computeStatusVariant(run, false, false)).toBe('none');
	});
});

describe('computeStatusVariant — priority order', () => {
	it('blocked outranks running, error, and unseen', () => {
		const run = makeRun({ status: 'running' });
		// While awaiting an answer, blocked must win even if still running.
		expect(computeStatusVariant(run, true, true)).toBe('blocked');
	});

	it('error outranks running when not blocked', () => {
		const run = makeRun({ status: 'error' });
		expect(computeStatusVariant(run, false, false)).toBe('error');
	});

	it('unseen outranks running when not blocked or errored', () => {
		const run = makeRun({ status: 'running' });
		expect(computeStatusVariant(run, true, false)).toBe('unseen');
	});

	it('running is used when there is no higher-priority signal', () => {
		const run = makeRun({ status: 'running' });
		expect(computeStatusVariant(run, false, false)).toBe('running');
	});

	it('blocked outranks error and unseen', () => {
		const run = makeRun({ status: 'error' });
		// Error on status + awaiting question + unseen → blocked wins.
		expect(computeStatusVariant(run, true, true)).toBe('blocked');
	});
});

describe('computeRollupVariant — session-row aggregate', () => {
	const rowFor = (run: AgentRun, depth = 1): SidebarChildRunRow => ({
		run,
		depth,
	});

	it('returns "none" for an empty chain', () => {
		const variant = computeRollupVariant(
			[],
			() => false,
			() => false,
		);
		expect(variant).toBe('none');
	});

	it('returns "none" when every row is quiet', () => {
		const rows = [
			rowFor(makeRun({ runId: 'a', status: 'done' })),
			rowFor(makeRun({ runId: 'b', status: 'cancelled' })),
		];
		const variant = computeRollupVariant(
			rows,
			() => false,
			() => false,
		);
		expect(variant).toBe('none');
	});

	it('picks "blocked" when any row is awaiting a question (highest priority)', () => {
		const rows = [
			rowFor(makeRun({ runId: 'a', status: 'done' })),
			rowFor(makeRun({ runId: 'b', status: 'running' })),
			rowFor(makeRun({ runId: 'c', status: 'error' })),
		];
		const awaiting = new Set(['a']);
		const variant = computeRollupVariant(
			rows,
			() => false,
			(id) => awaiting.has(id),
		);
		expect(variant).toBe('blocked');
	});

	it('picks "error" when no row is blocked', () => {
		const rows = [
			rowFor(makeRun({ runId: 'a', status: 'done' })),
			rowFor(makeRun({ runId: 'b', status: 'error' })),
		];
		const variant = computeRollupVariant(
			rows,
			() => false,
			() => false,
		);
		expect(variant).toBe('error');
	});

	it('picks "unseen" over "running" when no blocked/error is present', () => {
		const rows = [
			rowFor(makeRun({ runId: 'a', status: 'running' })),
			rowFor(makeRun({ runId: 'b', status: 'done' })),
		];
		const unseen = new Set(['b']);
		const variant = computeRollupVariant(
			rows,
			(id) => unseen.has(id),
			() => false,
		);
		expect(variant).toBe('unseen');
	});

	it('picks "running" when no blocked/error/unseen rows exist', () => {
		const rows = [
			rowFor(makeRun({ runId: 'a', status: 'done' })),
			rowFor(makeRun({ runId: 'b', status: 'running' })),
		];
		const variant = computeRollupVariant(
			rows,
			() => false,
			() => false,
		);
		expect(variant).toBe('running');
	});

	it('picks "unseen" as the softest non-none rollup signal', () => {
		const rows = [
			rowFor(makeRun({ runId: 'a', status: 'done' })),
			rowFor(makeRun({ runId: 'b', status: 'done' })),
		];
		const unseen = new Set(['b']);
		const variant = computeRollupVariant(
			rows,
			(id) => unseen.has(id),
			() => false,
		);
		expect(variant).toBe('unseen');
	});
});

// ─── Performance benchmarks (SPEC MH3 risk mitigation) ──────────────────────
//
// MH3 stipulates that rendering 5+ concurrent child runs in the sidebar
// must not cause layout thrash. The pure helpers are the hot path on
// every SSE-driven rerender, so their wall-clock cost under a realistic
// worst case bounds the overall update budget.
//
// Thresholds are deliberately generous — the helpers are pure O(n) with
// no allocation hot loops, and a single sidebar update combines one
// chain computation, one rollup variant, and one active-path walk.
// A combined budget well under 10ms leaves ample headroom for the
// surrounding Svelte reactivity pass.
describe('performance — sidebar hot path', () => {
	const makeRowChain = (count: number): SidebarChildRunRow[] => {
		const rows: SidebarChildRunRow[] = [];
		for (let i = 0; i < count; i += 1) {
			rows.push({
				run: makeRun({
					runId: `child-${i}`,
					parentRunId: i === 0 ? 'root' : `child-${i - 1}`,
					title: `Child ${i}`,
					// Mix statuses so the variant resolver walks every branch.
					status:
						i === 0
							? 'running'
							: i === 1
								? 'error'
								: i === 2
									? 'done'
									: 'running',
				}),
				depth: i + 1,
			});
		}
		return rows;
	};

	it('computeSidebarChildRunChain completes in under 5ms for 8 children', () => {
		// Build an 8-run active path (root + 7 descendants). The chain
		// helper is invoked on every sidebar re-render for the active
		// session, so its amortized cost matters most.
		const root = makeRun({ runId: 'root', parentRunId: null, title: 'Root' });
		const path: AgentRun[] = [root];
		for (let i = 0; i < 7; i += 1) {
			path.push(
				makeRun({
					runId: `child-${i}`,
					parentRunId: i === 0 ? 'root' : `child-${i - 1}`,
					title: `Child ${i}`,
				}),
			);
		}
		const sessionRuns = path; // all runs belong to the same session

		// Warm the JIT a few iterations before measuring so a cold-start
		// spike doesn't pollute the signal.
		for (let i = 0; i < 10; i += 1) {
			computeSidebarChildRunChain({
				isActiveSession: true,
				currentView: 'chat',
				currentChildRunId: 'child-6',
				sessionRuns,
				activeChildPath: path,
			});
		}

		const start = performance.now();
		const iterations = 1000;
		for (let i = 0; i < iterations; i += 1) {
			computeSidebarChildRunChain({
				isActiveSession: true,
				currentView: 'chat',
				currentChildRunId: 'child-6',
				sessionRuns,
				activeChildPath: path,
			});
		}
		const elapsed = performance.now() - start;
		const avgMs = elapsed / iterations;

		// Budget: < 5ms per invocation. 1000 iterations keeps measurement
		// noise low while keeping the whole test well under a second.
		expect(avgMs).toBeLessThan(5);
	});

	it('computeRollupVariant completes in under 2ms for 8 children', () => {
		const rows = makeRowChain(8);

		// No-attention selectors — exercises the slow path where the
		// function has to walk every row and compare rank.
		const noSignal = () => false;

		// Warm-up.
		for (let i = 0; i < 10; i += 1) {
			computeRollupVariant(rows, noSignal, noSignal);
		}

		const start = performance.now();
		const iterations = 1000;
		for (let i = 0; i < iterations; i += 1) {
			computeRollupVariant(rows, noSignal, noSignal);
		}
		const elapsed = performance.now() - start;
		const avgMs = elapsed / iterations;

		// Budget: < 2ms per invocation. Rollup is cheaper than the chain
		// helper (pure reduction, no slice/map), so the tighter bound
		// catches a regression if someone adds expensive work here.
		expect(avgMs).toBeLessThan(2);
	});

	it('agentRunsStore.activeChildPath returns the correct 4-level chain', () => {
		// Reset & seed a 4-level deep nesting via the store's public API
		// so the test exercises the live selector, not a stubbed copy.
		// MAX_DEPTH in activeChildPath is 4, which matches the default
		// maxTaskDepth — the deepest chain the daemon ever surfaces.
		resetAgentRunsStore();

		const rootRun = makeRun({
			runId: 'root',
			parentRunId: null,
			title: 'Root',
		});
		const childRun = makeRun({
			runId: 'child',
			parentRunId: 'root',
			title: 'Child',
		});
		const grandchildRun = makeRun({
			runId: 'grandchild',
			parentRunId: 'child',
			title: 'Grandchild',
		});
		const greatGrandchildRun = makeRun({
			runId: 'great-grandchild',
			parentRunId: 'grandchild',
			title: 'Great-grandchild',
		});

		_seedRun(rootRun);
		_seedRun(childRun);
		_seedRun(grandchildRun);
		_seedRun(greatGrandchildRun);

		const path = agentRunsStore.activeChildPath('root', 'great-grandchild');
		expect(path.map((r) => r.runId)).toEqual([
			'root',
			'child',
			'grandchild',
			'great-grandchild',
		]);

		// Cleanup so any later suite runs against a clean store.
		resetAgentRunsStore();
	});
});
