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
	mcpServerSchema,
	mcpStdioConfigSchema,
	mcpRemoteConfigSchema,
} from './schema.ts';
export type {
	ElefantConfig,
	ProviderEntry,
	ToolPolicyConfig,
	AgentRuntimeLimits,
	AgentBehaviorConfig,
	AgentPermissions,
	AgentContextMode,
	AgentProfile,
	McpServerConfig,
	McpStdioConfig,
	McpRemoteConfig,
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
