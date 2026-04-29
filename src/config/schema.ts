import { z } from "zod";

const providerSchema = z.object({
	name: z.string().min(1),
	baseURL: z.string().url(),
	apiKey: z.string().min(1),
	model: z.string().min(1),
	format: z.enum(["openai", "anthropic"]),
}).strict();

const toolPolicyConfigSchema = z.object({
	mode: z.enum(["auto", "manual", "deny_all"]),
	allowedTools: z.array(z.string().min(1)).optional(),
	deniedTools: z.array(z.string().min(1)).optional(),
	perToolApproval: z.record(z.string(), z.boolean()).optional(),
}).strict();

const agentRuntimeLimitsSchema = z.object({
	maxIterations: z.number().int().min(1),
	timeoutMs: z.number().int().min(1),
	maxConcurrency: z.number().int().min(1),
	maxTokens: z.number().int().min(1).optional(),
	temperature: z.number().min(0).max(2).optional(),
	topP: z.number().min(0).max(1).optional(),
}).strict();

const agentBehaviorConfigSchema = z.object({
	provider: z.string().min(1).optional(),
	model: z.string().min(1).optional(),
	permissionMode: z.string().min(1).optional(),
	workflowMode: z.enum(["quick", "standard", "comprehensive", "milestone"]).optional(),
	workflowDepth: z.enum(["shallow", "standard", "deep"]).optional(),
	autopilot: z.boolean().optional(),
}).strict();

const agentPermissionsSchema = z.object({
	read: z.boolean().default(true),
	write: z.boolean().default(false),
	execute: z.boolean().default(false),
}).strict();

const agentContextModeSchema = z.enum(["none", "inherit_session", "snapshot"]);

const agentProfileSchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	kind: z.enum(["orchestrator", "planner", "executor", "researcher", "explorer", "verifier", "debugger", "tester", "writer", "librarian", "default", "custom"]),
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
	limits: agentRuntimeLimitsSchema,
	tools: toolPolicyConfigSchema,
	maxTaskDepth: z.number().int().min(0).optional(),
	maxChildren: z.number().int().min(1).optional(),
}).strict();

const configSchema = z.object({
	port: z.number().int().min(1).max(65535).default(1337),
	providers: z.array(providerSchema).default([]),
	defaultProvider: z.string().default(''),
	logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
	projectPath: z.string().default(() => process.cwd()),
	agents: z.record(z.string(), agentProfileSchema).optional(),
}).strict();

type AgentProfileInput = z.input<typeof agentProfileSchema>;

function createAgentProfile(input: AgentProfileInput): z.infer<typeof agentProfileSchema> {
	return agentProfileSchema.parse(input);
}

const commonLimits = {
	maxIterations: 10,
	timeoutMs: 180000,
	maxConcurrency: 1,
	maxTokens: 8192,
	temperature: 0.2,
	topP: 0.95,
};

const readOnlyTools = ["read", "glob", "grep", "memory_search", "memory_save", "spec_status", "spec_spec", "spec_blueprint", "spec_chronicle", "spec_adl"];
const executorTools = ["read", "glob", "grep", "bash", "apply_patch", "memory_search", "memory_save", "spec_status", "spec_chronicle", "spec_adl"];

