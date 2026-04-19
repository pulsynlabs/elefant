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

export type QuestionEmitter = (payload: QuestionSsePayload) => void;

export function createQuestionEmitter(
	conversationId: string,
	emit: QuestionEmitter,
): QuestionEmitter {
	return (payload: QuestionSsePayload): void => {
		emit({
			...payload,
			conversationId,
		});
	};
}
