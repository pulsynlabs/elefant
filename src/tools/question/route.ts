/**
 * Question route — HTTP endpoint for answering questions from the desktop app.
 */

import type { Elysia } from 'elysia';
import { questionBroker } from './broker.js';

export function registerQuestionRoute(app: Elysia): void {
	app.post('/tools/question/answer/:questionId', async ({ params, body }) => {
		const questionId = params.questionId;
		const payload = body as { answers: string[] };

		const answered = questionBroker.answer(questionId, { answers: payload.answers });
		if (!answered) {
			return Response.json(
				{ ok: false, error: 'Question not found or already answered' },
				{ status: 404 },
			);
		}
		return Response.json({ ok: true });
	});
}
