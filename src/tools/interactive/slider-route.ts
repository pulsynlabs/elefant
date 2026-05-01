/**
 * Slider answer routes — HTTP endpoints for resolving pending slider tools.
 */

import type { Elysia } from 'elysia';
import { z } from 'zod';

import { sliderBroker } from './slider-broker.js';

const answerSchema = z.object({
	value: z.number().finite(),
});

function registerAnswerEndpoint(app: Elysia, path: string): void {
	app.post(path, async ({ params, body }) => {
		const sliderId = params.sliderId;

		const parsed = answerSchema.safeParse(body);
		if (!parsed.success) {
			return Response.json(
				{ ok: false, error: 'Invalid request body', details: parsed.error.issues },
				{ status: 400 },
			);
		}

		const answered = sliderBroker.answer(sliderId, { value: parsed.data.value });
		if (!answered) {
			return Response.json(
				{ ok: false, error: 'Slider not found or already answered' },
				{ status: 404 },
			);
		}

		return Response.json({ ok: true });
	});
}

export function registerSliderRoute(app: Elysia): void {
	registerAnswerEndpoint(app, '/api/interactive/slider/:sliderId');
	registerAnswerEndpoint(app, '/tools/slider/answer/:sliderId');
}
