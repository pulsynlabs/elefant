import { afterEach, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';

import { sliderBroker } from './slider-broker.js';
import { registerSliderRoute } from './slider-route.js';

afterEach(() => {
	sliderBroker.clearAll();
});

function createApp(): Elysia {
	const app = new Elysia();
	registerSliderRoute(app);
	return app;
}

describe('slider answer route', () => {
	it('resolves a pending slider through the canonical interactive route', async () => {
		const app = createApp();
		const pending = sliderBroker.register('slider-1');

		const response = await app.handle(new Request('http://localhost/api/interactive/slider/slider-1', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ value: 42 }),
		}));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(await pending).toEqual({ value: 42 });
	});

	it('keeps the question-style compatibility route wired', async () => {
		const app = createApp();
		const pending = sliderBroker.register('slider-2');

		const response = await app.handle(new Request('http://localhost/tools/slider/answer/slider-2', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ value: 7 }),
		}));

		expect(response.status).toBe(200);
		expect(await pending).toEqual({ value: 7 });
	});

	it('rejects invalid slider answers', async () => {
		const app = createApp();
		const response = await app.handle(new Request('http://localhost/api/interactive/slider/missing', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ value: Number.NaN }),
		}));

		expect(response.status).toBe(400);
	});
});
