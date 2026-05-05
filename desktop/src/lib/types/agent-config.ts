// Agent configuration types — mirror the daemon's Zod schema at
// `src/config/schema.ts`. Kept structural (not imported from the daemon)
// because the desktop is a separately-built Tauri bundle.

/** Canonical agent kind enum. Sync source: src/config/schema.ts → AGENT_KINDS. Kept in sync by src/config/agent-config-sync.test.ts. */
export const AGENT_KINDS = [
	'orchestrator',
	'planner',
	'executor',
	'researcher',
	'explorer',
	'verifier',
	'debugger',
	'tester',
	'writer',
	'librarian',
	'default',
	'custom',
] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const TOOL_MODES = ['auto', 'manual', 'deny_all'] as const;
export type ToolMode = (typeof TOOL_MODES)[number];

export const PER_TOOL_DECISIONS = ['allow', 'ask', 'deny'] as const;
export type PerToolDecision = (typeof PER_TOOL_DECISIONS)[number];

export const PERMISSION_MODES = ['default', 'accept_edits', 'plan', 'bypass'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const WORKFLOW_MODES = ['quick', 'standard', 'comprehensive', 'milestone'] as const;
export type WorkflowMode = (typeof WORKFLOW_MODES)[number];

export const WORKFLOW_DEPTHS = ['shallow', 'standard', 'deep'] as const;
export type WorkflowDepth = (typeof WORKFLOW_DEPTHS)[number];

export interface AgentBehavior {
	provider?: string;
	model?: string;
	temperature?: number;
	topP?: number;
	permissionMode?: PermissionMode;
	workflowMode?: WorkflowMode;
	workflowDepth?: WorkflowDepth;
	autopilot?: boolean;
}

export interface ToolPolicy {
	allowedTools?: string[];
	deniedTools?: string[];
	perToolApproval?: Record<string, PerToolDecision>;
}

/**
 * An agent profile as stored in config (global or project layer).
 *
 * This is the persisted shape returned by `GET /api/config/agents` —
 * before layer resolution.
 */
export interface AgentProfile {
	id: string;
	label: string;
	kind: AgentKind;
	description?: string;
	enabled: boolean;
	behavior: AgentBehavior;
	tools: ToolPolicy;
}

/**
 * The layer that supplied the effective value for a given field.
 *
 * `override` is the per-run override (chat composer, launch dialog).
 */
export type ConfigLayer = 'global' | 'project' | 'override';

/**
 * Flattened per-field layer attribution map.
 *
 * Keys are dotted field paths matching the nested structure of
 * `AgentProfile` (e.g. `"behavior.temperature"`, `"behavior.model"`).
 * Values indicate which layer won for that field.
 */
export type AgentConfigSources = Record<string, ConfigLayer>;

/**
 * A fully-resolved agent config returned by `GET /api/config/agents/:id`.
 *
 * Shape mirrors `AgentProfile` plus a `_sources` attribution map so the UI
 * can render a badge per field showing which layer won.
 */
export interface ResolvedAgentConfig extends AgentProfile {
	_sources: AgentConfigSources;
}

/**
 * Per-run agent override — a partial shape that the chat composer sends
 * with the next `POST /api/chat` (and eventually `POST /agent-runs`).
 *
 * Only the fields a user can reasonably override at launch time are here;
 * structural fields like `id`, `kind`, `tools` are not overridable per-run.
 */
export interface AgentRunOverride {
	provider?: string;
	model?: string;
	temperature?: number;
	topP?: number;
}

/** Default empty override (no fields set). */
export const EMPTY_OVERRIDE: AgentRunOverride = {};

/**
 * Standard `Result`-shaped envelope used by daemon routes.
 *
 * Matches the pattern in `src/server/routes-projects.ts`.
 */
export type DaemonResult<T> =
	| { ok: true; data: T }
	| { ok: false; error: string; code?: string; details?: unknown };

// --- Field attribution helpers ---------------------------------------------

/**
 * Look up the layer that supplied a given dotted field path in a resolved
 * config. Falls back to `'global'` if the path is missing from `_sources`.
 */
export function getFieldLayer(
	resolved: ResolvedAgentConfig | null,
	path: string,
): ConfigLayer {
	if (!resolved) return 'global';
	return resolved._sources[path] ?? 'global';
}
