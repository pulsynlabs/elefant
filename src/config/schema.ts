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

const agentProfileSchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	kind: z.enum(["planner", "executor", "researcher", "default", "custom"]),
	description: z.string().min(1).optional(),
	enabled: z.boolean(),
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

const defaultAgentProfiles = {
	default: {
		id: "default",
		label: "Default",
		kind: "default",
		description: "Fallback profile for general agent runs",
		enabled: true,
		behavior: {
			workflowMode: "standard",
			workflowDepth: "standard",
			autopilot: false,
		},
		limits: {
			maxIterations: 8,
			timeoutMs: 120000,
			maxConcurrency: 1,
			maxTokens: 4096,
			temperature: 0.2,
			topP: 0.9,
		},
		tools: {
			mode: "manual",
		},
	},
	planner: {
		id: "planner",
		label: "Planner",
		kind: "planner",
		description: "Planning-oriented profile with conservative tool access",
		enabled: true,
		behavior: {
			workflowMode: "standard",
			workflowDepth: "deep",
			autopilot: false,
			permissionMode: "strict",
		},
		limits: {
			maxIterations: 6,
			timeoutMs: 90000,
			maxConcurrency: 1,
			maxTokens: 3072,
			temperature: 0.1,
			topP: 0.8,
		},
		tools: {
			mode: "manual",
			deniedTools: ["bash"],
		},
	},
	executor: {
		id: "executor",
		label: "Executor",
		kind: "executor",
		description: "Execution profile for implementation tasks",
		enabled: true,
		behavior: {
			workflowMode: "standard",
			workflowDepth: "standard",
			autopilot: false,
		},
		limits: {
			maxIterations: 12,
			timeoutMs: 180000,
			maxConcurrency: 2,
			maxTokens: 8192,
			temperature: 0.2,
			topP: 0.95,
		},
		tools: {
			mode: "auto",
		},
	},
	researcher: {
		id: "researcher",
		label: "Researcher",
		kind: "researcher",
		description: "Research profile optimized for exploration",
		enabled: true,
		behavior: {
			workflowMode: "comprehensive",
			workflowDepth: "deep",
			autopilot: true,
		},
		limits: {
			maxIterations: 16,
			timeoutMs: 240000,
			maxConcurrency: 2,
			maxTokens: 8192,
			temperature: 0.3,
			topP: 0.95,
		},
		tools: {
			mode: "manual",
		},
	},
} as const satisfies Record<string, z.infer<typeof agentProfileSchema>>;

export {
	configSchema,
	providerSchema,
	toolPolicyConfigSchema,
	agentRuntimeLimitsSchema,
	agentBehaviorConfigSchema,
	agentProfileSchema,
	defaultAgentProfiles,
};
export type ElefantConfig = z.infer<typeof configSchema>;
export type ProviderEntry = z.infer<typeof providerSchema>;
export type ToolPolicyConfig = z.infer<typeof toolPolicyConfigSchema>;
export type AgentRuntimeLimits = z.infer<typeof agentRuntimeLimitsSchema>;
export type AgentBehaviorConfig = z.infer<typeof agentBehaviorConfigSchema>;
export type AgentProfile = z.infer<typeof agentProfileSchema>;
