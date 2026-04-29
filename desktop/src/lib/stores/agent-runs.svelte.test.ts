import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
	agentRunsStore,
	resetAgentRunsStore,
	_seedRun,
} from './agent-runs.svelte.js';
import type {
	AgentRun,
	AgentRunEventEnvelope,
} from '$lib/types/agent-run.js';
import { computeRenderBlocks } from '../../features/agent-runs/agent-run-transcript-blocks.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const makeRun = (overrides: Partial<AgentRun> = {}): AgentRun => ({
	runId: 'run-default',
	sessionId: 'sess-1',
	projectId: 'proj-1',
	parentRunId: null,
	agentType: 'executor',
	title: 'Default run',
	status: 'running',
	contextMode: 'inherit_session',
	createdAt: '2026-04-18T00:00:00.000Z',
	startedAt: '2026-04-18T00:00:00.000Z',
	endedAt: null,
	errorMessage: null,
	orchestratorPrompt: null,
	...overrides,
});

const makeEnvelope = (
	overrides: Partial<AgentRunEventEnvelope> & Pick<AgentRunEventEnvelope, 'runId' | 'type'>,
): AgentRunEventEnvelope => ({
	ts: '2026-04-18T00:00:01.000Z',
	projectId: 'proj-1',
	sessionId: 'sess-1',
	parentRunId: null,
	agentType: 'executor',
	title: 'Run',
	seq: 1,
	data: {},
	...overrides,
});

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('agentRunsStore', () => {
	beforeEach(() => {
		resetAgentRunsStore();
	});

	afterEach(() => {
		resetAgentRunsStore();
	});

	describe('applyRunEvent — SSE multiplex', () => {
		it('keeps two runIds fully isolated when tokens interleave', () => {
			_seedRun(makeRun({ runId: 'run-a', title: 'Run A' }));
			_seedRun(makeRun({ runId: 'run-b', title: 'Run B' }));

			// Interleave tokens for two different runIds — this is the
			// core "no cross-contamination" guarantee.
			agentRunsStore.applyRunEvent(
				makeEnvelope({ runId: 'run-a', type: 'agent_run.token', seq: 1, data: { text: 'A1' } }),
			);
			agentRunsStore.applyRunEvent(
				makeEnvelope({ runId: 'run-b', type: 'agent_run.token', seq: 1, data: { text: 'B1' } }),
			);
			agentRunsStore.applyRunEvent(
				makeEnvelope({ runId: 'run-a', type: 'agent_run.token', seq: 2, data: { text: 'A2' } }),
			);
			agentRunsStore.applyRunEvent(
				makeEnvelope({ runId: 'run-b', type: 'agent_run.token', seq: 2, data: { text: 'B2' } }),
			);

			const aEntries = agentRunsStore.transcripts['run-a'] ?? [];
			const bEntries = agentRunsStore.transcripts['run-b'] ?? [];

			expect(aEntries).toHaveLength(2);
			expect(bEntries).toHaveLength(2);
			expect(aEntries.every((e) => e.kind === 'token')).toBe(true);
			expect(bEntries.every((e) => e.kind === 'token')).toBe(true);
			expect((aEntries[0] as { text: string }).text).toBe('A1');
			expect((aEntries[1] as { text: string }).text).toBe('A2');
			expect((bEntries[0] as { text: string }).text).toBe('B1');
			expect((bEntries[1] as { text: string }).text).toBe('B2');
		});

		it('synthesizes a run row from agent_run.spawned when the REST list hasn’t arrived yet', () => {
			expect(agentRunsStore.runs['run-new']).toBeUndefined();

			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'run-new',
					sessionId: 'sess-x',
					projectId: 'proj-x',
					agentType: 'planner',
					title: 'Newcomer',
					type: 'agent_run.spawned',
					data: { runId: 'run-new' },
				}),
			);

			expect(agentRunsStore.runs['run-new']).toBeDefined();
			expect(agentRunsStore.runs['run-new'].agentType).toBe('planner');
			expect(agentRunsStore.runs['run-new'].status).toBe('running');
		});

		it('records tool_call, tool_result, and question events on the correct runId', () => {
			_seedRun(makeRun({ runId: 'run-a' }));

			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'run-a',
					type: 'agent_run.tool_call',
					seq: 3,
					data: { id: 'tc-1', name: 'bash', arguments: { command: 'ls' } },
				}),
			);
			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'run-a',
					type: 'agent_run.tool_result',
					seq: 4,
					data: { toolCallId: 'tc-1', content: 'file.txt', isError: false },
				}),
			);
			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'run-a',
					type: 'agent_run.question',
					seq: 5,
					data: {
						questionId: 'q-1',
						question: 'Continue?',
						options: [{ label: 'yes' }, { label: 'no' }],
						multiple: false,
					},
				}),
			);

			const entries = agentRunsStore.transcripts['run-a'] ?? [];
			expect(entries).toHaveLength(3);
			expect(entries[0].kind).toBe('tool_call');
			expect(entries[1].kind).toBe('tool_result');
			expect(entries[2].kind).toBe('question');
		});

		it('transitions run status on done / error / cancelled terminal events', () => {
			_seedRun(makeRun({ runId: 'run-a' }));
			_seedRun(makeRun({ runId: 'run-b' }));
			_seedRun(makeRun({ runId: 'run-c' }));

			agentRunsStore.applyRunEvent(
				makeEnvelope({ runId: 'run-a', type: 'agent_run.done', seq: 9 }),
			);
			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'run-b',
					type: 'agent_run.error',
					seq: 9,
					data: { message: 'provider failed' },
				}),
			);
			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'run-c',
					type: 'agent_run.cancelled',
					seq: 9,
					data: { reason: 'user cancel' },
				}),
			);

			expect(agentRunsStore.runs['run-a'].status).toBe('done');
			expect(agentRunsStore.runs['run-b'].status).toBe('error');
			expect(agentRunsStore.runs['run-b'].errorMessage).toBe('provider failed');
			expect(agentRunsStore.runs['run-c'].status).toBe('cancelled');
		});

		it('drops malformed envelopes without throwing', () => {
			expect(() =>
				agentRunsStore.applyRunEvent({} as unknown as AgentRunEventEnvelope),
			).not.toThrow();
			expect(() =>
				agentRunsStore.applyRunEvent({ runId: 123 } as unknown as AgentRunEventEnvelope),
			).not.toThrow();
			expect(() =>
				// @ts-expect-error — intentional malformed event
				agentRunsStore.applyRunEvent({ runId: 'x' }),
			).not.toThrow();
		});

		it('ignores unknown agent_run.* event types instead of crashing', () => {
			_seedRun(makeRun({ runId: 'run-a' }));
			agentRunsStore.applyRunEvent(
				makeEnvelope({ runId: 'run-a', type: 'agent_run.future_event', data: { foo: 'bar' } }),
			);
			expect(agentRunsStore.transcripts['run-a']).toBeUndefined();
		});

		describe('agent_run.status_changed', () => {
			it('status_changed(running → done) updates status field', () => {
				_seedRun(makeRun({ runId: 'run-a', status: 'running' }));

				agentRunsStore.applyRunEvent(
					makeEnvelope({
						runId: 'run-a',
						type: 'agent_run.status_changed',
						seq: 10,
						data: { previousStatus: 'running', nextStatus: 'done' },
					}),
				);

				expect(agentRunsStore.runs['run-a'].status).toBe('done');
			});

			it('does NOT append a transcript entry for status_changed', () => {
				_seedRun(makeRun({ runId: 'run-a', status: 'running' }));

				agentRunsStore.applyRunEvent(
					makeEnvelope({
						runId: 'run-a',
						type: 'agent_run.status_changed',
						seq: 10,
						data: { previousStatus: 'running', nextStatus: 'done' },
					}),
				);

				expect(agentRunsStore.transcripts['run-a']).toBeUndefined();
			});

			it('is idempotent — delivering same event twice produces same result', () => {
				_seedRun(makeRun({ runId: 'run-a', status: 'running' }));

				const envelope = makeEnvelope({
					runId: 'run-a',
					type: 'agent_run.status_changed',
					seq: 10,
					data: { previousStatus: 'running', nextStatus: 'done' },
				});

				agentRunsStore.applyRunEvent(envelope);
				const firstEndedAt = agentRunsStore.runs['run-a'].endedAt;

				agentRunsStore.applyRunEvent(envelope);
				const secondEndedAt = agentRunsStore.runs['run-a'].endedAt;

				expect(agentRunsStore.runs['run-a'].status).toBe('done');
				expect(firstEndedAt).toBe(secondEndedAt);
			});

			it('upserts a minimal run entry for unknown runId instead of crashing', () => {
				expect(agentRunsStore.runs['run-unknown']).toBeUndefined();

				agentRunsStore.applyRunEvent(
					makeEnvelope({
						runId: 'run-unknown',
						sessionId: 'sess-new',
						projectId: 'proj-new',
						parentRunId: 'parent-1',
						agentType: 'executor',
						title: 'Unknown Run',
						type: 'agent_run.status_changed',
						seq: 1,
						data: { previousStatus: 'running', nextStatus: 'done' },
					}),
				);

				expect(agentRunsStore.runs['run-unknown']).toBeDefined();
				expect(agentRunsStore.runs['run-unknown'].status).toBe('done');
				expect(agentRunsStore.runs['run-unknown'].sessionId).toBe('sess-new');
				expect(agentRunsStore.runs['run-unknown'].projectId).toBe('proj-new');
				expect(agentRunsStore.runs['run-unknown'].parentRunId).toBe('parent-1');
				expect(agentRunsStore.runs['run-unknown'].agentType).toBe('executor');
				expect(agentRunsStore.runs['run-unknown'].title).toBe('Unknown Run');
			});

			it('handles status_changed for all terminal states', () => {
				_seedRun(makeRun({ runId: 'run-done', status: 'running' }));
				_seedRun(makeRun({ runId: 'run-error', status: 'running' }));
				_seedRun(makeRun({ runId: 'run-cancelled', status: 'running' }));

				agentRunsStore.applyRunEvent(
					makeEnvelope({
						runId: 'run-done',
						type: 'agent_run.status_changed',
						seq: 1,
						data: { previousStatus: 'running', nextStatus: 'done' },
					}),
				);
				agentRunsStore.applyRunEvent(
					makeEnvelope({
						runId: 'run-error',
						type: 'agent_run.status_changed',
						seq: 1,
						data: { previousStatus: 'running', nextStatus: 'error' },
					}),
				);
				agentRunsStore.applyRunEvent(
					makeEnvelope({
						runId: 'run-cancelled',
						type: 'agent_run.status_changed',
						seq: 1,
						data: { previousStatus: 'running', nextStatus: 'cancelled' },
					}),
				);

				expect(agentRunsStore.runs['run-done'].status).toBe('done');
				expect(agentRunsStore.runs['run-error'].status).toBe('error');
				expect(agentRunsStore.runs['run-cancelled'].status).toBe('cancelled');
			});
		});
	});

	describe('runsForSession', () => {
		it('filters by session and sorts oldest-first', () => {
			_seedRun(
				makeRun({ runId: 'r1', sessionId: 'sess-1', createdAt: '2026-04-18T00:00:02.000Z' }),
			);
			_seedRun(
				makeRun({ runId: 'r2', sessionId: 'sess-1', createdAt: '2026-04-18T00:00:01.000Z' }),
			);
			_seedRun(
				makeRun({ runId: 'r3', sessionId: 'sess-2', createdAt: '2026-04-18T00:00:03.000Z' }),
			);

			const ids = agentRunsStore.runsForSession('sess-1').map((r) => r.runId);
			expect(ids).toEqual(['r2', 'r1']);
		});
	});

	describe('runTree', () => {
		it('nests children under their parent and surfaces orphans as roots', () => {
			_seedRun(makeRun({ runId: 'root', sessionId: 'sess-1', parentRunId: null }));
			_seedRun(makeRun({ runId: 'child-a', sessionId: 'sess-1', parentRunId: 'root' }));
			_seedRun(makeRun({ runId: 'child-b', sessionId: 'sess-1', parentRunId: 'root' }));
			_seedRun(
				// Parent exists in another session — surfaces as a root.
				makeRun({ runId: 'orphan', sessionId: 'sess-1', parentRunId: 'external-parent' }),
			);

			const tree = agentRunsStore.runTree('sess-1');
			expect(tree.map((n) => n.run.runId).sort()).toEqual(['orphan', 'root']);

			const rootNode = tree.find((n) => n.run.runId === 'root')!;
			expect(rootNode.children.map((c) => c.run.runId).sort()).toEqual([
				'child-a',
				'child-b',
			]);
		});
	});

	describe('childRunsForRun', () => {
		it('returns empty array for run with no children', () => {
			_seedRun(makeRun({ runId: 'parent', parentRunId: null }));
			expect(agentRunsStore.childRunsForRun('parent')).toEqual([]);
		});

		it('returns single child', () => {
			_seedRun(makeRun({ runId: 'parent', parentRunId: null }));
			_seedRun(makeRun({ runId: 'child', parentRunId: 'parent' }));

			const children = agentRunsStore.childRunsForRun('parent');
			expect(children).toHaveLength(1);
			expect(children[0].runId).toBe('child');
		});

		it('returns multiple children sorted by createdAt ASC', () => {
			_seedRun(makeRun({ runId: 'parent', parentRunId: null }));
			_seedRun(
				makeRun({
					runId: 'child-2',
					parentRunId: 'parent',
					createdAt: '2026-04-18T00:00:02.000Z',
				}),
			);
			_seedRun(
				makeRun({
					runId: 'child-1',
					parentRunId: 'parent',
					createdAt: '2026-04-18T00:00:01.000Z',
				}),
			);
			_seedRun(
				makeRun({
					runId: 'child-3',
					parentRunId: 'parent',
					createdAt: '2026-04-18T00:00:03.000Z',
				}),
			);

			const children = agentRunsStore.childRunsForRun('parent');
			expect(children.map((c) => c.runId)).toEqual(['child-1', 'child-2', 'child-3']);
		});

		it('excludes grandchildren (direct children only)', () => {
			_seedRun(makeRun({ runId: 'grandparent', parentRunId: null }));
			_seedRun(makeRun({ runId: 'parent', parentRunId: 'grandparent' }));
			_seedRun(makeRun({ runId: 'child', parentRunId: 'parent' }));

			const grandparentChildren = agentRunsStore.childRunsForRun('grandparent');
			expect(grandparentChildren.map((c) => c.runId)).toEqual(['parent']);

			const parentChildren = agentRunsStore.childRunsForRun('parent');
			expect(parentChildren.map((c) => c.runId)).toEqual(['child']);
		});

		it('returns empty array for unknown runId', () => {
			expect(agentRunsStore.childRunsForRun('nonexistent')).toEqual([]);
		});
	});

	describe('activeChildPath', () => {
		it('returns empty array when activeRunId is not provided', () => {
			_seedRun(makeRun({ runId: 'root', parentRunId: null }));
			expect(agentRunsStore.activeChildPath('root')).toEqual([]);
		});

		it('returns empty array when activeRunId is unknown', () => {
			_seedRun(makeRun({ runId: 'root', parentRunId: null }));
			expect(agentRunsStore.activeChildPath('root', 'nonexistent')).toEqual([]);
		});

		it('returns [root] when root is the active run (root-only path)', () => {
			_seedRun(makeRun({ runId: 'root', parentRunId: null }));
			const path = agentRunsStore.activeChildPath('root', 'root');
			expect(path.map((r) => r.runId)).toEqual(['root']);
		});

		it('returns [root, child] when child is active', () => {
			_seedRun(makeRun({ runId: 'root', parentRunId: null }));
			_seedRun(makeRun({ runId: 'child', parentRunId: 'root' }));
			const path = agentRunsStore.activeChildPath('root', 'child');
			expect(path.map((r) => r.runId)).toEqual(['root', 'child']);
		});

		it('returns 3-level chain [root, parent, child]', () => {
			_seedRun(makeRun({ runId: 'root', parentRunId: null }));
			_seedRun(makeRun({ runId: 'parent', parentRunId: 'root' }));
			_seedRun(makeRun({ runId: 'child', parentRunId: 'parent' }));
			const path = agentRunsStore.activeChildPath('root', 'child');
			expect(path.map((r) => r.runId)).toEqual(['root', 'parent', 'child']);
		});

		it('returns 4-level chain (max depth)', () => {
			_seedRun(makeRun({ runId: 'level-1', parentRunId: null }));
			_seedRun(makeRun({ runId: 'level-2', parentRunId: 'level-1' }));
			_seedRun(makeRun({ runId: 'level-3', parentRunId: 'level-2' }));
			_seedRun(makeRun({ runId: 'level-4', parentRunId: 'level-3' }));
			const path = agentRunsStore.activeChildPath('level-1', 'level-4');
			expect(path.map((r) => r.runId)).toEqual(['level-1', 'level-2', 'level-3', 'level-4']);
		});

		it('returns empty array when activeRunId is not a descendant of rootRunId', () => {
			_seedRun(makeRun({ runId: 'root-a', parentRunId: null }));
			_seedRun(makeRun({ runId: 'root-b', parentRunId: null }));
			_seedRun(makeRun({ runId: 'child-of-b', parentRunId: 'root-b' }));

			// child-of-b is not a descendant of root-a
			expect(agentRunsStore.activeChildPath('root-a', 'child-of-b')).toEqual([]);
		});

		it('returns empty array when activeRunId is in a different branch', () => {
			_seedRun(makeRun({ runId: 'root', parentRunId: null }));
			_seedRun(makeRun({ runId: 'branch-a', parentRunId: 'root' }));
			_seedRun(makeRun({ runId: 'branch-b', parentRunId: 'root' }));
			_seedRun(makeRun({ runId: 'child-of-a', parentRunId: 'branch-a' }));

			// child-of-a is not a descendant of branch-b
			expect(agentRunsStore.activeChildPath('branch-b', 'child-of-a')).toEqual([]);
		});
	});

	describe('childrenByParent index', () => {
		it('is correctly maintained after upsert via _seedRun', () => {
			_seedRun(makeRun({ runId: 'parent', parentRunId: null }));
			_seedRun(makeRun({ runId: 'child', parentRunId: 'parent' }));

			// childRunsForRun uses the index internally
			const children = agentRunsStore.childRunsForRun('parent');
			expect(children.map((c) => c.runId)).toEqual(['child']);
		});

		it('is correctly maintained after upsert via applyRunEvent (agent_run.spawned)', () => {
			// First seed the parent
			_seedRun(makeRun({ runId: 'parent', parentRunId: null }));

			// Then spawn a child via event
			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'child',
					type: 'agent_run.spawned',
					parentRunId: 'parent',
					data: { runId: 'child' },
				}),
			);

			const children = agentRunsStore.childRunsForRun('parent');
			expect(children.map((c) => c.runId)).toEqual(['child']);
		});

		it('is correctly maintained after upsert via applyRunEvent (agent_run.status_changed)', () => {
			// Seed parent first
			_seedRun(makeRun({ runId: 'parent', parentRunId: null }));

			// Status change for a new child (creates minimal entry)
			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'child',
					type: 'agent_run.status_changed',
					parentRunId: 'parent',
					data: { previousStatus: 'running', nextStatus: 'done' },
				}),
			);

			const children = agentRunsStore.childRunsForRun('parent');
			expect(children.map((c) => c.runId)).toEqual(['child']);
		});

		it('does not stale after resetAgentRunsStore', () => {
			_seedRun(makeRun({ runId: 'parent', parentRunId: null }));
			_seedRun(makeRun({ runId: 'child', parentRunId: 'parent' }));

			expect(agentRunsStore.childRunsForRun('parent')).toHaveLength(1);

			resetAgentRunsStore();

			// After reset, the index should be empty
			expect(agentRunsStore.childRunsForRun('parent')).toEqual([]);
		});

		it('handles parent reassignment (rare but supported)', () => {
			_seedRun(makeRun({ runId: 'old-parent', parentRunId: null }));
			_seedRun(makeRun({ runId: 'new-parent', parentRunId: null }));
			_seedRun(makeRun({ runId: 'child', parentRunId: 'old-parent' }));

			// Child is under old-parent
			expect(agentRunsStore.childRunsForRun('old-parent').map((c) => c.runId)).toEqual(['child']);
			expect(agentRunsStore.childRunsForRun('new-parent')).toEqual([]);

			// Reassign child to new-parent (rare edge case)
			_seedRun(makeRun({ runId: 'child', parentRunId: 'new-parent' }));

			// Index should reflect the move
			expect(agentRunsStore.childRunsForRun('old-parent')).toEqual([]);
			expect(agentRunsStore.childRunsForRun('new-parent').map((c) => c.runId)).toEqual(['child']);
		});
	});

	describe('tab management', () => {
		it('openRun + setActiveRun + closeRun follow a coherent lifecycle', () => {
			_seedRun(makeRun({ runId: 'r1' }));
			_seedRun(makeRun({ runId: 'r2' }));

			agentRunsStore.openRun('r1');
			agentRunsStore.openRun('r2');
			agentRunsStore.setActiveRun('r2');

			expect(agentRunsStore.openRunIds).toEqual(['r1', 'r2']);
			expect(agentRunsStore.activeRunId).toBe('r2');

			agentRunsStore.closeRun('r2');

			expect(agentRunsStore.openRunIds).toEqual(['r1']);
			// Active run falls back to the remaining tab when the active is closed.
			expect(agentRunsStore.activeRunId).toBe('r1');

			agentRunsStore.closeRun('r1');
			expect(agentRunsStore.openRunIds).toEqual([]);
			expect(agentRunsStore.activeRunId).toBeNull();
		});

		it('openRun is idempotent — opening the same runId twice is a no-op', () => {
			_seedRun(makeRun({ runId: 'r1' }));
			agentRunsStore.openRun('r1');
			agentRunsStore.openRun('r1');
			expect(agentRunsStore.openRunIds).toEqual(['r1']);
		});
	});

	describe('status tracking — unseen output (MH3 blue dot)', () => {
		it('marks non-active run as unseen when it receives a token', () => {
			_seedRun(makeRun({ runId: 'run-a' }));
			_seedRun(makeRun({ runId: 'run-b' }));
			agentRunsStore.setActiveRun('run-a'); // run-a is active

			// Token on non-active run-b should mark it unseen
			agentRunsStore.applyRunEvent(
				makeEnvelope({ runId: 'run-b', type: 'agent_run.token', seq: 1, data: { text: 'hello' } }),
			);

			expect(agentRunsStore.isUnseen('run-b')).toBe(true);
			expect(agentRunsStore.isUnseen('run-a')).toBe(false); // active run not marked
		});

		it('marks non-active run as unseen when it receives a tool_call', () => {
			_seedRun(makeRun({ runId: 'run-a' }));
			_seedRun(makeRun({ runId: 'run-b' }));
			agentRunsStore.setActiveRun('run-a');

			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'run-b',
					type: 'agent_run.tool_call',
					seq: 1,
					data: { id: 'tc-1', name: 'bash', arguments: {} },
				}),
			);

			expect(agentRunsStore.isUnseen('run-b')).toBe(true);
		});

		it('marks non-active run as unseen when it receives a tool_result', () => {
			_seedRun(makeRun({ runId: 'run-a' }));
			_seedRun(makeRun({ runId: 'run-b' }));
			agentRunsStore.setActiveRun('run-a');

			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'run-b',
					type: 'agent_run.tool_result',
					seq: 1,
					data: { toolCallId: 'tc-1', content: 'output', isError: false },
				}),
			);

			expect(agentRunsStore.isUnseen('run-b')).toBe(true);
		});

		it('does NOT mark active run as unseen when it receives events', () => {
			_seedRun(makeRun({ runId: 'run-a' }));
			agentRunsStore.setActiveRun('run-a'); // run-a is active

			agentRunsStore.applyRunEvent(
				makeEnvelope({ runId: 'run-a', type: 'agent_run.token', seq: 1, data: { text: 'hello' } }),
			);
			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'run-a',
					type: 'agent_run.tool_call',
					seq: 2,
					data: { id: 'tc-1', name: 'bash', arguments: {} },
				}),
			);

			expect(agentRunsStore.isUnseen('run-a')).toBe(false);
		});

		it('clears unseen flag when setActiveRun is called for that run', () => {
			_seedRun(makeRun({ runId: 'run-a' }));
			_seedRun(makeRun({ runId: 'run-b' }));
			agentRunsStore.setActiveRun('run-a');

			// Mark run-b as unseen
			agentRunsStore.applyRunEvent(
				makeEnvelope({ runId: 'run-b', type: 'agent_run.token', seq: 1, data: { text: 'hello' } }),
			);
			expect(agentRunsStore.isUnseen('run-b')).toBe(true);

			// Navigate to run-b — unseen flag should clear
			agentRunsStore.setActiveRun('run-b');
			expect(agentRunsStore.isUnseen('run-b')).toBe(false);
		});

		it('is isolated per runId — flags for run A do not affect run B', () => {
			_seedRun(makeRun({ runId: 'run-a' }));
			_seedRun(makeRun({ runId: 'run-b' }));
			_seedRun(makeRun({ runId: 'run-c' }));
			agentRunsStore.setActiveRun('run-a');

			// Mark run-b and run-c as unseen
			agentRunsStore.applyRunEvent(
				makeEnvelope({ runId: 'run-b', type: 'agent_run.token', seq: 1, data: { text: 'B' } }),
			);
			agentRunsStore.applyRunEvent(
				makeEnvelope({ runId: 'run-c', type: 'agent_run.token', seq: 1, data: { text: 'C' } }),
			);

			expect(agentRunsStore.isUnseen('run-a')).toBe(false);
			expect(agentRunsStore.isUnseen('run-b')).toBe(true);
			expect(agentRunsStore.isUnseen('run-c')).toBe(true);

			// Clear run-b by navigating to it
			agentRunsStore.setActiveRun('run-b');
			expect(agentRunsStore.isUnseen('run-b')).toBe(false);
			expect(agentRunsStore.isUnseen('run-c')).toBe(true); // run-c still unseen
		});

		it('is cleared by resetAgentRunsStore', () => {
			_seedRun(makeRun({ runId: 'run-a' }));
			agentRunsStore.setActiveRun(null); // no active run

			agentRunsStore.applyRunEvent(
				makeEnvelope({ runId: 'run-a', type: 'agent_run.token', seq: 1, data: { text: 'hello' } }),
			);
			expect(agentRunsStore.isUnseen('run-a')).toBe(true);

			resetAgentRunsStore();
			expect(agentRunsStore.isUnseen('run-a')).toBe(false);
		});
	});

	describe('status tracking — awaiting question (MH3 yellow dot)', () => {
		it('sets awaitingQuestion flag on agent_run.question event', () => {
			_seedRun(makeRun({ runId: 'run-a' }));

			expect(agentRunsStore.isAwaitingQuestion('run-a')).toBe(false);

			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'run-a',
					type: 'agent_run.question',
					seq: 1,
					data: {
						questionId: 'q-1',
						question: 'Continue?',
						options: [{ label: 'yes' }],
						multiple: false,
					},
				}),
			);

			expect(agentRunsStore.isAwaitingQuestion('run-a')).toBe(true);
		});

		it('clears awaitingQuestion flag on subsequent token event', () => {
			_seedRun(makeRun({ runId: 'run-a' }));

			// Set the flag via question
			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'run-a',
					type: 'agent_run.question',
					seq: 1,
					data: { questionId: 'q-1', question: 'Continue?', options: [], multiple: false },
				}),
			);
			expect(agentRunsStore.isAwaitingQuestion('run-a')).toBe(true);

			// Clear via token
			agentRunsStore.applyRunEvent(
				makeEnvelope({ runId: 'run-a', type: 'agent_run.token', seq: 2, data: { text: 'ok' } }),
			);
			expect(agentRunsStore.isAwaitingQuestion('run-a')).toBe(false);
		});

		it('clears awaitingQuestion flag on subsequent tool_call event', () => {
			_seedRun(makeRun({ runId: 'run-a' }));

			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'run-a',
					type: 'agent_run.question',
					seq: 1,
					data: { questionId: 'q-1', question: 'Continue?', options: [], multiple: false },
				}),
			);
			expect(agentRunsStore.isAwaitingQuestion('run-a')).toBe(true);

			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'run-a',
					type: 'agent_run.tool_call',
					seq: 2,
					data: { id: 'tc-1', name: 'bash', arguments: {} },
				}),
			);
			expect(agentRunsStore.isAwaitingQuestion('run-a')).toBe(false);
		});

		it('clears awaitingQuestion flag on subsequent tool_result event', () => {
			_seedRun(makeRun({ runId: 'run-a' }));

			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'run-a',
					type: 'agent_run.question',
					seq: 1,
					data: { questionId: 'q-1', question: 'Continue?', options: [], multiple: false },
				}),
			);
			expect(agentRunsStore.isAwaitingQuestion('run-a')).toBe(true);

			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'run-a',
					type: 'agent_run.tool_result',
					seq: 2,
					data: { toolCallId: 'tc-1', content: 'result', isError: false },
				}),
			);
			expect(agentRunsStore.isAwaitingQuestion('run-a')).toBe(false);
		});

		it('is isolated per runId — question on run A does not affect run B', () => {
			_seedRun(makeRun({ runId: 'run-a' }));
			_seedRun(makeRun({ runId: 'run-b' }));

			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'run-a',
					type: 'agent_run.question',
					seq: 1,
					data: { questionId: 'q-1', question: 'Continue?', options: [], multiple: false },
				}),
			);

			expect(agentRunsStore.isAwaitingQuestion('run-a')).toBe(true);
			expect(agentRunsStore.isAwaitingQuestion('run-b')).toBe(false);
		});

		it('is cleared by resetAgentRunsStore', () => {
			_seedRun(makeRun({ runId: 'run-a' }));

			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'run-a',
					type: 'agent_run.question',
					seq: 1,
					data: { questionId: 'q-1', question: 'Continue?', options: [], multiple: false },
				}),
			);
			expect(agentRunsStore.isAwaitingQuestion('run-a')).toBe(true);

			resetAgentRunsStore();
		expect(agentRunsStore.isAwaitingQuestion('run-a')).toBe(false);
	});
});

