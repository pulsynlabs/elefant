import { describe, it, expect } from 'bun:test';
import { computeRenderBlocks } from './agent-run-transcript-blocks.js';
import type { AgentRunTranscriptEntry } from '$lib/types/agent-run.js';

describe('computeRenderBlocks — visualize tool (subagent suppression)', () => {
	it('silently skips visualize tool calls in subagent transcripts', () => {
		const entries: AgentRunTranscriptEntry[] = [
			{ kind: 'token', text: 'Working…', seq: 1 },
			{
				kind: 'tool_call',
				id: 'tc-viz-1',
				name: 'visualize',
				arguments: { type: 'loading', data: {}, intent: 'show progress' },
				seq: 2,
			},
			{ kind: 'token', text: 'Done.', seq: 3 },
		];

		const blocks = computeRenderBlocks(entries, { isOrchestrator: false });

		expect(blocks).toHaveLength(2);
		expect(blocks[0].kind).toBe('text');
		expect(blocks[1].kind).toBe('text');
		expect(blocks.some((b) => b.kind === 'tool')).toBe(false);
		expect(blocks.some((b) => b.kind === 'viz')).toBe(false);
	});

	it('defaults to subagent behaviour when isOrchestrator is omitted', () => {
		// Default-safe: callers without a run context (early hydration,
		// pre-existing tests) preserve the historical suppression
		// behaviour rather than leaking viz onto unintended surfaces.
		const entries: AgentRunTranscriptEntry[] = [
			{
				kind: 'tool_call',
				id: 'tc-viz-1',
				name: 'visualize',
				arguments: { type: 'loading', data: {}, intent: 'show progress' },
				seq: 1,
			},
		];

		const blocks = computeRenderBlocks(entries);

		expect(blocks).toHaveLength(0);
	});

	it('suppresses the trailing tool_result for skipped visualize calls', () => {
		const entries: AgentRunTranscriptEntry[] = [
			{
				kind: 'tool_call',
				id: 'tc-viz-1',
				name: 'visualize',
				arguments: { type: 'loading', data: {}, intent: 'show progress' },
				seq: 1,
			},
			{
				kind: 'tool_result',
				toolCallId: 'tc-viz-1',
				content: '{"id":"v1","type":"loading","intent":"x","data":{}}',
				isError: false,
				seq: 2,
			},
		];

		const blocks = computeRenderBlocks(entries, { isOrchestrator: false });

		expect(blocks).toHaveLength(0);
	});

	it('still renders non-visualize tool calls normally alongside skipped ones', () => {
		const entries: AgentRunTranscriptEntry[] = [
			{
				kind: 'tool_call',
				id: 'tc-bash-1',
				name: 'bash',
				arguments: { command: 'ls' },
				seq: 1,
			},
			{
				kind: 'tool_call',
				id: 'tc-viz-1',
				name: 'visualize',
				arguments: { type: 'loading', data: {}, intent: 'show progress' },
				seq: 2,
			},
			{
				kind: 'tool_result',
				toolCallId: 'tc-bash-1',
				content: 'file.txt',
				isError: false,
				seq: 3,
			},
			{
				kind: 'tool_result',
				toolCallId: 'tc-viz-1',
				content: '{}',
				isError: false,
				seq: 4,
			},
		];

		const blocks = computeRenderBlocks(entries, { isOrchestrator: false });

		expect(blocks).toHaveLength(1);
		expect(blocks[0].kind).toBe('tool');
		if (blocks[0].kind === 'tool') {
			expect(blocks[0].toolCall.name).toBe('bash');
			expect(blocks[0].toolCall.result?.content).toBe('file.txt');
		}
	});
});

