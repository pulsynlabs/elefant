import { describe, expect, it } from 'bun:test';
import { estimateMessageTokens, estimateStringTokens } from './tokens.ts';
import type { Message } from '../types/providers.ts';

describe('estimateStringTokens', () => {
	it('returns 0 for empty string', () => {
		expect(estimateStringTokens('')).toBe(0);
	});

	it('uses /4 divisor for plain text', () => {
		const text = 'This is a plain text message with no code.';
		const expected = Math.ceil(text.length / 4);

		expect(estimateStringTokens(text)).toBe(expected);
	});

	it('uses /3 divisor for JSON object string', () => {
		const json = '{ "key": "value", "num": 123 }';
		const expected = Math.ceil(json.length / 3);

		expect(estimateStringTokens(json)).toBe(expected);
	});

	it('uses /3 divisor for JSON array string', () => {
		const json = '[1, 2, 3, 4, 5]';
		const expected = Math.ceil(json.length / 3);

		expect(estimateStringTokens(json)).toBe(expected);
	});

	it('uses /3 divisor for code-shaped string with dense braces', () => {
		const code = 'function test() { if (true) { return { a: 1, b: 2 }; } }';
		const expected = Math.ceil(code.length / 3);

		expect(estimateStringTokens(code)).toBe(expected);
	});

	it('uses /4 divisor for text with sparse structural chars', () => {
		const text = 'Hello: world. This has: some colons but not enough density.';

		expect(estimateStringTokens(text)).toBe(Math.ceil(text.length / 4));
	});

	it('detects code by starting with {', () => {
		const code = '{ foo: bar }';

		expect(estimateStringTokens(code)).toBe(Math.ceil(code.length / 3));
	});

	it('detects code by starting with [', () => {
		const code = '[foo, bar, baz]';

		expect(estimateStringTokens(code)).toBe(Math.ceil(code.length / 3));
	});

	it('handles whitespace before structural detection', () => {
		const code = '   { "key": "value" }';

		expect(estimateStringTokens(code)).toBe(Math.ceil(code.length / 3));
	});
});

describe('estimateMessageTokens', () => {
	it('returns 0 for empty message list', () => {
		expect(estimateMessageTokens([])).toBe(0);
	});

	it('estimates single plain text message', () => {
		const messages: Message[] = [
			{ role: 'user', content: 'Hello world' },
		];
		const expected = Math.ceil('Hello world'.length / 4);

		expect(estimateMessageTokens(messages)).toBe(expected);
	});

	it('estimates single JSON message with /3', () => {
		const messages: Message[] = [
			{ role: 'user', content: '{ "action": "test" }' },
		];
		const expected = Math.ceil('{ "action": "test" }'.length / 3);

		expect(estimateMessageTokens(messages)).toBe(expected);
	});

	it('sums multiple messages', () => {
		const messages: Message[] = [
			{ role: 'user', content: 'Hello world' },
			{ role: 'assistant', content: '{ "result": "success" }' },
		];
		const expected1 = Math.ceil('Hello world'.length / 4);
		const expected2 = Math.ceil('{ "result": "success" }'.length / 3);

		expect(estimateMessageTokens(messages)).toBe(expected1 + expected2);
	});

	it('handles mixed content (some JSON, some plain)', () => {
		const messages: Message[] = [
			{ role: 'system', content: 'You are a helpful assistant.' },
			{ role: 'user', content: '{ "query": "help" }' },
			{ role: 'assistant', content: 'I can help you with that!' },
			{ role: 'user', content: '[1, 2, 3]' },
		];

		const expected1 = Math.ceil('You are a helpful assistant.'.length / 4);
		const expected2 = Math.ceil('{ "query": "help" }'.length / 3);
		const expected3 = Math.ceil('I can help you with that!'.length / 4);
		const expected4 = Math.ceil('[1, 2, 3]'.length / 3);

		expect(estimateMessageTokens(messages)).toBe(
			expected1 + expected2 + expected3 + expected4,
		);
	});

	it('handles messages with tool calls', () => {
		const messages: Message[] = [
			{
				role: 'assistant',
				content: 'Let me check that.',
				toolCalls: [
					{
						id: 'call-1',
						name: 'search',
						arguments: { query: 'test' },
					},
				],
			},
		];
		const expected = Math.ceil('Let me check that.'.length / 4);

		expect(estimateMessageTokens(messages)).toBe(expected);
	});

	it('handles messages with tool call ID', () => {
		const messages: Message[] = [
			{
				role: 'tool',
				content: '{ "result": "found" }',
				toolCallId: 'call-1',
			},
		];
		const expected = Math.ceil('{ "result": "found" }'.length / 3);

		expect(estimateMessageTokens(messages)).toBe(expected);
	});
});
