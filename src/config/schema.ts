import { z } from "zod";
import { EmbeddingProviderNameSchema } from "../fieldnotes/embeddings/provider.ts";

const providerSchema = z.object({
	name: z.string().min(1),
	baseURL: z.string().url(),
	apiKey: z.string().min(1),
	model: z.string().optional(),
	format: z.enum(["openai", "anthropic", "anthropic-compatible"]),
}).strict();

const toolPolicyConfigSchema = z.object({
	allowedTools: z.array(z.string().min(1)).optional(),
	deniedTools: z.array(z.string().min(1)).optional(),
	perToolApproval: z.record(z.string(), z.boolean()).optional(),
}).strict();

const agentBehaviorConfigSchema = z.object({
	provider: z.string().min(1).optional(),
	model: z.string().min(1).optional(),
	permissionMode: z.string().min(1).optional(),
	workflowMode: z.enum(["quick", "standard", "comprehensive", "milestone"]).optional(),
	workflowDepth: z.enum(["shallow", "standard", "deep"]).optional(),
	autopilot: z.boolean().optional(),
	temperature: z.number().min(0).max(2).optional(),
	topP: z.number().min(0).max(1).optional(),
}).strict();

export const AGENT_KINDS = ["orchestrator", "planner", "executor", "researcher", "explorer", "verifier", "debugger", "tester", "writer", "librarian", "default", "custom"] as const;

const agentPermissionsSchema = z.object({
	read: z.boolean().default(true),
	write: z.boolean().default(false),
	execute: z.boolean().default(false),
}).strict();

const agentContextModeSchema = z.enum(["none", "inherit_session", "snapshot"]);

const agentProfileSchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	kind: z.enum(AGENT_KINDS),
	description: z.string().min(1).optional(),
	enabled: z.boolean(),
	provider: z.string().min(1).optional(),
	model: z.string().min(1).optional(),
	toolsAllowlist: z.array(z.string().min(1)).nullable().default(null),
	permissions: agentPermissionsSchema.default({ read: true, write: false, execute: false }),
	contextMode: agentContextModeSchema.default("inherit_session"),
	promptFile: z.string().min(1).nullable().default(null),
	promptOverride: z.string().min(1).nullable().default(null),
	behavior: agentBehaviorConfigSchema,
	tools: toolPolicyConfigSchema,
	maxTaskDepth: z.number().int().min(0).optional(),
	maxChildren: z.number().int().min(1).optional(),
}).strict();

const mcpStdioConfigSchema = z.object({
	id: z.string().uuid(),
	name: z.string().regex(/^[a-zA-Z0-9_-]+$/),
	transport: z.literal("stdio"),
	command: z.array(z.string()).min(1),
	env: z.record(z.string(), z.string()).optional().default({}),
	enabled: z.boolean().optional().default(true),
	timeout: z.number().positive().optional().default(30000),
	pinnedTools: z.array(z.string()).optional().default([]),
	alwaysLoad: z.array(z.string().min(1)).optional().default([]),
}).strict();

const mcpRemoteConfigSchema = z.object({
	id: z.string().uuid(),
	name: z.string().regex(/^[a-zA-Z0-9_-]+$/),
	transport: z.enum(["sse", "streamable-http"]),
	url: z.string().url(),
	headers: z.record(z.string(), z.string()).optional().default({}),
	enabled: z.boolean().optional().default(true),
	timeout: z.number().positive().optional().default(30000),
	pinnedTools: z.array(z.string()).optional().default([]),
	alwaysLoad: z.array(z.string().min(1)).optional().default([]),
}).strict();

const mcpServerSchema = z.discriminatedUnion("transport", [
	mcpStdioConfigSchema,
	mcpRemoteConfigSchema,
]);

const registryConfigSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('native'),
		url: z.string().url(),
		enabled: z.boolean().default(true),
	}),
	z.object({
		type: z.literal('clawhub'),
		url: z.string().url().default('https://clawhub.com'),
		enabled: z.boolean().default(true),
	}),
	z.object({
		type: z.literal('github-registry'),
		url: z.string().url(),
		enabled: z.boolean().default(true),
	}),
]);

const fieldNotesProviderConfigSchema = z.object({
	baseUrl: z.string().optional(),
	apiKey: z.string().optional(),
	model: z.string().optional(),
	bundledModelId: z.string().optional(),
}).strict();

const fieldNotesConfigSchema = z.object({
	enabled: z.boolean().default(true),
	provider: EmbeddingProviderNameSchema.default('bundled-cpu'),
	editorOverride: z.string().optional(),
	providerConfig: fieldNotesProviderConfigSchema.optional(),
}).strict();

