/**
 * QuestionBroker — singleton for managing pending questions.
 * Handles registration, answering, and timeout of HITL question flows.
 */

export interface AnswerPayload {
	answers: string[]; // selected option labels
}

interface PendingQuestion {
	resolve: (answer: AnswerPayload) => void;
	reject: (reason: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export class QuestionBroker {
	private pending = new Map<string, PendingQuestion>();

	/**
	 * Register a new question and return a promise that resolves when answered or rejects on timeout.
	 */
	register(questionId: string, timeoutMs = 60_000): Promise<AnswerPayload> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(questionId);
				reject(new Error(`Question timed out after ${timeoutMs}ms`));
			}, timeoutMs);
			this.pending.set(questionId, { resolve, reject, timer });
		});
	}

	/**
	 * Answer a pending question by its ID.
	 * Returns true if the question was found and answered, false otherwise.
	 */
	answer(questionId: string, payload: AnswerPayload): boolean {
		const pending = this.pending.get(questionId);
		if (!pending) return false;
		clearTimeout(pending.timer);
		this.pending.delete(questionId);
		pending.resolve(payload);
		return true;
	}

	/**
	 * Get the number of pending questions (useful for debugging/monitoring).
	 */
	getPendingCount(): number {
		return this.pending.size;
	}

	/**
	 * Clear all pending questions (useful for testing cleanup).
	 */
	clearAll(): void {
		for (const [, pending] of this.pending) {
			clearTimeout(pending.timer);
			pending.reject(new Error('Question broker cleared'));
		}
		this.pending.clear();
	}
}

export const questionBroker = new QuestionBroker();
