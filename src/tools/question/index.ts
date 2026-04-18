/**
 * Question tool — structured HITL interaction for the Elefant daemon.
 * The agent asks questions with options, the desktop app answers via HTTP route,
 * a broker resolves the promise, or a 60s timeout fires.
 */

import type { ToolDefinition } from '../../types/tools.js';
import type { ElefantError } from '../../types/errors.js';
import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';
import { questionBroker, type AnswerPayload } from './broker.js';
import { emitQuestion } from './emitter.js';

export interface QuestionOption {
	label: string;
	description?: string;
}

export interface Question {
	question: string;
	header: string;
	options: QuestionOption[];
	multiple?: boolean;
}

export interface QuestionParams {
	questions: Question[];
	conversationId?: string;
}

/**
 * Format the answer result as a readable string.
 */
function formatAnswers(questions: Question[], answers: AnswerPayload[]): string {
	return questions
		.map((q, i) => {
			const answer = answers[i];
			if (!answer) return `Q${i + 1} [${q.header}]: (no answer)`;
			return `Q${i + 1} [${q.header}]: ${answer.answers.join(', ')}`;
		})
		.join('\n');
}

/**
 * Question tool definition.
 */
export const questionTool: ToolDefinition<QuestionParams, string> = {
	name: 'question',
	description:
		'Ask the user a structured question with options. Returns the selected option label(s). Times out after 60 seconds.',
	parameters: {
		questions: {
			type: 'array',
			description: 'Array of questions to ask, each with header, question text, and options',
			required: true,
		},
		conversationId: {
			type: 'string',
			description: 'Optional conversation ID for context grouping',
			required: false,
		},
	},
	execute: async (params): Promise<Result<string, ElefantError>> => {
		// Check for non-interactive mode
		if (process.env.ELEFANT_NON_INTERACTIVE === 'true') {
			return err({
				code: 'TOOL_EXECUTION_FAILED',
				message: 'question is not available in non-interactive mode',
			});
		}

		const { questions } = params;

		if (!questions || questions.length === 0) {
			return err({
				code: 'VALIDATION_ERROR',
				message: 'At least one question is required',
			});
		}

		const answers: AnswerPayload[] = [];

		for (let i = 0; i < questions.length; i++) {
			const question = questions[i];

			// Validate question structure
			if (!question.question || typeof question.question !== 'string') {
				return err({
					code: 'VALIDATION_ERROR',
					message: `Question ${i + 1}: question text is required`,
				});
			}
			if (!question.header || typeof question.header !== 'string') {
				return err({
					code: 'VALIDATION_ERROR',
					message: `Question ${i + 1}: header is required`,
				});
			}
			if (!question.options || question.options.length === 0) {
				return err({
					code: 'VALIDATION_ERROR',
					message: `Question ${i + 1}: at least one option is required`,
				});
			}

			const questionId = crypto.randomUUID();

			// Register with broker (60 second timeout)
			const answerPromise = questionBroker.register(questionId, 60_000);

			// Emit question event to SSE stream so frontend can render it
			emitQuestion({
				questionId,
				question: question.question,
				header: question.header,
				options: question.options,
				multiple: question.multiple ?? false,
				conversationId: params.conversationId,
			});

			try {
				const answer = await answerPromise;
				answers.push(answer);
			} catch (error) {
				// Timeout or other error
				return err({
					code: 'TOOL_EXECUTION_FAILED',
					message:
						error instanceof Error
							? error.message
							: 'question timed out after 60s',
				});
			}
		}

		return ok(formatAnswers(questions, answers));
	},
};
