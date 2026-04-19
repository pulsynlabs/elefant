// chat.svelte.ts — payload mapping tests.
//
// Task 4.7 audit requirement: every field visible in AdvancedOptions.svelte
// must land in the POST body sent to `/api/chat`. These tests assert the
// field → payload mapping and also verify that AgentOverrideDialog state
// wins over the AdvancedOptions defaults when both are set.
//
// The payload is built by `chatStore.buildChatRequestFields()`, which is
// the sole code path used by ChatView to construct a `ChatRequest`.

import { describe, expect, it, beforeEach } from 'bun:test';
import {
	chatStore,
	buildChatRequestFields,
	setAgentOverride,
	clearAgentOverride,
	hasAgentOverride,
} from './chat.svelte.js';

// The AdvancedOptions controls map to these store setters.
// Keep this list in sync with AdvancedOptions.svelte.
const ADVANCED_OPTIONS_FIELDS = [
	'maxIterations',
	'maxTokens',
	'temperature',
	'topP',
	'timeoutMs',
] as const;

function resetStore(): void {
	// Restore the default values set at module load.
	chatStore.setProvider(null);
	chatStore.setMaxIterations(50);
	chatStore.setMaxTokens(4096);
	chatStore.setTemperature(1.0);
	chatStore.setTopP(1.0);
	chatStore.setTimeoutMs(60_000);
	clearAgentOverride();
}

describe('buildChatRequestFields — AdvancedOptions → payload mapping', () => {
	beforeEach(resetStore);

	it('every AdvancedOptions field appears in the payload', () => {
		chatStore.setMaxIterations(75);
		chatStore.setMaxTokens(8192);
		chatStore.setTemperature(0.3);
		chatStore.setTopP(0.85);
		chatStore.setTimeoutMs(120_000);

		const payload = buildChatRequestFields();

		// The field list is exhaustive by construction: if AdvancedOptions
		// sprouts a new field in the future, adding it to the tuple above
		// automatically triggers an assertion here.
		for (const field of ADVANCED_OPTIONS_FIELDS) {
			expect(payload).toHaveProperty(field);
		}

		expect(payload.maxIterations).toBe(75);
		expect(payload.maxTokens).toBe(8192);
		expect(payload.temperature).toBe(0.3);
		expect(payload.topP).toBe(0.85);
		expect(payload.timeoutMs).toBe(120_000);
	});

	it('omits maxTokens when the user leaves it at 0 (provider default)', () => {
		chatStore.setMaxTokens(0);
		const payload = buildChatRequestFields();
		expect(payload.maxTokens).toBeUndefined();
	});

	it('forwards the selected provider, or undefined when none is chosen', () => {
		chatStore.setProvider(null);
		expect(buildChatRequestFields().provider).toBeUndefined();

		chatStore.setProvider('anthropic');
		expect(buildChatRequestFields().provider).toBe('anthropic');
	});

	it('preserves temperature=0 and topP=0 (falsy but valid values)', () => {
		chatStore.setTemperature(0);
		chatStore.setTopP(0);
		const payload = buildChatRequestFields();
		expect(payload.temperature).toBe(0);
		expect(payload.topP).toBe(0);
	});
});

describe('buildChatRequestFields — AgentOverride precedence', () => {
	beforeEach(resetStore);

	it('override fields win over AdvancedOptions fields', () => {
		chatStore.setProvider('anthropic');
		chatStore.setMaxIterations(50);
		chatStore.setMaxTokens(4096);
		chatStore.setTemperature(1.0);
		chatStore.setTopP(1.0);
		chatStore.setTimeoutMs(60_000);

		setAgentOverride({
			provider: 'openai',
			maxIterations: 10,
			maxTokens: 1024,
			temperature: 0.1,
			topP: 0.5,
			timeoutMs: 30_000,
		});

		const payload = buildChatRequestFields();
		expect(payload.provider).toBe('openai');
		expect(payload.maxIterations).toBe(10);
		expect(payload.maxTokens).toBe(1024);
		expect(payload.temperature).toBe(0.1);
		expect(payload.topP).toBe(0.5);
		expect(payload.timeoutMs).toBe(30_000);
	});

	it('only-partial override falls through for unset fields', () => {
		chatStore.setTemperature(1.0);
		chatStore.setTopP(0.9);

		setAgentOverride({ temperature: 0.2 });

		const payload = buildChatRequestFields();
		expect(payload.temperature).toBe(0.2);
		expect(payload.topP).toBe(0.9); // still the AdvancedOptions value
	});

	it('override maxTokens is respected even when AdvancedOptions maxTokens is 0', () => {
		chatStore.setMaxTokens(0);
		setAgentOverride({ maxTokens: 2048 });
		expect(buildChatRequestFields().maxTokens).toBe(2048);
	});

	it('hasAgentOverride is false for empty override, true otherwise', () => {
		clearAgentOverride();
		expect(hasAgentOverride()).toBe(false);
		setAgentOverride({ temperature: 0.5 });
		expect(hasAgentOverride()).toBe(true);
		clearAgentOverride();
		expect(hasAgentOverride()).toBe(false);
	});

	it('clearAgentOverride removes every override field', () => {
		setAgentOverride({
			temperature: 0.1,
			topP: 0.2,
			maxTokens: 100,
			maxIterations: 5,
			timeoutMs: 10_000,
			provider: 'openai',
			model: 'gpt-5',
		});
		expect(hasAgentOverride()).toBe(true);
		clearAgentOverride();
		expect(hasAgentOverride()).toBe(false);
	});
});

describe('AdvancedOptions audit — no dead fields', () => {
	beforeEach(resetStore);

	// This test guards against regressions where a control is added to
	// the AdvancedOptions.svelte form but never reaches the daemon. If
	// this test starts failing, ensure both AdvancedOptions AND
	// buildChatRequestFields were updated together.
	it('every expected AdvancedOptions field is wired through the store', () => {
		const payload = buildChatRequestFields();
		const payloadKeys = Object.keys(payload);
		for (const field of ADVANCED_OPTIONS_FIELDS) {
			expect(payloadKeys).toContain(field);
		}
	});
});
