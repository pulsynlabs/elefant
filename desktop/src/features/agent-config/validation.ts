// Client-side validation for the agent config forms.
//
// Mirrors the daemon's Zod schema at `src/config/schema.ts` so bad input
// fails at submit time with a helpful message instead of round-tripping
// to the daemon and back. The daemon remains the source of truth — this
// layer exists only to keep the UI responsive and correct.

import type {
	AgentBehavior,
	ToolPolicy,
} from '$lib/types/agent-config.js';

export type ValidationErrors = Record<string, string>;

export const BEHAVIOR_BOUNDS = {
	temperature: { min: 0, max: 2, step: 0.05 },
	topP: { min: 0, max: 1, step: 0.05 },
} as const;

function isFinite(n: unknown): n is number {
	return typeof n === 'number' && Number.isFinite(n);
}

export function validateGeneration(behavior: AgentBehavior): ValidationErrors {
	const errors: ValidationErrors = {};
	if (behavior.temperature !== undefined) {
		if (!isFinite(behavior.temperature) ||
			behavior.temperature < BEHAVIOR_BOUNDS.temperature.min ||
			behavior.temperature > BEHAVIOR_BOUNDS.temperature.max
		) {
			errors.temperature = `Must be between ${BEHAVIOR_BOUNDS.temperature.min} and ${BEHAVIOR_BOUNDS.temperature.max}.`;
		}
	}
	if (behavior.topP !== undefined) {
		if (!isFinite(behavior.topP) ||
			behavior.topP < BEHAVIOR_BOUNDS.topP.min ||
			behavior.topP > BEHAVIOR_BOUNDS.topP.max
		) {
			errors.topP = `Must be between ${BEHAVIOR_BOUNDS.topP.min} and ${BEHAVIOR_BOUNDS.topP.max}.`;
		}
	}
	return errors;
}

export function validateToolPolicy(policy: ToolPolicy): ValidationErrors {
	const errors: ValidationErrors = {};
	if (policy.allowedTools) {
		for (const name of policy.allowedTools) {
			if (!isValidToolName(name)) {
				errors.allowedTools = `"${name}" is not a valid tool name.`;
				break;
			}
		}
	}
	if (policy.deniedTools) {
		for (const name of policy.deniedTools) {
			if (!isValidToolName(name)) {
				errors.deniedTools = `"${name}" is not a valid tool name.`;
				break;
			}
		}
	}
	return errors;
}

// Tool names are expected to be short, hyphen/underscore identifiers
// (matching the daemon's tool registry). Reject whitespace + weird chars
// at the input boundary to avoid round-tripping them through the API.
const TOOL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;

export function isValidToolName(name: string): boolean {
	return TOOL_NAME_RE.test(name);
}

export function parseToolList(raw: string): { tools: string[]; invalid: string[] } {
	const parts = raw
		.split(/[,\s]+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	const tools: string[] = [];
	const invalid: string[] = [];
	for (const name of parts) {
		if (isValidToolName(name)) {
			if (!tools.includes(name)) tools.push(name);
		} else {
			invalid.push(name);
		}
	}
	return { tools, invalid };
}

export function hasErrors(errors: ValidationErrors): boolean {
	return Object.keys(errors).length > 0;
}

export function mergeErrors(...groups: ValidationErrors[]): ValidationErrors {
	return Object.assign({}, ...groups);
}