describe('computeRenderBlocks — visualize tool (orchestrator rendering)', () => {
	const validEnvelope = {
		id: 'v1',
		type: 'loading' as const,
		intent: 'show progress',
		data: { label: 'Loading…' },
	};

	it('promotes a completed visualize tool call to a viz render block', () => {
		const entries: AgentRunTranscriptEntry[] = [
			{ kind: 'token', text: 'Generating diagram…', seq: 1 },
			{
				kind: 'tool_call',
				id: 'tc-viz-1',
				name: 'visualize',
				arguments: {
					type: 'loading',
					intent: 'show progress',
					data: { label: 'Loading…' },
				},
				seq: 2,
			},
			{
				kind: 'tool_result',
				toolCallId: 'tc-viz-1',
				content: JSON.stringify(validEnvelope),
				isError: false,
				seq: 3,
			},
		];

		const blocks = computeRenderBlocks(entries, { isOrchestrator: true });

		expect(blocks).toHaveLength(2);
		expect(blocks[0].kind).toBe('text');
		expect(blocks[1].kind).toBe('viz');
		if (blocks[1].kind === 'viz') {
			expect(blocks[1].id).toBe('viz-tc-viz-1');
			expect(blocks[1].envelope.id).toBe('v1');
			expect(blocks[1].envelope.type).toBe('loading');
			expect(blocks[1].envelope.intent).toBe('show progress');
		}
	});

	it('renders a placeholder tool block while a viz call is still running, then upgrades it', () => {
		// Pending state — only the tool_call has arrived.
		const pending = computeRenderBlocks(
			[
				{
					kind: 'tool_call',
					id: 'tc-viz-1',
					name: 'visualize',
					arguments: { type: 'loading', data: {}, intent: 'x' },
					seq: 1,
				},
			],
			{ isOrchestrator: true },
		);
		expect(pending).toHaveLength(1);
		expect(pending[0].kind).toBe('tool');

		// Completed state — both events present.
		const completed = computeRenderBlocks(
			[
				{
					kind: 'tool_call',
					id: 'tc-viz-1',
					name: 'visualize',
					arguments: { type: 'loading', data: {}, intent: 'x' },
					seq: 1,
				},
				{
					kind: 'tool_result',
					toolCallId: 'tc-viz-1',
					content: JSON.stringify(validEnvelope),
					isError: false,
					seq: 2,
				},
			],
			{ isOrchestrator: true },
		);
		expect(completed).toHaveLength(1);
		expect(completed[0].kind).toBe('viz');
	});

	it('falls back to a tool block when the result content is malformed', () => {
		const entries: AgentRunTranscriptEntry[] = [
			{
				kind: 'tool_call',
				id: 'tc-viz-1',
				name: 'visualize',
				arguments: { type: 'loading', data: {}, intent: 'x' },
				seq: 1,
			},
			{
				kind: 'tool_result',
				toolCallId: 'tc-viz-1',
				content: 'not-json',
				isError: false,
				seq: 2,
			},
		];

		const blocks = computeRenderBlocks(entries, { isOrchestrator: true });

		expect(blocks).toHaveLength(1);
		expect(blocks[0].kind).toBe('tool');
		if (blocks[0].kind === 'tool') {
			expect(blocks[0].toolCall.name).toBe('visualize');
		}
	});

	it('renders multiple viz blocks interleaved with text and other tool calls', () => {
		const envelopeA = { ...validEnvelope, id: 'v-a' };
		const envelopeB = { ...validEnvelope, id: 'v-b' };

		const entries: AgentRunTranscriptEntry[] = [
			{ kind: 'token', text: 'First diagram:', seq: 1 },
			{
				kind: 'tool_call',
				id: 'tc-viz-a',
				name: 'visualize',
				arguments: { type: 'loading', data: {}, intent: 'a' },
				seq: 2,
			},
			{
				kind: 'tool_result',
				toolCallId: 'tc-viz-a',
				content: JSON.stringify(envelopeA),
				isError: false,
				seq: 3,
			},
			{
				kind: 'tool_call',
				id: 'tc-bash-1',
				name: 'bash',
				arguments: { command: 'ls' },
				seq: 4,
			},
			{
				kind: 'tool_result',
				toolCallId: 'tc-bash-1',
				content: 'file.txt',
				isError: false,
				seq: 5,
			},
			{ kind: 'token', text: 'Second diagram:', seq: 6 },
			{
				kind: 'tool_call',
				id: 'tc-viz-b',
				name: 'visualize',
				arguments: { type: 'loading', data: {}, intent: 'b' },
				seq: 7,
			},
			{
				kind: 'tool_result',
				toolCallId: 'tc-viz-b',
				content: JSON.stringify(envelopeB),
				isError: false,
				seq: 8,
			},
		];

		const blocks = computeRenderBlocks(entries, { isOrchestrator: true });

		expect(blocks.map((b) => b.kind)).toEqual([
			'text',
			'viz',
			'tool',
			'text',
			'viz',
		]);
		const vizBlocks = blocks.filter((b) => b.kind === 'viz');
		expect(vizBlocks).toHaveLength(2);
		if (vizBlocks[0].kind === 'viz' && vizBlocks[1].kind === 'viz') {
			expect(vizBlocks[0].envelope.id).toBe('v-a');
			expect(vizBlocks[1].envelope.id).toBe('v-b');
		}
	});

	it('preserves the order of viz blocks even when results arrive out of order', () => {
		// First viz call's result arrives AFTER the second viz call.
		const envelopeA = { ...validEnvelope, id: 'v-a' };
		const envelopeB = { ...validEnvelope, id: 'v-b' };

		const entries: AgentRunTranscriptEntry[] = [
			{
				kind: 'tool_call',
				id: 'tc-viz-a',
				name: 'visualize',
				arguments: { type: 'loading', data: {}, intent: 'a' },
				seq: 1,
			},
			{
				kind: 'tool_call',
				id: 'tc-viz-b',
				name: 'visualize',
				arguments: { type: 'loading', data: {}, intent: 'b' },
				seq: 2,
			},
			{
				kind: 'tool_result',
				toolCallId: 'tc-viz-b',
				content: JSON.stringify(envelopeB),
				isError: false,
				seq: 3,
			},
			{
				kind: 'tool_result',
				toolCallId: 'tc-viz-a',
				content: JSON.stringify(envelopeA),
				isError: false,
				seq: 4,
			},
		];

		const blocks = computeRenderBlocks(entries, { isOrchestrator: true });

		expect(blocks).toHaveLength(2);
		expect(blocks[0].kind).toBe('viz');
		expect(blocks[1].kind).toBe('viz');
		if (blocks[0].kind === 'viz' && blocks[1].kind === 'viz') {
			// Original tool_call order preserved despite swapped result order.
			expect(blocks[0].envelope.id).toBe('v-a');
			expect(blocks[1].envelope.id).toBe('v-b');
		}
	});
});