const visualizeModelOverrideSchema = z.object({
	provider: z.string(),
	model: z.string(),
}).strict();

const skillsConfigSchema = z.object({
	registries: z.array(registryConfigSchema).default([
		{ type: 'clawhub' as const, url: 'https://clawhub.com', enabled: true },
		{
			type: 'github-registry' as const,
			url: 'https://raw.githubusercontent.com/majiayu000/claude-skill-registry-core/main/registry.json',
			enabled: true,
		},
	]),
	cacheTtlHours: z.number().int().min(1).default(24),
});

const agentsMdConfigSchema = z.object({
	autoUpdate: z.boolean().default(true),
}).strict();

const BUNDLED_REGISTRIES = [
	{ type: 'clawhub' as const, url: 'https://clawhub.com', enabled: true },
	{
		type: 'github-registry' as const,
		url: 'https://raw.githubusercontent.com/majiayu000/claude-skill-registry-core/main/registry.json',
		enabled: true,
	},
];

const configSchema = z.object({
	port: z.number().int().min(1).max(65535).default(1337),
	providers: z.array(providerSchema).default([]),
	defaultProvider: z.string().default(''),
	logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
	projectPath: z.string().default(() => process.cwd()),
	agents: z.record(z.string(), agentProfileSchema).optional(),
	mcp: z.array(mcpServerSchema).optional().default([]),
	tokenBudgetPercent: z.number().min(0).max(100).optional().default(10),
	compactionThreshold: z.number().min(0.5).max(0.95).optional().default(0.8),
	visualizeModelOverride: visualizeModelOverrideSchema.nullable().optional().default(null),
	hardwareAccelerationDisabled: z.boolean().optional().default(false),
	skills: skillsConfigSchema.optional().default({
		registries: BUNDLED_REGISTRIES,
		cacheTtlHours: 24,
	}),
	research: fieldNotesConfigSchema.optional().default({
		enabled: true,
		provider: 'bundled-cpu',
	}),
	agentsMd: agentsMdConfigSchema.optional().default({ autoUpdate: true }),
}).strict();

type AgentProfileInput = z.input<typeof agentProfileSchema>;

function createAgentProfile(input: AgentProfileInput): z.infer<typeof agentProfileSchema> {
	return agentProfileSchema.parse(input);
}

const commonBehaviorDefaults = {
	temperature: 0.2,
	topP: 0.95,
};

const readOnlyTools = ["read", "glob", "grep", "memory_search", "memory_save", "wf_status", "wf_spec", "wf_blueprint", "wf_chronicle", "wf_adl"];
const executorTools = ["read", "glob", "grep", "bash", "apply_patch", "memory_search", "memory_save", "wf_status", "wf_chronicle", "wf_adl"];