const defaultAgentProfiles = {
	default: createAgentProfile({ id: "default", label: "Default", kind: "default", description: "Fallback profile for general agent runs", enabled: true, behavior: { workflowMode: "standard", workflowDepth: "standard", autopilot: false }, limits: { ...commonLimits, maxIterations: 8, maxTokens: 4096 }, tools: { mode: "manual" } }),
	orchestrator: createAgentProfile({ id: "orchestrator", label: "Orchestrator", kind: "orchestrator", description: "Coordinator that delegates all implementation through task dispatch", enabled: true, model: "claude-opus-4-7", provider: "anthropic", toolsAllowlist: ["spec_status", "spec_state", "spec_requirements", "spec_spec", "spec_blueprint", "spec_chronicle", "spec_adl", "task", "memory_search", "memory_save", "question"], permissions: { read: true, write: false, execute: false }, contextMode: "inherit_session", promptFile: "src/agents/prompts/orchestrator.md", behavior: { workflowMode: "standard", workflowDepth: "deep", autopilot: false, permissionMode: "strict" }, limits: { ...commonLimits, maxIterations: 16, temperature: 0.2 }, tools: { mode: "manual" } }),
	planner: createAgentProfile({ id: "planner", label: "Planner", kind: "planner", description: "Planning profile for SPEC and BLUEPRINT generation", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: ["read", "glob", "grep", "spec_requirements", "spec_spec", "spec_blueprint", "spec_adl", "memory_search", "memory_decision"], permissions: { read: true, write: true, execute: false }, contextMode: "inherit_session", promptFile: "src/agents/prompts/planner.md", behavior: { workflowMode: "standard", workflowDepth: "deep", autopilot: false, permissionMode: "strict" }, limits: { ...commonLimits, maxIterations: 8, temperature: 0.1 }, tools: { mode: "manual", deniedTools: ["bash"] } }),
	researcher: createAgentProfile({ id: "researcher", label: "Researcher", kind: "researcher", description: "Research profile for source-backed investigation", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: ["read", "glob", "grep", "webfetch", "memory_search", "memory_save", "spec_adl"], permissions: { read: true, write: true, execute: false }, contextMode: "snapshot", promptFile: "src/agents/prompts/researcher.md", behavior: { workflowMode: "comprehensive", workflowDepth: "deep", autopilot: true }, limits: { ...commonLimits, maxIterations: 16, timeoutMs: 240000, temperature: 0.3 }, tools: { mode: "manual" } }),
	explorer: createAgentProfile({ id: "explorer", label: "Explorer", kind: "explorer", description: "Read-only codebase mapping profile", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: ["read", "glob", "grep", "memory_search", "memory_save"], permissions: { read: true, write: false, execute: false }, contextMode: "snapshot", promptFile: "src/agents/prompts/explorer.md", behavior: { workflowMode: "standard", workflowDepth: "standard", autopilot: true }, limits: { ...commonLimits, maxIterations: 8, temperature: 0.2 }, tools: { mode: "manual", allowedTools: readOnlyTools } }),
	verifier: createAgentProfile({ id: "verifier", label: "Verifier", kind: "verifier", description: "Fresh-context validation contract auditor", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: ["read", "glob", "grep", "bash", "spec_spec", "spec_blueprint", "spec_chronicle", "spec_adl", "memory_search", "memory_save"], permissions: { read: true, write: false, execute: true }, contextMode: "none", promptFile: "src/agents/prompts/verifier.md", behavior: { workflowMode: "standard", workflowDepth: "deep", autopilot: false, permissionMode: "strict" }, limits: { ...commonLimits, maxIterations: 10, temperature: 0.1 }, tools: { mode: "manual" } }),
	debugger: createAgentProfile({ id: "debugger", label: "Debugger", kind: "debugger", description: "Scientific debugging profile", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: ["read", "glob", "grep", "bash", "spec_chronicle", "spec_adl", "memory_search", "memory_save"], permissions: { read: true, write: true, execute: true }, contextMode: "snapshot", promptFile: "src/agents/prompts/debugger.md", behavior: { workflowMode: "standard", workflowDepth: "deep", autopilot: false }, limits: { ...commonLimits, maxIterations: 12, temperature: 0.2 }, tools: { mode: "manual" } }),
	tester: createAgentProfile({ id: "tester", label: "Tester", kind: "tester", description: "Bun and Playwright test authoring profile", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: ["read", "glob", "grep", "bash", "apply_patch", "memory_search", "memory_save"], permissions: { read: true, write: true, execute: true }, contextMode: "snapshot", promptFile: "src/agents/prompts/tester.md", behavior: { workflowMode: "standard", workflowDepth: "standard", autopilot: false }, limits: { ...commonLimits, maxIterations: 12, temperature: 0.1 }, tools: { mode: "manual" } }),
	writer: createAgentProfile({ id: "writer", label: "Writer", kind: "writer", description: "Documentation writing profile", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: ["read", "glob", "grep", "apply_patch", "memory_search", "memory_save"], permissions: { read: true, write: true, execute: false }, contextMode: "snapshot", promptFile: "src/agents/prompts/writer.md", behavior: { workflowMode: "standard", workflowDepth: "standard", autopilot: false }, limits: { ...commonLimits, maxIterations: 8, temperature: 0.2 }, tools: { mode: "manual" } }),
	librarian: createAgentProfile({ id: "librarian", label: "Librarian", kind: "librarian", description: "Research and memory synthesis profile", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: ["read", "glob", "grep", "memory_search", "memory_save", "spec_adl", "spec_chronicle"], permissions: { read: true, write: true, execute: false }, contextMode: "snapshot", promptFile: "src/agents/prompts/librarian.md", behavior: { workflowMode: "standard", workflowDepth: "standard", autopilot: true }, limits: { ...commonLimits, maxIterations: 8, temperature: 0.2 }, tools: { mode: "manual" } }),
	"executor-low": createAgentProfile({ id: "executor-low", label: "Executor Low", kind: "executor", description: "Mechanical implementation profile", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: ["read", "glob", "grep", "bash", "apply_patch", "memory_search", "memory_save"], permissions: { read: true, write: true, execute: true }, contextMode: "inherit_session", promptFile: "src/agents/prompts/executor-low.md", behavior: { workflowMode: "standard", workflowDepth: "standard", autopilot: false }, limits: { ...commonLimits, maxIterations: 8, temperature: 0.1 }, tools: { mode: "manual", allowedTools: executorTools } }),
	"executor-medium": createAgentProfile({ id: "executor-medium", label: "Executor Medium", kind: "executor", description: "Business logic implementation profile", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: executorTools, permissions: { read: true, write: true, execute: true }, contextMode: "inherit_session", promptFile: "src/agents/prompts/executor-medium.md", behavior: { workflowMode: "standard", workflowDepth: "standard", autopilot: false }, limits: { ...commonLimits, maxIterations: 12, temperature: 0.1 }, tools: { mode: "manual", allowedTools: executorTools } }),
	"executor-high": createAgentProfile({ id: "executor-high", label: "Executor High", kind: "executor", description: "Architecture and security-sensitive implementation profile", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: executorTools, permissions: { read: true, write: true, execute: true }, contextMode: "inherit_session", promptFile: "src/agents/prompts/executor-high.md", behavior: { workflowMode: "standard", workflowDepth: "deep", autopilot: false }, limits: { ...commonLimits, maxIterations: 14, temperature: 0.1 }, tools: { mode: "manual", allowedTools: executorTools } }),
	"executor-frontend": createAgentProfile({ id: "executor-frontend", label: "Executor Frontend", kind: "executor", description: "Svelte 5 and Tauri UI implementation profile", enabled: true, model: "gpt-5.5", provider: "openai", toolsAllowlist: executorTools, permissions: { read: true, write: true, execute: true }, contextMode: "inherit_session", promptFile: "src/agents/prompts/executor-frontend.md", behavior: { workflowMode: "standard", workflowDepth: "standard", autopilot: false }, limits: { ...commonLimits, maxIterations: 12, temperature: 0.1 }, tools: { mode: "manual", allowedTools: executorTools } }),
	executor: createAgentProfile({ id: "executor", label: "Executor", kind: "executor", description: "Legacy execution profile alias", enabled: true, behavior: { workflowMode: "standard", workflowDepth: "standard", autopilot: false }, limits: { ...commonLimits, maxIterations: 12 }, tools: { mode: "auto" } }),
} as const satisfies Record<string, z.infer<typeof agentProfileSchema>>;

export {
	configSchema,
	providerSchema,
	toolPolicyConfigSchema,
	agentRuntimeLimitsSchema,
	agentBehaviorConfigSchema,
	agentPermissionsSchema,
	agentContextModeSchema,
	agentProfileSchema,
	defaultAgentProfiles,
};
export type ElefantConfig = z.infer<typeof configSchema>;
export type ProviderEntry = z.infer<typeof providerSchema>;
export type ToolPolicyConfig = z.infer<typeof toolPolicyConfigSchema>;
export type AgentRuntimeLimits = z.infer<typeof agentRuntimeLimitsSchema>;
export type AgentBehaviorConfig = z.infer<typeof agentBehaviorConfigSchema>;
export type AgentPermissions = z.infer<typeof agentPermissionsSchema>;
export type AgentContextMode = z.infer<typeof agentContextModeSchema>;
export type AgentProfile = z.infer<typeof agentProfileSchema>;
