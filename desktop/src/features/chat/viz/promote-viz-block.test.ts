import { describe, it, expect } from 'bun:test';
import { promoteVizBlock } from './promote-viz-block.js';
import type { ToolCallDisplay } from '../types.js';

const validEnvelope = {
	id: 'viz-1',
	type: 'loading',
	intent: 'Show loading progress',
	title: 'Researching…',
	data: { msg: 'Searching…' },
};

function makeToolCall(overrides: Partial<ToolCallDisplay> = {}): ToolCallDisplay {
	return {
		id: 'tc-1',
		name: 'visualize',
		arguments: {},
		...overrides,
	};
}

describe('promoteVizBlock', () => {
	it('promotes a visualize tool call with a valid result to a viz block', () => {
		const toolCall = makeToolCall({
			result: {
				toolCallId: 'tc-1',
				content: JSON.stringify(validEnvelope),
				isError: false,
			},
		});

		const block = promoteVizBlock(toolCall);

		expect(block.type).toBe('viz');
		if (block.type === 'viz') {
			expect(block.envelope.id).toBe('viz-1');
			expect(block.envelope.type).toBe('loading');
			expect(block.envelope.intent).toBe('Show loading progress');
			expect(block.envelope.data).toEqual({ msg: 'Searching…' });
		}
	});

	it('falls back to tool_call when result content is malformed JSON', () => {
		const toolCall = makeToolCall({
			result: {
				toolCallId: 'tc-1',
				content: 'not valid json {{{',
				isError: false,
			},
		});

		const block = promoteVizBlock(toolCall);

		expect(block.type).toBe('tool_call');
		if (block.type === 'tool_call') {
			expect(block.toolCall).toBe(toolCall);
		}
	});

	it('falls back to tool_call when result content is missing required fields', () => {
		const toolCall = makeToolCall({
			result: {
				toolCallId: 'tc-1',
				content: JSON.stringify({ id: 'viz-1', type: 'loading' }),
				isError: false,
			},
		});

		const block = promoteVizBlock(toolCall);

		expect(block.type).toBe('tool_call');
	});

	it('falls back to tool_call when no result is present yet (still running)', () => {
		const toolCall = makeToolCall({});

		const block = promoteVizBlock(toolCall);

		expect(block.type).toBe('tool_call');
		if (block.type === 'tool_call') {
			expect(block.toolCall).toBe(toolCall);
		}
	});

	it('falls back to tool_call when result content is empty string', () => {
		const toolCall = makeToolCall({
			result: {
				toolCallId: 'tc-1',
				content: '',
				isError: false,
			},
		});

		const block = promoteVizBlock(toolCall);

		expect(block.type).toBe('tool_call');
	});

	it('does not promote non-visualize tool calls even with viz-shaped content', () => {
		const toolCall = makeToolCall({
			name: 'bash',
			result: {
				toolCallId: 'tc-1',
				content: JSON.stringify(validEnvelope),
				isError: false,
			},
		});

		const block = promoteVizBlock(toolCall);

		expect(block.type).toBe('tool_call');
		if (block.type === 'tool_call') {
			expect(block.toolCall.name).toBe('bash');
		}
	});

	it('does not mutate the input tool call', () => {
		const toolCall = makeToolCall({
			result: {
				toolCallId: 'tc-1',
				content: JSON.stringify(validEnvelope),
				isError: false,
			},
		});
		const snapshotName = toolCall.name;
		const snapshotResultContent = toolCall.result?.content;

		promoteVizBlock(toolCall);

		expect(toolCall.name).toBe(snapshotName);
		expect(toolCall.result?.content).toBe(snapshotResultContent);
	});
});
