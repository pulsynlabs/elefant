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

const FALLBACK_TITLE = 'Untitled run';
const COMPOSER_PLACEHOLDER = 'Back to parent to continue';

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