const defaultAgentProfiles = {
	default: createAgentProfile({ id: "default", label: "Default", kind: "default", description: "Fallback profile used when no specific agent matches.", enabled: true, behavior: { workflowMode: "standard", workflowDepth: "standard", autopilot: false, ...commonBehaviorDefaults }, tools: {} }),
	orchestrator: createAgentProfile({ id: "orchestrator", label: "Orchestrator", kind: "orchestrator", description: "**The Conductor** — Coordinates work across planning, execution, and verification phases. Use it to manage multi-agent workflows and enforce spec-driven discipline.", enabled: true, model: "claude-opus-4-7", provider: "anthropic", toolsAllowlist: ["wf_status", "wf_state", "wf_requirements", "wf_spec", "wf_blueprint", "wf_chronicle", "wf_adl", "task", "memory_search", "memory_save", "question"], permissions: { read: true, write: false, execute: false }, contextMode: "inherit_session", promptFile: "src/agents/prompts/orchestrator.md", behavior: { workflowMode: "standard", workflowDepth: "deep", autopilot: false, permissionMode: "strict", temperature: 0.2, topP: 0.95 }, tools: {} }),
	planner: createAgentProfile({ id: "planner", label: "Planner", kind: "planner", description: "**The Architect** — Converts requirements into locked specs and executable blueprints with validation contracts. Reach for it when you need to turn fuzzy goals into concrete task plans.", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: ["read", "glob", "grep", "wf_requirements", "wf_spec", "wf_blueprint", "wf_adl", "memory_search", "memory_decision"], permissions: { read: true, write: true, execute: false }, contextMode: "inherit_session", promptFile: "src/agents/prompts/planner.md", behavior: { workflowMode: "standard", workflowDepth: "deep", autopilot: false, permissionMode: "strict", temperature: 0.1, topP: 0.95 }, tools: { deniedTools: ["bash"] } }),
	researcher: createAgentProfile({ id: "researcher", label: "Researcher", kind: "researcher", description: "**The Investigator** — Researches unknowns, compares options, and writes evidence-backed findings. Use it to inform planning decisions with primary sources and confidence levels.", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: ["read", "glob", "grep", "webfetch", "memory_search", "memory_save", "wf_adl"], permissions: { read: true, write: true, execute: false }, contextMode: "snapshot", promptFile: "src/agents/prompts/researcher.md", behavior: { workflowMode: "comprehensive", workflowDepth: "deep", autopilot: true, temperature: 0.3, topP: 0.95 }, tools: {} }),
	explorer: createAgentProfile({ id: "explorer", label: "Explorer", kind: "explorer", description: "**The Cartographer** — Maps codebase files, patterns, and call flows without changing anything. Reach for it to understand terrain before implementation begins.", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: ["read", "glob", "grep", "memory_search", "memory_save"], permissions: { read: true, write: false, execute: false }, contextMode: "snapshot", promptFile: "src/agents/prompts/explorer.md", behavior: { workflowMode: "standard", workflowDepth: "standard", autopilot: true, ...commonBehaviorDefaults }, tools: { allowedTools: readOnlyTools } }),
	verifier: createAgentProfile({ id: "verifier", label: "Verifier", kind: "verifier", description: "**The Auditor** — Independently audits artifacts against validation contracts in fresh context. Use it to verify acceptance criteria and catch regressions before shipping.", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: ["read", "glob", "grep", "bash", "wf_spec", "wf_blueprint", "wf_chronicle", "wf_adl", "memory_search", "memory_save"], permissions: { read: true, write: false, execute: true }, contextMode: "none", promptFile: "src/agents/prompts/verifier.md", behavior: { workflowMode: "standard", workflowDepth: "deep", autopilot: false, permissionMode: "strict", temperature: 0.1, topP: 0.95 }, tools: {} }),
	debugger: createAgentProfile({ id: "debugger", label: "Debugger", kind: "debugger", description: "**The Detective** — Hunts root causes through hypothesis testing and evidence gathering. Reach for it when a bug resists obvious fixes or behaves inconsistently.", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: ["read", "glob", "grep", "bash", "wf_chronicle", "wf_adl", "memory_search", "memory_save"], permissions: { read: true, write: true, execute: true }, contextMode: "snapshot", promptFile: "src/agents/prompts/debugger.md", behavior: { workflowMode: "standard", workflowDepth: "deep", autopilot: false, ...commonBehaviorDefaults }, tools: {} }),
	tester: createAgentProfile({ id: "tester", label: "Tester", kind: "tester", description: "**The Guardian** — Writes durable Bun unit tests and Playwright E2E tests covering happy paths, failures, and edge cases. Use it to protect user workflows with comprehensive coverage.", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: ["read", "glob", "grep", "bash", "apply_patch", "memory_search", "memory_save"], permissions: { read: true, write: true, execute: true }, contextMode: "snapshot", promptFile: "src/agents/prompts/tester.md", behavior: { workflowMode: "standard", workflowDepth: "standard", autopilot: false, temperature: 0.1, topP: 0.95 }, tools: {} }),
	writer: createAgentProfile({ id: "writer", label: "Writer", kind: "writer", description: "**The Scribe** — Documents implemented behavior, architecture decisions, and tool contracts. Reach for it to turn code and decisions into clear, example-driven documentation.", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: ["read", "glob", "grep", "apply_patch", "memory_search", "memory_save"], permissions: { read: true, write: true, execute: false }, contextMode: "snapshot", promptFile: "src/agents/prompts/writer.md", behavior: { workflowMode: "standard", workflowDepth: "standard", autopilot: false, ...commonBehaviorDefaults }, tools: {} }),
	librarian: createAgentProfile({ id: "librarian", label: "Librarian", kind: "librarian", description: "**The Curator** — Synthesizes prior research, memory, and decisions into organized summaries. Use it to feed planners and researchers with concise context packs.", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: ["read", "glob", "grep", "memory_search", "memory_save", "wf_adl", "wf_chronicle"], permissions: { read: true, write: true, execute: false }, contextMode: "snapshot", promptFile: "src/agents/prompts/librarian.md", behavior: { workflowMode: "standard", workflowDepth: "standard", autopilot: true, ...commonBehaviorDefaults }, tools: {} }),
	"executor-low": createAgentProfile({ id: "executor-low", label: "Executor Low", kind: "executor", description: "**The Hand** — Handles mechanical, bounded changes like scaffolding, config edits, and file organization. Reach for it for simple, scoped work that doesn't touch business logic.", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: ["read", "glob", "grep", "bash", "apply_patch", "memory_search", "memory_save"], permissions: { read: true, write: true, execute: true }, contextMode: "inherit_session", promptFile: "src/agents/prompts/executor-low.md", behavior: { workflowMode: "standard", workflowDepth: "standard", autopilot: false, temperature: 0.1, topP: 0.95 }, tools: { allowedTools: executorTools } }),
	"executor-medium": createAgentProfile({ id: "executor-medium", label: "Executor Medium", kind: "executor", description: "**The Builder** — Implements business logic, utilities, and tests inside established patterns. Use it for product behavior that doesn't require architectural decisions.", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: executorTools, permissions: { read: true, write: true, execute: true }, contextMode: "inherit_session", promptFile: "src/agents/prompts/executor-medium.md", behavior: { workflowMode: "standard", workflowDepth: "standard", autopilot: false, temperature: 0.1, topP: 0.95 }, tools: { allowedTools: executorTools } }),
	"executor-high": createAgentProfile({ id: "executor-high", label: "Executor High", kind: "executor", description: "**The Engineer** — Handles architecture, security-sensitive code, and complex correctness work across module boundaries. Reach for it when changes have wide blast radius or touch data contracts.", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: executorTools, permissions: { read: true, write: true, execute: true }, contextMode: "inherit_session", promptFile: "src/agents/prompts/executor-high.md", behavior: { workflowMode: "standard", workflowDepth: "deep", autopilot: false, temperature: 0.1, topP: 0.95 }, tools: { allowedTools: executorTools } }),
	"executor-frontend": createAgentProfile({ id: "executor-frontend", label: "Executor Frontend", kind: "executor", description: "**The Stylist** — Builds polished Svelte 5 UI components with accessibility and E2E coverage. Use it for responsive, visually coherent interfaces using Tailwind and Hugeicons.", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: executorTools, permissions: { read: true, write: true, execute: true }, contextMode: "inherit_session", promptFile: "src/agents/prompts/executor-frontend.md", behavior: { workflowMode: "standard", workflowDepth: "standard", autopilot: false, temperature: 0.1, topP: 0.95 }, tools: { allowedTools: executorTools } }),
} as const satisfies Record<string, z.infer<typeof agentProfileSchema>>;

