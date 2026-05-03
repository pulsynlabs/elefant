import { describe, it, expect } from 'bun:test';
import { computeRenderBlocks } from './agent-run-transcript-blocks.js';
import type { AgentRunTranscriptEntry } from '$lib/types/agent-run.js';

describe('computeRenderBlocks — visualize tool', () => {
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

		const blocks = computeRenderBlocks(entries);

		expect(blocks).toHaveLength(2);
		expect(blocks[0].kind).toBe('text');
		expect(blocks[1].kind).toBe('text');
		expect(blocks.some((b) => b.kind === 'tool')).toBe(false);
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

		const blocks = computeRenderBlocks(entries);

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

		const blocks = computeRenderBlocks(entries);

		expect(blocks).toHaveLength(1);
		expect(blocks[0].kind).toBe('tool');
		if (blocks[0].kind === 'tool') {
			expect(blocks[0].toolCall.name).toBe('bash');
			expect(blocks[0].toolCall.result?.content).toBe('file.txt');
		}
	});
});
