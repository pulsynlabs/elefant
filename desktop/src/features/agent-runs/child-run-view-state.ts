// Pure helpers for ChildRunView display state.
//
// Extracting the view-state logic into a pure module keeps the Svelte
// component thin and lets us unit test every visual branch without a
// component renderer (the project has no @testing-library/svelte —
// see AgentTaskCard.test.ts and agent-task-card-state.ts for the same
// pattern).

import type { AgentRun } from '$lib/types/agent-run.js';

export type ChildRunViewStatus = 'loading' | 'ready';

export interface ChildRunViewState {
	/** High-level visual state the container should render. */
	status: ChildRunViewStatus;
	/** Title of the child run — falls back to a humane placeholder. */
	childTitle: string;
	/**
	 * Title of the parent run (for the breadcrumb). Null when the
	 * child has no parent or the parent row hasn't hydrated yet.
	 */
	parentTitle: string | null;
	/** aria-label applied to the container region for screen readers. */
	regionLabel: string;
	/** aria-label for the back/breadcrumb button. */
	backLabel: string;
	/** Text the disabled composer placeholder should show. */
	composerPlaceholder: string;
}

/**
 * Sibling navigation state. Derived from the list of siblings under the
 * same parent run (`childRunsForRun(parentRunId)` in the store) plus the
 * current child run's id.
 */
export interface SiblingNavState {
	/** Previous sibling (older createdAt) or null when at the start. */
	prev: AgentRun | null;
	/** Next sibling (newer createdAt) or null when at the end. */
	next: AgentRun | null;
	/** Zero-based index of the current run within the sibling list. */
	index: number;
	/** Total siblings (including the current run). */
	total: number;
	/** `true` when prev is available. Convenience for aria-disabled plumbing. */
	hasPrev: boolean;
	/** `true` when next is available. Convenience for aria-disabled plumbing. */
	hasNext: boolean;
}

const FALLBACK_TITLE = 'Untitled run';
const COMPOSER_PLACEHOLDER = 'Back to parent to continue the conversation';

/**
 * Derive the full view state from the (optional) child run row and the
 * (optional) parent run row.
 *
 * Precedence:
 *   1. No child row yet                  → loading
 *   2. Child row present, no parent row  → ready, parentTitle null
 *   3. Child + parent rows               → ready with parentTitle
 *
 * `parent` is expected to be resolved by the caller using
 * `runs[child.parentRunId]`; this helper never reaches into the store
 * directly so it stays pure and trivially testable.
 */
export function computeChildRunViewState(
	child: AgentRun | null | undefined,
	parent: AgentRun | null | undefined,
): ChildRunViewState {
	if (!child) {
		return {
			status: 'loading',
			childTitle: FALLBACK_TITLE,
			parentTitle: null,
			regionLabel: 'Child run: loading',
			backLabel: 'Back to parent',
			composerPlaceholder: COMPOSER_PLACEHOLDER,
		};
	}

	const childTitle = child.title.trim() || FALLBACK_TITLE;
	const parentTitle =
		parent && parent.title.trim() ? parent.title.trim() : null;

	return {
		status: 'ready',
		childTitle,
		parentTitle,
		regionLabel: `Child run: ${childTitle}`,
		backLabel: parentTitle
			? `Back to parent run: ${parentTitle}`
			: 'Back to parent',
		composerPlaceholder: COMPOSER_PLACEHOLDER,
	};
}

/**
 * Compute the previous/next sibling navigation state for the child run.
 *
 * `siblings` should be the list returned by
 * `agentRunsStore.childRunsForRun(child.parentRunId)` — already sorted
 * chronologically by `createdAt ASC`. The helper defensively re-sorts
 * so callers can pass a raw list without worrying about ordering.
 *
 * Returns a neutral "no siblings, no navigation" state when:
 *   • the child is null/undefined (not yet hydrated),
 *   • the siblings list is empty,
 *   • the current run is not present in the siblings list
 *     (which can happen briefly during hydration).
 */
export function computeSiblingNavState(
	child: AgentRun | null | undefined,
	siblings: AgentRun[],
): SiblingNavState {
	if (!child || siblings.length === 0) {
		return {
			prev: null,
			next: null,
			index: -1,
			total: siblings.length,
			hasPrev: false,
			hasNext: false,
		};
	}

	// Defensive chronological sort — mirrors the store selector contract.
	// `createdAt` is an ISO-8601 string so lexical comparison is
	// equivalent to chronological ordering.
	const sorted = [...siblings].sort((a, b) =>
		a.createdAt.localeCompare(b.createdAt),
	);
	const index = sorted.findIndex((run) => run.runId === child.runId);

	if (index === -1) {
		return {
			prev: null,
			next: null,
			index: -1,
			total: sorted.length,
			hasPrev: false,
			hasNext: false,
		};
	}

	const prev = index > 0 ? sorted[index - 1] : null;
	const next = index < sorted.length - 1 ? sorted[index + 1] : null;

	return {
		prev,
		next,
		index,
		total: sorted.length,
		hasPrev: prev !== null,
		hasNext: next !== null,
	};
}
