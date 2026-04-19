// Pure helpers for AgentTaskCard display state.
//
// The card has four visual states, all derivable from the child run's
// resolved id plus (optionally) the current AgentRun row from the store.
// Extracting the logic keeps the Svelte component thin and lets us unit
// test every state without a component renderer.

import type { AgentRun, AgentRunStatus } from '$lib/types/agent-run.js';

export type AgentTaskCardStatus =
	| 'spawning'
	| 'running'
	| 'done'
	| 'error'
	| 'cancelled';

export interface AgentTaskCardState {
	/** High-level visual state the card should render. */
	status: AgentTaskCardStatus;
	/** Single-character status glyph shown next to the agent icon. */
	statusIcon: string;
	/** Short human-readable status label (also used as sr-only text). */
	statusLabel: string;
	/** Whether the card's button should be disabled (no click). */
	disabled: boolean;
	/** Whether the card should render the pulsing "in-flight" style. */
	isPulsing: boolean;
}

/**
 * Derive the full visual state for an AgentTaskCard from the resolved
 * child runId and (if available) the AgentRun row that runId points at.
 *
 * Order of precedence:
 *   1. No `resolvedRunId` yet              → spawning
 *   2. `resolvedRunId` set, no run row yet → running (optimistic; the
 *      child exists, we just haven't hydrated its row yet — treat as
 *      in-flight but clickable so users can jump in early)
 *   3. Run row present                     → map run.status 1:1
 */
export function computeAgentTaskCardState(
	resolvedRunId: string | null | undefined,
	run: AgentRun | null | undefined,
): AgentTaskCardState {
	if (!resolvedRunId) {
		return {
			status: 'spawning',
			statusIcon: '⋯',
			statusLabel: 'Spawning…',
			disabled: true,
			isPulsing: true,
		};
	}

	const runStatus: AgentRunStatus = run?.status ?? 'running';

	switch (runStatus) {
		case 'done':
			return {
				status: 'done',
				statusIcon: '✓',
				statusLabel: 'Complete',
				disabled: false,
				isPulsing: false,
			};
		case 'error':
			return {
				status: 'error',
				statusIcon: '✗',
				statusLabel: 'Error',
				disabled: false,
				isPulsing: false,
			};
		case 'cancelled':
			return {
				status: 'cancelled',
				statusIcon: '—',
				statusLabel: 'Cancelled',
				disabled: false,
				isPulsing: false,
			};
		case 'running':
		default:
			return {
				status: 'running',
				statusIcon: '⋯',
				statusLabel: 'Running',
				disabled: false,
				isPulsing: true,
			};
	}
}

/**
 * Build the aria-label for the card. Always includes the title so screen
 * reader users hear what they are about to open; the state suffix gives
 * lightweight context without over-describing.
 */
export function buildAgentTaskCardAriaLabel(
	title: string,
	state: AgentTaskCardState,
): string {
	const safeTitle = title.trim() || 'untitled task';
	if (state.status === 'spawning') {
		return `Spawning child run: ${safeTitle}`;
	}
	return `Open child run: ${safeTitle} (${state.statusLabel})`;
}