describe('e2e integration — spawn → card → navigate → back', () => {
	/**
	 * End-to-end integration test covering MH1, MH2, MH4, MH5, MH6, MH7.
	 *
	 * This test verifies the complete desktop-side user journey:
	 *   1. Store receives agent_run.spawned → child appears in childRunsForRun (MH4)
	 *   2. Store receives agent_run.tool_call_metadata → transcript entry gets metadata.runId (MH7)
	 *   3. computeRenderBlocks resolves resolvedRunId (MH6)
	 *   4. isUnseen(childRunId) is true when child produces output while not active (MH3)
	 *   5. setActiveRun(childRunId) clears unseen flag
	 *   6. activeChildPath returns the chain from root to active
	 */
	beforeEach(() => {
		resetAgentRunsStore();
	});

	afterEach(() => {
		resetAgentRunsStore();
	});

	it('full journey: spawn → card → navigate → back', () => {
		const parentRunId = 'parent-run-123';
		const childRunId = 'child-run-456';
		const sessionId = 'sess-e2e';
		const projectId = 'proj-e2e';
		const toolCallId = 'call_abc123';

		// Step 1: Seed parent run
		_seedRun(
			makeRun({
				runId: parentRunId,
				sessionId,
				projectId,
				parentRunId: null,
				title: 'Parent Run',
				status: 'running',
			}),
		);

		// Verify parent exists
		expect(agentRunsStore.runs[parentRunId]).toBeDefined();
		expect(agentRunsStore.runs[parentRunId].status).toBe('running');

		// Step 2: Simulate task tool call in parent transcript (MH6)
		agentRunsStore.applyRunEvent(
			makeEnvelope({
				runId: parentRunId,
				type: 'agent_run.tool_call',
				seq: 1,
				data: {
					id: toolCallId,
					name: 'task',
					arguments: {
						description: 'Test child task',
						agent_type: 'executor',
						prompt: 'Do something',
					},
				},
			}),
		);

		// Verify tool_call entry exists in parent transcript
		const parentTranscript = agentRunsStore.transcripts[parentRunId] ?? [];
		expect(parentTranscript).toHaveLength(1);
		expect(parentTranscript[0].kind).toBe('tool_call');
		if (parentTranscript[0].kind === 'tool_call') {
			expect(parentTranscript[0].name).toBe('task');
			expect(parentTranscript[0].metadata).toBeUndefined(); // Not yet merged
		}

		// Step 3: Simulate agent_run.spawned for child (MH1, MH4)
		agentRunsStore.applyRunEvent(
			makeEnvelope({
				runId: childRunId,
				sessionId,
				projectId,
				parentRunId,
				agentType: 'executor',
				title: 'Test child task',
				type: 'agent_run.spawned',
				data: { runId: childRunId, contextMode: 'inherit_session' },
			}),
		);

		// Verify child appears in store
		expect(agentRunsStore.runs[childRunId]).toBeDefined();
		expect(agentRunsStore.runs[childRunId].parentRunId).toBe(parentRunId);
		expect(agentRunsStore.runs[childRunId].status).toBe('running');
		expect(agentRunsStore.runs[childRunId].contextMode).toBe('inherit_session');

		// Step 4: Verify child appears in childRunsForRun(parentRunId) (MH4)
		const children = agentRunsStore.childRunsForRun(parentRunId);
		expect(children).toHaveLength(1);
		expect(children[0].runId).toBe(childRunId);
		expect(children[0].title).toBe('Test child task');

		// Step 5: Simulate agent_run.status_changed for child completion (MH5)
		// Child runs start as 'running' from spawned event, then transition to 'done'
		agentRunsStore.applyRunEvent(
			makeEnvelope({
				runId: childRunId,
				type: 'agent_run.status_changed',
				seq: 2,
				data: { previousStatus: 'running', nextStatus: 'done' },
			}),
		);

		expect(agentRunsStore.runs[childRunId].status).toBe('done');

		// Step 6: Simulate agent_run.tool_call_metadata (MH7)
		agentRunsStore.applyRunEvent(
			makeEnvelope({
				runId: parentRunId,
				type: 'agent_run.tool_call_metadata',
				seq: 3,
				data: {
					toolCallId,
					runId: childRunId,
					parentRunId,
					agentType: 'executor',
					title: 'Test child task',
				},
			}),
		);

		// Verify metadata merged onto tool_call entry
		const updatedTranscript = agentRunsStore.transcripts[parentRunId] ?? [];
		expect(updatedTranscript).toHaveLength(1);
		expect(updatedTranscript[0].kind).toBe('tool_call');
		if (updatedTranscript[0].kind === 'tool_call') {
			expect(updatedTranscript[0].metadata).toBeDefined();
			expect(updatedTranscript[0].metadata!.runId).toBe(childRunId);
			expect(updatedTranscript[0].metadata!.parentRunId).toBe(parentRunId);
			expect(updatedTranscript[0].metadata!.agentType).toBe('executor');
		}

		// Step 7: Verify computeRenderBlocks resolves resolvedRunId (MH6)
		const childRuns = agentRunsStore.childRunsForRun(parentRunId);
		const blocks = computeRenderBlocks(updatedTranscript, { childRuns });

		expect(blocks).toHaveLength(1);
		expect(blocks[0].kind).toBe('task');
		if (blocks[0].kind === 'task') {
			// Should resolve via metadata (tier 1)
			expect(blocks[0].resolvedRunId).toBe(childRunId);
			expect(blocks[0].title).toBe('Test child task');
			expect(blocks[0].agentType).toBe('executor');
		}

		// Step 8: Simulate child producing output while parent is active (MH3 unseen)
		agentRunsStore.setActiveRun(parentRunId); // Parent is active

		agentRunsStore.applyRunEvent(
			makeEnvelope({
				runId: childRunId,
				type: 'agent_run.token',
				seq: 4,
				data: { text: 'Child output' },
			}),
		);

		// Child should be marked unseen (produced output while not active)
		expect(agentRunsStore.isUnseen(childRunId)).toBe(true);
		expect(agentRunsStore.isUnseen(parentRunId)).toBe(false); // Active parent not unseen

		// Step 9: Navigate to child — unseen flag clears
		agentRunsStore.setActiveRun(childRunId);
		expect(agentRunsStore.isUnseen(childRunId)).toBe(false);
		expect(agentRunsStore.activeRunId).toBe(childRunId);

		// Step 10: Verify activeChildPath returns the chain
		const path = agentRunsStore.activeChildPath(parentRunId, childRunId);
		expect(path.map((r) => r.runId)).toEqual([parentRunId, childRunId]);

		// Step 11: Child done event (terminal event, status already 'done' from step 5)
		agentRunsStore.applyRunEvent(
			makeEnvelope({
				runId: childRunId,
				type: 'agent_run.done',
				seq: 5,
			}),
		);

		expect(agentRunsStore.runs[childRunId].status).toBe('done');

		// Step 12: Navigate back to parent
		agentRunsStore.setActiveRun(parentRunId);
		expect(agentRunsStore.activeRunId).toBe(parentRunId);

		// Verify path from parent to itself
		const parentOnlyPath = agentRunsStore.activeChildPath(parentRunId, parentRunId);
		expect(parentOnlyPath.map((r) => r.runId)).toEqual([parentRunId]);
	});

	it('runId resolution falls back to title match when metadata absent', () => {
		const parentRunId = 'parent-789';
		const childRunId = 'child-abc';
		const toolCallId = 'call_def456';

		// Seed parent and child
		_seedRun(
			makeRun({
				runId: parentRunId,
				parentRunId: null,
				title: 'Parent',
			}),
		);
		_seedRun(
			makeRun({
				runId: childRunId,
				parentRunId,
				title: 'Fallback match task',
			}),
		);

		// Tool call without metadata
		agentRunsStore.applyRunEvent(
			makeEnvelope({
				runId: parentRunId,
				type: 'agent_run.tool_call',
				seq: 1,
				data: {
					id: toolCallId,
					name: 'task',
					arguments: {
						description: 'Fallback match task', // Matches child title
						agent_type: 'executor',
					},
				},
			}),
		);

		// Verify fallback resolution works
		const transcript = agentRunsStore.transcripts[parentRunId] ?? [];
		const childRuns = agentRunsStore.childRunsForRun(parentRunId);
		const blocks = computeRenderBlocks(transcript, { childRuns });

		expect(blocks).toHaveLength(1);
		expect(blocks[0].kind).toBe('task');
		if (blocks[0].kind === 'task') {
			// Should resolve via title fallback (tier 2)
			expect(blocks[0].resolvedRunId).toBe(childRunId);
		}
	});

	it('runId resolution returns null when no metadata and no matching child', () => {
		const parentRunId = 'parent-xyz';
		const toolCallId = 'call_ghi789';

		_seedRun(
			makeRun({
				runId: parentRunId,
				parentRunId: null,
				title: 'Parent',
			}),
		);

		// Tool call without metadata, no matching child
		agentRunsStore.applyRunEvent(
			makeEnvelope({
				runId: parentRunId,
				type: 'agent_run.tool_call',
				seq: 1,
				data: {
					id: toolCallId,
					name: 'task',
					arguments: {
						description: 'No matching child',
						agent_type: 'executor',
					},
				},
			}),
		);

		// Verify null resolution (spawning state)
		const transcript = agentRunsStore.transcripts[parentRunId] ?? [];
		const childRuns = agentRunsStore.childRunsForRun(parentRunId); // Empty
		const blocks = computeRenderBlocks(transcript, { childRuns });

		expect(blocks).toHaveLength(1);
		expect(blocks[0].kind).toBe('task');
		if (blocks[0].kind === 'task') {
			// Should be null (tier 3 — spawning state)
			expect(blocks[0].resolvedRunId).toBeNull();
		}
	});
});

	describe('agent_run.tool_call_metadata', () => {
		it('merges metadata onto existing tool_call entry by toolCallId', () => {
			_seedRun(makeRun({ runId: 'run-a' }));

			// First, add a tool_call entry
			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'run-a',
					type: 'agent_run.tool_call',
					seq: 1,
					data: {
						id: 'tc-1',
						name: 'task',
						arguments: { description: 'Test task', agent_type: 'executor' },
					},
				}),
			);

			// Verify the entry exists without metadata
			let entries = agentRunsStore.transcripts['run-a'] ?? [];
			expect(entries).toHaveLength(1);
			expect(entries[0].kind).toBe('tool_call');
			if (entries[0].kind === 'tool_call') {
				expect(entries[0].metadata).toBeUndefined();
			}

			// Now send the metadata event
			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'run-a',
					type: 'agent_run.tool_call_metadata',
					seq: 2,
					data: {
						toolCallId: 'tc-1',
						runId: 'child-run-123',
						parentRunId: 'run-a',
						agentType: 'executor',
						title: 'Child run',
					},
				}),
			);

			// Verify metadata was merged
			entries = agentRunsStore.transcripts['run-a'] ?? [];
			expect(entries).toHaveLength(1);
			expect(entries[0].kind).toBe('tool_call');
			if (entries[0].kind === 'tool_call') {
				expect(entries[0].metadata).toBeDefined();
				expect(entries[0].metadata!.runId).toBe('child-run-123');
				expect(entries[0].metadata!.parentRunId).toBe('run-a');
				expect(entries[0].metadata!.agentType).toBe('executor');
				expect(entries[0].metadata!.title).toBe('Child run');
			}
		});

		it('ignores metadata for non-existent toolCallId', () => {
			_seedRun(makeRun({ runId: 'run-a' }));

			// Add a tool_call entry with a different id
			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'run-a',
					type: 'agent_run.tool_call',
					seq: 1,
					data: {
						id: 'tc-1',
						name: 'task',
						arguments: { description: 'Test task' },
					},
				}),
			);

			// Send metadata for a different toolCallId
			agentRunsStore.applyRunEvent(
				makeEnvelope({
					runId: 'run-a',
					type: 'agent_run.tool_call_metadata',
					seq: 2,
					data: {
						toolCallId: 'tc-nonexistent',
						runId: 'child-run-123',
						agentType: 'executor',
						title: 'Child run',
					},
				}),
			);

			// Verify the original entry still has no metadata
			const entries = agentRunsStore.transcripts['run-a'] ?? [];
			expect(entries).toHaveLength(1);
			expect(entries[0].kind).toBe('tool_call');
			if (entries[0].kind === 'tool_call') {
				expect(entries[0].metadata).toBeUndefined();
			}
		});

		it('ignores metadata for non-existent runId', () => {
			// Send metadata for a run that doesn't exist
			expect(() =>
				agentRunsStore.applyRunEvent(
					makeEnvelope({
						runId: 'nonexistent-run',
						type: 'agent_run.tool_call_metadata',
						seq: 1,
						data: {
							toolCallId: 'tc-1',
							runId: 'child-run-123',
							agentType: 'executor',
							title: 'Child run',
						},
					}),
				),
			).not.toThrow();
		});
	});
});
