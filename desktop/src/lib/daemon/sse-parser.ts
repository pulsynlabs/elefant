import type { ChatStreamEvent } from './types.js';

interface SSEParsedEvent {
	event: string;
	data: string;
	id?: string;
	retry?: number;
}

/**
 * Parse a single SSE event block into its fields.
 * A block is a series of "field: value" lines separated by a blank line.
 */
function parseSseBlock(block: string): SSEParsedEvent | null {
	if (!block.trim()) return null;

	let event = '';
	let data = '';
	let id: string | undefined;
	let retry: number | undefined;

	for (const line of block.split('\n')) {
		if (line.startsWith(':')) {
			// Comment line — keepalives come through here, ignore
			continue;
		}

		const colonIndex = line.indexOf(':');
		if (colonIndex === -1) continue;

		const field = line.slice(0, colonIndex).trim();
		// Per SSE spec: single space after colon is stripped
		const value = line.slice(colonIndex + 1).replace(/^ /, '');

		switch (field) {
			case 'event':
				event = value;
				break;
			case 'data':
				data += (data ? '\n' : '') + value;
				break;
			case 'id':
				id = value;
				break;
			case 'retry':
				retry = parseInt(value, 10);
				break;
		}
	}

	if (!data) return null;

	return { event, data, id, retry };
}

/**
 * Convert a parsed SSE event to a typed ChatStreamEvent.
 */
function toStreamEvent(parsed: SSEParsedEvent): ChatStreamEvent | null {
	let jsonData: unknown;
	try {
		jsonData = JSON.parse(parsed.data);
	} catch {
		return null;
	}

	const d = jsonData as Record<string, unknown>;

	switch (parsed.event) {
		case 'token':
			return {
				type: 'token',
				text: typeof d.text === 'string' ? d.text : '',
			};

		case 'tool_call':
			return {
				type: 'tool_call',
				id: typeof d.id === 'string' ? d.id : '',
				name: typeof d.name === 'string' ? d.name : '',
				arguments: typeof d.arguments === 'object' && d.arguments !== null
					? d.arguments as Record<string, unknown>
					: {},
			};

		case 'tool_result':
			return {
				type: 'tool_result',
				toolCallId: typeof d.toolCallId === 'string' ? d.toolCallId : '',
				content: typeof d.content === 'string' ? d.content : '',
				isError: typeof d.isError === 'boolean' ? d.isError : false,
			};

		case 'done':
			return {
				type: 'done',
				finishReason: (d.finishReason as 'stop' | 'tool_calls' | 'length' | 'error') || 'stop',
			};

		case 'error':
			return {
				type: 'error',
				code: typeof d.code === 'string' ? d.code : 'UNKNOWN',
				message: typeof d.message === 'string' ? d.message : 'Unknown error',
				details: d.details,
			};

		case 'question':
			return {
				type: 'question',
				questionId: typeof d.questionId === 'string' ? d.questionId : '',
				question: typeof d.question === 'string' ? d.question : '',
				header: typeof d.header === 'string' ? d.header : '',
				options: Array.isArray(d.options) ? d.options as Array<{ label: string; description?: string }> : [],
				multiple: typeof d.multiple === 'boolean' ? d.multiple : false,
				conversationId: typeof d.conversationId === 'string' ? d.conversationId : undefined,
			};

		default:
			return null;
	}
}

/**
 * Parse an SSE ReadableStream into typed ChatStreamEvents.
 * Uses fetch + ReadableStream (NOT EventSource) for Tauri WebView compatibility.
 */
export async function* parseSSEStream(
	body: ReadableStream<Uint8Array>
): AsyncGenerator<ChatStreamEvent> {
	const decoder = new TextDecoder('utf-8');
	const reader = body.getReader();
	let buffer = '';

	try {
		while (true) {
			const { done, value } = await reader.read();

			if (done) break;

			// Decode the chunk and append to buffer
			buffer += decoder.decode(value, { stream: true });

			// Split on double-newline (SSE event separator)
			const events = buffer.split('\n\n');

			// Keep the last incomplete chunk in the buffer
			buffer = events.pop() ?? '';

			for (const block of events) {
				if (!block.trim()) continue;

				// Check for keepalive comment (e.g., ": keepalive")
				if (block.trim().startsWith(':')) continue;

				const parsed = parseSseBlock(block);
				if (!parsed) continue;

				const event = toStreamEvent(parsed);
				if (event) {
					yield event;

					// Stop after done or error
					if (event.type === 'done' || event.type === 'error') {
						return;
					}
				}
			}
		}

		// Process any remaining data in buffer
		if (buffer.trim() && !buffer.trim().startsWith(':')) {
			const parsed = parseSseBlock(buffer);
			if (parsed) {
				const event = toStreamEvent(parsed);
				if (event) yield event;
			}
		}
	} finally {
		reader.releaseLock();
	}
}
