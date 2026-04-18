/**
 * Question emitter — module-level callback for emitting question events to SSE stream.
 * 
 * NOTE: This is a v1 simplification. The module-level callback has a race condition
 * for concurrent conversations (only one emitter can be active at a time). For v1,
 * Elefant supports only single-concurrent-conversation, so this is acceptable.
 * A future improvement would be to pass the emitter through the tool execution context.
 * 
 * @see ADL entry for concurrency limitation
 */

export interface QuestionOption {
	label: string;
	description?: string;
}

export interface QuestionSsePayload {
	questionId: string;
	question: string;
	header: string;
	options: QuestionOption[];
	multiple: boolean;
	conversationId?: string;
}

/** Module-level callback — set by the SSE handler when a stream starts */
let questionEmitter: ((payload: QuestionSsePayload) => void) | null = null;

/**
 * Set the question emitter callback.
 * Called by the SSE stream handler when a conversation stream starts.
 */
export function setQuestionEmitter(fn: ((payload: QuestionSsePayload) => void) | null): void {
	questionEmitter = fn;
}

/**
 * Emit a question event to the current SSE stream.
 * Called by the question tool when it needs to ask the user a question.
 */
export function emitQuestion(payload: QuestionSsePayload): void {
	questionEmitter?.(payload);
}
