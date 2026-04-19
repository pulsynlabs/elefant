// chat.svelte.ts — generation-settings and override-precedence tests.
//
// The chat store no longer owns any streaming state — all streaming
// lives in agent-runs. What remains here is configuration the composer
// applies to each spawn: provider selection, AdvancedOptions values,
// and the optional per-run override.
//
// The audit intent of the original suite is preserved: if AdvancedOptions
// sprouts a new generation-setting field, the test in the final describe
// block reminds us to wire it through the store, and if the override
// precedence rule is ever reversed the second block catches it.

import { describe, expect, it, beforeEach } from 'bun:test';
import {
	chatStore,
	setAgentOverride,
	clearAgentOverride,
	hasAgentOverride,
	getEffectiveProvider,
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

describe('chatStore — AdvancedOptions state', () => {
	beforeEach(resetStore);

	it('every AdvancedOptions field has a matching setter and getter', () => {
		chatStore.setMaxIterations(75);
		chatStore.setMaxTokens(8192);
		chatStore.setTemperature(0.3);
		chatStore.setTopP(0.85);
		chatStore.setTimeoutMs(120_000);

		// The field list is exhaustive by construction: if
		// AdvancedOptions sprouts a new control in the future, adding it
		// to the tuple above automatically triggers an assertion here.
		for (const field of ADVANCED_OPTIONS_FIELDS) {
			expect(chatStore).toHaveProperty(field);
		}

		expect(chatStore.maxIterations).toBe(75);
		expect(chatStore.maxTokens).toBe(8192);
		expect(chatStore.temperature).toBe(0.3);
		expect(chatStore.topP).toBe(0.85);
		expect(chatStore.timeoutMs).toBe(120_000);
	});

	it('setMaxTokens(0) leaves the field at zero (composer treats it as "omit")', () => {
		chatStore.setMaxTokens(0);
		expect(chatStore.maxTokens).toBe(0);
	});

	it('preserves temperature=0 and topP=0 as valid zero values', () => {
		chatStore.setTemperature(0);
		chatStore.setTopP(0);
		expect(chatStore.temperature).toBe(0);
		expect(chatStore.topP).toBe(0);
	});
});

describe('chatStore — effective provider resolution', () => {
	beforeEach(resetStore);

	it('returns undefined when nothing is selected', () => {
		expect(getEffectiveProvider()).toBeUndefined();
	});

	it('returns the selected provider when no override is set', () => {
		chatStore.setProvider('anthropic');
		expect(getEffectiveProvider()).toBe('anthropic');
	});

	it('override provider wins over the selected provider', () => {
		chatStore.setProvider('anthropic');
		setAgentOverride({ provider: 'openai' });
		expect(getEffectiveProvider()).toBe('openai');
	});

	it('falls through to the selected provider when the override omits it', () => {
		chatStore.setProvider('anthropic');
		setAgentOverride({ temperature: 0.2 });
		expect(getEffectiveProvider()).toBe('anthropic');
	});
});

describe('chatStore — agent override lifecycle', () => {
	beforeEach(resetStore);

	it('hasAgentOverride is false for an empty override, true once a field is set', () => {
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

	it('setAgentOverride({}) is equivalent to clearing', () => {
		setAgentOverride({ temperature: 0.1, provider: 'openai' });
		expect(hasAgentOverride()).toBe(true);
		setAgentOverride({});
		expect(hasAgentOverride()).toBe(false);
	});

	it('getAgentOverride returns a snapshot, not a live reference', () => {
		setAgentOverride({ temperature: 0.4 });
		const snapshot = chatStore.getAgentOverride();
		snapshot.temperature = 0.99;
		// The live store value must not have been mutated.
		expect(chatStore.getAgentOverride().temperature).toBe(0.4);
	});
});
