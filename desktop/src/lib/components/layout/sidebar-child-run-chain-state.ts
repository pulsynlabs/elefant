// Pure helpers for the Sidebar active-child-run chain (MH3).
//
// When a child run is the active view in the main pane, the sidebar
// surfaces the ancestor chain — from the session's root run down to the
// active child — as indented rows directly underneath the active
// session's row. Only the active path is rendered (not the full
// forest), matching the OpenCode sidebar pattern.
//
// This module is intentionally pure so every visual branch can be
// unit-tested without a component renderer (same pattern established by
// agent-task-card-state.ts and child-run-view-state.ts).

import type { AgentRun } from '$lib/types/agent-run.js';

/** A row to render under the session, with its indent depth. */
export interface SidebarChildRunRow {
	run: AgentRun;
	/** 1 for direct children of the session root, 2 for grandchildren, etc. */
	depth: number;
}

/**
 * Visual status indicator variant for a sidebar run row (MH3).
 *
 *   - `running`  — run is in flight (pulsing spinner dot)
 *   - `blocked`  — run is awaiting an answer to an `agent_run.question`
 *                  (yellow dot)
 *   - `error`    — run terminated with an error (red dot)
 *   - `unseen`   — run produced output the user has not yet focused
 *                  (blue dot)
 *   - `none`     — nothing to signal (done/cancelled, or an actively-
 *                  focused running peer with no other signal)
 */
export type SidebarRunStatusVariant =
	| 'running'
	| 'blocked'
	| 'error'
	| 'unseen'
	| 'none';

/**
 * Inputs needed to decide whether the chain should render and what
 * rows it should contain. The helper never reaches into any store so
 * it stays trivially testable.
 */
export interface SidebarChildRunChainInputs {
	/** Whether the row being drawn belongs to the active session. */
	isActiveSession: boolean;
	/** The current view in the navigation store. */
	currentView: string;
	/** The currently-active child run id (from navigation store). */
	currentChildRunId: string | null;
	/**
	 * All runs in this session (unsorted is fine — we walk by runId).
	 * This is `agentRunsStore.runsForSession(sessionId)` in the caller.
	 */
	sessionRuns: AgentRun[];
	/**
	 * The full active child path including the root run at index 0
	 * and the currently-active child run at the end. This is
	 * `agentRunsStore.activeChildPath(rootRunId, currentChildRunId)` —
	 * but since the caller does not know `rootRunId` yet, this helper
	 * accepts it as an opaque list (empty when no active path).
	 */
	activeChildPath: AgentRun[];
}

/**
 * Decide whether the child-run chain should render under this session
 * row, and return the rows (root-excluded, with indent depth) to draw.
 *
 * Rules (from SPEC MH3):
 *   1. Only the ACTIVE session surfaces a chain.
 *   2. The main pane must be in "chat" or "child-run" view.
 *   3. There must be a current child run id.
 *   4. The active child path must contain at least two entries
 *      (root + one child) — a chain of one is just the root session
 *      itself and adds nothing.
 *   5. The root run (activeChildPath[0]) must belong to this session
 *      (i.e., be present in sessionRuns). This guards against a stale
 *      childRunId that points into another session — we must not leak
 *      a chain from session A into session B's row.
 *   6. Returns the path WITHOUT the root (since the session row
 *      already represents the root). Each returned row carries a
 *      depth starting at 1.
 */
