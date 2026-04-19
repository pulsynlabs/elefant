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
