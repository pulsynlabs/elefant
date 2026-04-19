// Chat feature store — generation settings and per-run override state.
//
// Chat is delivered through the agent-runs pipeline, so this store no
// longer owns an in-memory message list or any streaming state. The
// state that remains is the user-facing configuration the composer
// bolts onto each spawn: provider selection, AdvancedOptions values,
// and the optional AgentOverrideDialog state that wins for the next
// run only.

import type { AgentRunOverride } from '$lib/types/agent-config.js';

// Available providers (populated from config)
let availableProviders = $state<string[]>([]);
let defaultProvider = $state<string | null>(null);
let selectedProvider = $state<string | null>(null);

// AdvancedOptions generation settings. `maxTokens === 0` means "use the
// provider default" so callers that read this value should omit the
// field rather than send zero.
let maxIterations = $state(50);
let maxTokens = $state(4096);
let temperature = $state(1.0);
let topP = $state(1.0);
let timeoutMs = $state(60000);

// Per-run agent override applied to the NEXT agent run spawn. Confirmed
// via AgentOverrideDialog from the composer. Each field is optional so
// the UI can clear individual slots without nuking the whole override.
let agentOverride = $state<AgentRunOverride>({});

export function setAvailableProviders(providers: string[], def: string | null): void {
	availableProviders = providers;
	defaultProvider = def;
	if (!selectedProvider && def) {
		selectedProvider = def;
	}
}

/** Snapshot the active override for display / diffing. */
export function getAgentOverride(): AgentRunOverride {
	return { ...agentOverride };
}

/** Replace the active override. Passing `{}` clears it. */
export function setAgentOverride(next: AgentRunOverride): void {
	agentOverride = { ...next };
}

/** Clear all override fields. */
export function clearAgentOverride(): void {
	agentOverride = {};
}

/** True when any override field is currently set. */
export function hasAgentOverride(): boolean {
	return Object.values(agentOverride).some((v) => v !== undefined);
}

/**
 * Resolve the provider that should be used for the next run. Override
 * wins, then AdvancedOptions `selectedProvider`, otherwise `undefined`
 * so the daemon falls back to its default provider.
 */
export function getEffectiveProvider(): string | undefined {
	return agentOverride.provider ?? selectedProvider ?? undefined;
}

export const chatStore = {
	get availableProviders() {
		return availableProviders;
	},
	get defaultProvider() {
		return defaultProvider;
	},
	get selectedProvider() {
		return selectedProvider;
	},
	get maxIterations() {
		return maxIterations;
	},
	get maxTokens() {
		return maxTokens;
	},
	get temperature() {
		return temperature;
	},
	get topP() {
		return topP;
	},
	get timeoutMs() {
		return timeoutMs;
	},
	get agentOverride() {
		return agentOverride;
	},
	get hasAgentOverride() {
		return hasAgentOverride();
	},
	setProvider: (p: string | null) => {
		selectedProvider = p;
	},
	setMaxIterations: (n: number) => {
		maxIterations = n;
	},
	setMaxTokens: (n: number) => {
		maxTokens = n;
	},
	setTemperature: (n: number) => {
		temperature = n;
	},
	setTopP: (n: number) => {
		topP = n;
	},
	setTimeoutMs: (n: number) => {
		timeoutMs = n;
	},
	setAgentOverride,
	clearAgentOverride,
	getAgentOverride,
	getEffectiveProvider,
	setAvailableProviders,
};