export function computeSidebarChildRunChain(
	inputs: SidebarChildRunChainInputs,
): SidebarChildRunRow[] {
	const {
		isActiveSession,
		currentView,
		currentChildRunId,
		sessionRuns,
		activeChildPath,
	} = inputs;

	// Rule 1: only the active session renders a chain.
	if (!isActiveSession) return [];

	// Rule 2: chain only shows when the user is actively viewing a child run.
	// In plain chat view the session row alone is sufficient — showing the
	// chain there is visual noise the user didn't ask for.
	if (currentView !== 'child-run') return [];

	// Rule 3: no active child run → nothing to surface.
	if (!currentChildRunId) return [];

	// Rule 4: need a real chain (root + at least one descendant).
	if (activeChildPath.length < 2) return [];

	// Rule 5: the root must belong to this session. We check against
	// the session's run list to be defensive — a child-run id from a
	// different session must never render under this row.
	const rootRun = activeChildPath[0];
	const rootBelongsToSession = sessionRuns.some(
		(run) => run.runId === rootRun.runId,
	);
	if (!rootBelongsToSession) return [];

	// Skip the root (the session row already represents it) and
	// assign a 1-based depth so the first descendant sits one level
	// deeper than the session.
	return activeChildPath.slice(1).map((run, idx) => ({
		run,
		depth: idx + 1,
	}));
}

/**
 * Compute the inline style used to indent a child-run row by depth.
 * Exposed as a helper so the component template stays declarative and
 * tests can assert the indentation math without reading CSS.
 *
 * Uses the design-system `--space-4` token as the per-level step so
 * the indent scales with the rest of the sidebar spacing rhythm.
 */
export function buildChildRunRowIndent(depth: number): string {
	const safeDepth = Math.max(0, Math.trunc(depth));
	return `calc(var(--space-4) * ${safeDepth})`;
}

/**
 * Decide the status indicator variant for a single sidebar run row
 * (MH3 indicator logic).
 *
 * Priority order is explicit and deliberate — the dot at the top of
 * the priority stack always wins. From highest to lowest:
 *
 *   1. `blocked`  — the run is waiting for the user to answer a
 *                   question and needs immediate attention.
 *   2. `error`    — terminal failure state the user needs to see.
 *   3. `unseen`   — non-focused run produced new output; this should
 *                   stay visible even while the run is still running.
 *   4. `running`  — live work in progress when no higher-priority
 *                   attention signal exists.
 *   5. `none`     — nothing to signal (includes `done`, `cancelled`,
 *                   and any status we don't surface with a dot).
 *
 * `isUnseen` and `isAwaitingQuestion` are accepted as booleans (not
 * as the store functions themselves) so this helper stays pure and
 * trivially testable.
 */
export function computeStatusVariant(
	run: AgentRun,
	isUnseen: boolean,
	isAwaitingQuestion: boolean,
): SidebarRunStatusVariant {
	// 1. Blocked is the highest-priority actionable signal.
	if (isAwaitingQuestion) return 'blocked';

	// 2. Error is next — terminal failure surfaces clearly.
	if (run.status === 'error') return 'error';

	// 3. Unseen output should remain visible while run is non-focused.
	if (isUnseen) return 'unseen';

	// 4. Running is the baseline liveness indicator.
	if (run.status === 'running') return 'running';

	// 5. Everything else (done, cancelled, quiet running-with-no-signal)
	// renders without a dot.
	return 'none';
}

/**
 * Compute a rollup indicator variant for the session row itself, so
 * the user can tell at a glance that a run inside the active child
 * chain wants their attention — even when the chain is rendered.
 *
 * Uses the same priority stack as `computeStatusVariant`: the most
 * attention-worthy variant found among any row in the chain wins.
 * Returns `none` when the chain is empty or contains no notable
 * states.
 */
export function computeRollupVariant(
	rows: SidebarChildRunRow[],
	isUnseen: (runId: string) => boolean,
	isAwaitingQuestion: (runId: string) => boolean,
): SidebarRunStatusVariant {
	// Priority rank (lower = higher priority).
	const rank: Record<SidebarRunStatusVariant, number> = {
		blocked: 0,
		error: 1,
		unseen: 2,
		running: 3,
		none: 4,
	};

	let best: SidebarRunStatusVariant = 'none';
	for (const row of rows) {
		const variant = computeStatusVariant(
			row.run,
			isUnseen(row.run.runId),
			isAwaitingQuestion(row.run.runId),
		);
		if (rank[variant] < rank[best]) {
			best = variant;
			// Early-out on the strongest signal — nothing beats blocked.
			if (best === 'blocked') break;
		}
	}
	return best;
}