export {
	configSchema,
	providerSchema,
	toolPolicyConfigSchema,
	agentBehaviorConfigSchema,
	agentPermissionsSchema,
	agentContextModeSchema,
	agentProfileSchema,
	defaultAgentProfiles,
	mcpServerSchema,
	mcpStdioConfigSchema,
	mcpRemoteConfigSchema,
	registryConfigSchema,
	skillsConfigSchema,
	fieldNotesProviderConfigSchema,
	fieldNotesConfigSchema,
	visualizeModelOverrideSchema,
	agentsMdConfigSchema,
	BUNDLED_REGISTRIES,
};
export type ElefantConfig = z.infer<typeof configSchema>;
export type ProviderEntry = z.infer<typeof providerSchema>;
export type ToolPolicyConfig = z.infer<typeof toolPolicyConfigSchema>;
export type AgentBehaviorConfig = z.infer<typeof agentBehaviorConfigSchema>;
export type AgentPermissions = z.infer<typeof agentPermissionsSchema>;
export type AgentContextMode = z.infer<typeof agentContextModeSchema>;
export type AgentProfile = z.infer<typeof agentProfileSchema>;
export type McpServerConfig = z.infer<typeof mcpServerSchema>;
export type McpStdioConfig = z.infer<typeof mcpStdioConfigSchema>;
export type McpRemoteConfig = z.infer<typeof mcpRemoteConfigSchema>;
export type RegistryConfig = z.infer<typeof registryConfigSchema>;
export type SkillsConfig = z.infer<typeof skillsConfigSchema>;
export type FieldNotesProviderConfig = z.infer<typeof fieldNotesProviderConfigSchema>;
export type FieldNotesConfig = z.infer<typeof fieldNotesConfigSchema>;
export type VisualizeModelOverride = z.infer<typeof visualizeModelOverrideSchema>;
export type AgentsMdConfig = z.infer<typeof agentsMdConfigSchema>;
