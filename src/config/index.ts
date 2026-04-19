export {
	configSchema,
	providerSchema,
	toolPolicyConfigSchema,
	agentRuntimeLimitsSchema,
	agentBehaviorConfigSchema,
	agentProfileSchema,
	defaultAgentProfiles,
} from './schema.ts';
export type {
	ElefantConfig,
	ProviderEntry,
	ToolPolicyConfig,
	AgentRuntimeLimits,
	AgentBehaviorConfig,
	AgentProfile,
} from './schema.ts';
export {
	ConfigManager,
	loadConfig,
	loadConfigFromPath,
} from './loader.ts';
export type {
	ConfigError,
	ConfigSourceLayer,
	ResolvedAgentConfig,
	AgentProfileOverride,
} from './loader.ts';
