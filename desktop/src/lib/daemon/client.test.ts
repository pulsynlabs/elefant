import { describe, expect, it } from 'bun:test';
import { DaemonClient } from './client.js';

describe('DaemonClient public API snapshot', () => {
	it('keeps the public method surface unchanged', () => {
		const client = new DaemonClient('http://localhost:1337');

		expect(DaemonClient.length).toBe(0);
		expect(typeof client.setBaseUrl).toBe('function');
		expect(client.setBaseUrl.length).toBe(1);
		expect(typeof client.getBaseUrl).toBe('function');
		expect(client.getBaseUrl.length).toBe(0);
		expect(typeof client.checkHealth).toBe('function');
		expect(client.checkHealth.length).toBe(0);
		expect(typeof client.streamChat).toBe('function');
		expect(client.streamChat.length).toBe(2);
		expect(typeof client.getProviders).toBe('function');
		expect(client.getProviders.length).toBe(0);
		expect(typeof client.fetchProviderRegistry).toBe('function');
		expect(client.fetchProviderRegistry.length).toBe(0);
		expect(typeof client.fetchProviderModels).toBe('function');
		expect(client.fetchProviderModels.length).toBe(3);
		expect(typeof client.answerQuestion).toBe('function');
		expect(client.answerQuestion.length).toBe(2);
		expect(typeof client.answerSlider).toBe('function');
		expect(client.answerSlider.length).toBe(2);
		expect(typeof client.fetchSessionMessages).toBe('function');
		expect(client.fetchSessionMessages.length).toBe(2);
	});

	it('keeps the exact public prototype member list unchanged', () => {
		expect(Object.getOwnPropertyNames(DaemonClient.prototype)).toEqual([
			'constructor',
			'setBaseUrl',
			'getBaseUrl',
			'checkHealth',
			'streamChat',
			'getProviders',
			'fetchProviderRegistry',
			'fetchProviderModels',
			'answerQuestion',
			'answerSlider',
			'fetchSessionMessages',
		]);
	});
});
