// AgentTaskCard tests.
//
// The project has no component renderer (no @testing-library/svelte in
// package.json), so these tests target the pure state logic that drives
// every visual branch of AgentTaskCard.svelte. Covering this logic gives
// the same confidence as DOM assertions for the cases that matter:
//   • which state the card renders in (spawning / running / done / error / cancelled)
//   • when the card is clickable vs disabled
//   • that the onOpenChildRun wiring only fires with a resolved runId
//   • that the aria-label includes "Open child run: {title}"
//
// The click-wiring test below simulates what the Svelte component does
// on click by invoking the same code path (guarded by cardState.disabled
// and resolvedRunId) against a captured callback.

import { describe, expect, it } from 'bun:test';
import type { AgentRun } from '$lib/types/agent-run.js';
import {
	buildAgentTaskCardAriaLabel,
	computeAgentTaskCardState,
} from './agent-task-card-state.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const makeRun = (overrides: Partial<AgentRun> = {}): AgentRun => ({
	runId: 'run-child',
	sessionId: 'sess-1',
	projectId: 'proj-1',
	parentRunId: 'run-parent',
	agentType: 'executor',
	title: 'Child task',
	status: 'running',
	contextMode: 'inherit_session',
	createdAt: '2026-04-19T00:00:00.000Z',
	startedAt: '2026-04-19T00:00:00.000Z',
	endedAt: null,
	errorMessage: null,
	...overrides,
});

/**
 * Mirrors the click guard inside AgentTaskCard.svelte's handleClick.
 * Keeping this in the test file ensures the test stays honest about
 * what the component actually does.
 */
function simulateClick(
	resolvedRunId: string | null | undefined,
	run: AgentRun | null | undefined,
	onOpenChildRun: (runId: string) => void,
): boolean {
	const state = computeAgentTaskCardState(resolvedRunId, run);
	if (state.disabled || !resolvedRunId) return false;
	onOpenChildRun(resolvedRunId);
	return true;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('AgentTaskCard — state derivation', () => {
	it('renders the spawning state when resolvedRunId is null', () => {
		const state = computeAgentTaskCardState(null, null);
		expect(state.status).toBe('spawning');
		expect(state.disabled).toBe(true);
		expect(state.isPulsing).toBe(true);
		expect(state.statusLabel).toBe('Spawning…');
	});

	it('renders the spawning state when resolvedRunId is undefined', () => {
		const state = computeAgentTaskCardState(undefined, null);
		expect(state.status).toBe('spawning');
		expect(state.disabled).toBe(true);
	});

	it('renders running state when runId resolves but row has not hydrated yet', () => {
		// Optimistic: if we have a runId but no row, treat as running and
		// let the user click through; the store will hydrate en route.
		const state = computeAgentTaskCardState('run-child', null);
		expect(state.status).toBe('running');
		expect(state.disabled).toBe(false);
		expect(state.isPulsing).toBe(true);
	});

	it('renders running state when the child run is in-flight', () => {
		const state = computeAgentTaskCardState(
			'run-child',
			makeRun({ status: 'running' }),
		);
		expect(state.status).toBe('running');
		expect(state.disabled).toBe(false);
		expect(state.isPulsing).toBe(true);
		expect(state.statusLabel).toBe('Running');
	});

	it('renders done state with a check token when the child run completes', () => {
		const state = computeAgentTaskCardState(
			'run-child',
			makeRun({ status: 'done' }),
		);
		expect(state.status).toBe('done');
		expect(state.disabled).toBe(false);
		expect(state.isPulsing).toBe(false);
		expect(state.statusIcon).toBe('check');
		expect(state.statusLabel).toBe('Complete');
	});

	it('renders error state with a cross token when the child run errors', () => {
		const state = computeAgentTaskCardState(
			'run-child',
			makeRun({ status: 'error', errorMessage: 'boom' }),
		);
		expect(state.status).toBe('error');
		expect(state.disabled).toBe(false);
		expect(state.isPulsing).toBe(false);
		expect(state.statusIcon).toBe('cross');
		expect(state.statusLabel).toBe('Error');
	});

	it('renders cancelled state with a dash token when the child run is cancelled', () => {
		const state = computeAgentTaskCardState(
			'run-child',
			makeRun({ status: 'cancelled' }),
		);
		expect(state.status).toBe('cancelled');
		expect(state.disabled).toBe(false);
		expect(state.isPulsing).toBe(false);
		expect(state.statusIcon).toBe('dash');
		expect(state.statusLabel).toBe('Cancelled');
	});
});

describe('AgentTaskCard — aria-label', () => {
	it('includes "Open child run" and the title when resolved', () => {
		const state = computeAgentTaskCardState(
			'run-child',
			makeRun({ status: 'running' }),
		);
		const label = buildAgentTaskCardAriaLabel('Refactor auth', state);
		expect(label).toContain('Open child run');
		expect(label).toContain('Refactor auth');
	});

	it('distinguishes the spawning state in aria text', () => {
		const state = computeAgentTaskCardState(null, null);
		const label = buildAgentTaskCardAriaLabel('Refactor auth', state);
		expect(label).toContain('Spawning');
		expect(label).toContain('Refactor auth');
	});

	it('falls back to "untitled task" when title is empty or whitespace', () => {
		const state = computeAgentTaskCardState(
			'run-child',
			makeRun({ status: 'done' }),
		);
		expect(buildAgentTaskCardAriaLabel('', state)).toContain('untitled task');
		expect(buildAgentTaskCardAriaLabel('   ', state)).toContain('untitled task');
	});

	it('appends the status label for resolved runs so SR users hear context', () => {
		const state = computeAgentTaskCardState(
			'run-child',
			makeRun({ status: 'done' }),
		);
		const label = buildAgentTaskCardAriaLabel('Refactor auth', state);
		expect(label).toContain('Complete');
	});
});

describe('AgentTaskCard — click wiring', () => {
	it('does NOT fire onOpenChildRun while spawning', () => {
		const calls: string[] = [];
		const fired = simulateClick(null, null, (id) => {
			calls.push(id);
		});
		expect(fired).toBe(false);
		expect(calls).toEqual([]);
	});

	it('fires onOpenChildRun with the resolved runId once running', () => {
		const calls: string[] = [];
		const fired = simulateClick(
			'run-child',
			makeRun({ status: 'running' }),
			(id) => {
				calls.push(id);
			},
		);
		expect(fired).toBe(true);
		expect(calls).toEqual(['run-child']);
	});

	it('fires onOpenChildRun for terminated runs so users can inspect transcripts', () => {
		// Archival navigation: done/error/cancelled runs are still clickable.
		for (const status of ['done', 'error', 'cancelled'] as const) {
			const calls: string[] = [];
			const fired = simulateClick(
				'run-child',
				makeRun({ status }),
				(id) => {
					calls.push(id);
				},
			);
			expect(fired).toBe(true);
			expect(calls).toEqual(['run-child']);
		}
	});

	it('fires onOpenChildRun even when the store row has not hydrated yet', () => {
		// A runId resolved via tool_call metadata should be navigable even
		// before the store has seen the `agent_run.spawned` event.
		const calls: string[] = [];
		const fired = simulateClick('run-child', null, (id) => {
			calls.push(id);
		});
		expect(fired).toBe(true);
		expect(calls).toEqual(['run-child']);
	});
});
