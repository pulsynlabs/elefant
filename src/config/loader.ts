import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

import {
	agentProfileSchema,
	configSchema,
	defaultAgentProfiles,
	type AgentBehaviorConfig,
	type AgentProfile,
	type AgentRuntimeLimits,
	type ElefantConfig,
	type ToolPolicyConfig,
	type ProviderEntry,
} from './schema.ts';
import type { ElefantError } from '../types/errors.ts';
import { err, ok, type Result } from '../types/result.ts';

export interface ConfigError extends ElefantError {}

export type ConfigSourceLayer = 'default' | 'global' | 'project' | 'override';

export interface ResolvedAgentConfig extends AgentProfile {
	_sources: Record<string, ConfigSourceLayer>;
}

export type AgentProfileOverride = Omit<Partial<AgentProfile>, 'behavior' | 'limits' | 'tools'> & {
	behavior?: Partial<AgentBehaviorConfig>;
	limits?: Partial<AgentRuntimeLimits>;
	tools?: Partial<ToolPolicyConfig>;
};

interface RawConfig {
	port?: number;
	providers?: ProviderEntry[];
	defaultProvider?: string;
	logLevel?: 'debug' | 'info' | 'warn' | 'error';
	agents?: Record<string, AgentProfile>;
}

interface ConfigManagerOptions {
	globalConfigPath?: string;
	projectPathResolver?: (
		projectId: string,
	) => Result<string, ConfigError> | Promise<Result<string, ConfigError>>;
}

const DEFAULT_GLOBAL_CONFIG_PATH = join(
	homedir(),
	'.config',
	'elefant',
	'elefant.config.json',
);

const DEFAULT_CONFIG_SEARCH_PATHS = [
	'./elefant.config.ts',
	'./elefant.config.json',
	join(homedir(), '.config', 'elefant', 'elefant.config.ts'),
	DEFAULT_GLOBAL_CONFIG_PATH,
];

function makeConfigError(code: ConfigError['code'], message: string, details?: unknown): ConfigError {
	return { code, message, details };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function fileExists(path: string): Promise<boolean> {
	try {
		return await Bun.file(path).exists();
	} catch {
		return false;
	}
}

async function loadRawTsConfig(path: string): Promise<Result<RawConfig, ConfigError>> {
	try {
		const module = await import(resolve(path));
		const config = module.default ?? module.config;
		if (!isRecord(config)) {
			return err(
				makeConfigError(
					'CONFIG_INVALID',
					`Config file ${path} must export a config object`,
				),
			);
		}

		return ok(config as RawConfig);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return err(
			makeConfigError(
				'CONFIG_INVALID',
				`Failed to load TypeScript config from ${path}: ${message}`,
			),
		);
	}
}

async function loadRawJsonConfig(path: string): Promise<Result<RawConfig, ConfigError>> {
	try {
		const raw = await Bun.file(path).json();
		if (!isRecord(raw)) {
			return err(
				makeConfigError(
					'CONFIG_INVALID',
					`Config file ${path} must contain a JSON object`,
				),
			);
		}

		return ok(raw as RawConfig);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return err(
			makeConfigError(
				'CONFIG_INVALID',
				`Failed to load JSON config from ${path}: ${message}`,
			),
		);
	}
}

function formatZodErrors(error: z.ZodError): string {
	return error.issues
		.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
		.join(', ');
}

function applyEnvOverrides(config: RawConfig): RawConfig {
	const result: RawConfig = { ...config };

	if (process.env.ELEFANT_PORT) {
		const port = Number.parseInt(process.env.ELEFANT_PORT, 10);
		if (!Number.isNaN(port)) {
			result.port = port;
		}
	}

	if (process.env.ELEFANT_DEFAULT_PROVIDER) {
		result.defaultProvider = process.env.ELEFANT_DEFAULT_PROVIDER;
	}

	if (result.providers && result.providers.length > 0) {
		const firstProvider = { ...result.providers[0] };
		if (process.env.ELEFANT_MODEL) {
			firstProvider.model = process.env.ELEFANT_MODEL;
		}
		if (process.env.ELEFANT_API_KEY) {
			firstProvider.apiKey = process.env.ELEFANT_API_KEY;
		}
		if (process.env.ELEFANT_BASE_URL) {
			firstProvider.baseURL = process.env.ELEFANT_BASE_URL;
		}

		result.providers = [firstProvider, ...result.providers.slice(1)];
	}

	return result;
}

export async function loadConfigFromPath(path: string): Promise<Result<ElefantConfig, ConfigError>> {
	const loaded = path.endsWith('.ts')
		? await loadRawTsConfig(path)
		: await loadRawJsonConfig(path);

	if (!loaded.ok) {
		return loaded;
	}

	const parsed = configSchema.safeParse(loaded.data);
	if (!parsed.success) {
		return err(
			makeConfigError('CONFIG_INVALID', formatZodErrors(parsed.error), parsed.error.issues),
		);
	}

	return ok(parsed.data);
}

async function loadOptionalConfigFromPath(path: string): Promise<Result<ElefantConfig | null, ConfigError>> {
	if (!(await fileExists(path))) {
		return ok(null);
	}

	const loaded = await loadConfigFromPath(path);
	if (!loaded.ok) {
		return loaded;
	}

	return ok(loaded.data);
}

async function discoverConfig(): Promise<RawConfig> {
	for (const path of DEFAULT_CONFIG_SEARCH_PATHS) {
		if (!(await fileExists(path))) {
			continue;
		}

		const loaded = path.endsWith('.ts')
			? await loadRawTsConfig(path)
			: await loadRawJsonConfig(path);

		if (loaded.ok) {
			return loaded.data;
		}

		console.error(`[elefant] Config warning: ${loaded.error.message}`);
	}

	return {};
}

function cloneAgentProfile(profile: AgentProfile): AgentProfile {
	return {
		...profile,
		toolsAllowlist: profile.toolsAllowlist ? [...profile.toolsAllowlist] : null,
		permissions: { ...profile.permissions },
		behavior: { ...profile.behavior },
		limits: { ...profile.limits },
		tools: {
			...profile.tools,
			allowedTools: profile.tools.allowedTools ? [...profile.tools.allowedTools] : undefined,
			deniedTools: profile.tools.deniedTools ? [...profile.tools.deniedTools] : undefined,
			perToolApproval: profile.tools.perToolApproval
				? { ...profile.tools.perToolApproval }
				: undefined,
		},
	};
}

function cloneAgentProfileOverride(profile: AgentProfileOverride): AgentProfileOverride {
	return {
		...profile,
		toolsAllowlist: profile.toolsAllowlist ? [...profile.toolsAllowlist] : undefined,
		permissions: profile.permissions ? { ...profile.permissions } : undefined,
		behavior: profile.behavior ? { ...profile.behavior } : undefined,
		limits: profile.limits ? { ...profile.limits } : undefined,
		tools: profile.tools
			? {
					...profile.tools,
					allowedTools: profile.tools.allowedTools ? [...profile.tools.allowedTools] : undefined,
					deniedTools: profile.tools.deniedTools ? [...profile.tools.deniedTools] : undefined,
					perToolApproval: profile.tools.perToolApproval
						? { ...profile.tools.perToolApproval }
						: undefined,
			  }
			: undefined,
	};
}

function collectSourceLeafPaths(
	value: unknown,
	source: ConfigSourceLayer,
	target: Record<string, ConfigSourceLayer>,
	basePath = '',
): void {
	if (value === undefined) {
		return;
	}

	if (Array.isArray(value) || !isRecord(value)) {
		target[basePath] = source;
		return;
	}

	for (const [key, nested] of Object.entries(value)) {
		const path = basePath ? `${basePath}.${key}` : key;
		collectSourceLeafPaths(nested, source, target, path);
	}
}

function applyLayer(
	target: Record<string, unknown>,
	layer: Record<string, unknown>,
	source: ConfigSourceLayer,
	sourceMap: Record<string, ConfigSourceLayer>,
	basePath = '',
): void {
	for (const [key, value] of Object.entries(layer)) {
		if (value === undefined) {
			continue;
		}

		const path = basePath ? `${basePath}.${key}` : key;
		const existing = target[key];

		if (isRecord(value) && isRecord(existing)) {
			applyLayer(existing, value, source, sourceMap, path);
			continue;
		}

		target[key] = value;
		collectSourceLeafPaths(value, source, sourceMap, path);
	}
}

function buildDefaultProfile(agentId: string): AgentProfile {
	const preset = defaultAgentProfiles[agentId as keyof typeof defaultAgentProfiles]
		?? defaultAgentProfiles.default;
	const base = cloneAgentProfile(preset);

	if (!defaultAgentProfiles[agentId as keyof typeof defaultAgentProfiles]) {
		base.id = agentId;
		base.label = agentId;
		base.kind = 'custom';
		base.description = `Default fallback profile for ${agentId}`;
	}

	return base;
}

async function writeConfigFile(path: string, config: ElefantConfig): Promise<Result<void, ConfigError>> {
	try {
		await mkdir(dirname(path), { recursive: true });
		await Bun.write(path, `${JSON.stringify(config, null, 2)}\n`);
		return ok(undefined);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return err(makeConfigError('TOOL_EXECUTION_FAILED', `Failed to write config: ${message}`));
	}
}

export class ConfigManager {
	private readonly globalConfigPath: string;
	private readonly projectPathResolver?: ConfigManagerOptions['projectPathResolver'];

	constructor(options: ConfigManagerOptions = {}) {
		this.globalConfigPath = options.globalConfigPath ?? DEFAULT_GLOBAL_CONFIG_PATH;
		this.projectPathResolver = options.projectPathResolver;
	}

	private async resolveProjectConfigPath(projectId: string): Promise<Result<string, ConfigError>> {
		if (!projectId.trim()) {
			return err(makeConfigError('FILE_NOT_FOUND', 'Project id is required'));
		}

		if (!this.projectPathResolver) {
			return err(
				makeConfigError(
					'FILE_NOT_FOUND',
					'Project path resolver is not configured for ConfigManager',
				),
			);
		}

		const projectPathResult = await this.projectPathResolver(projectId);
		if (!projectPathResult.ok) {
			return projectPathResult;
		}

		return ok(join(projectPathResult.data, '.elefant', 'config.json'));
	}

	private async getGlobalConfig(): Promise<Result<ElefantConfig | null, ConfigError>> {
		return loadOptionalConfigFromPath(this.globalConfigPath);
	}

	private async getProjectConfig(projectId: string): Promise<Result<ElefantConfig | null, ConfigError>> {
		const pathResult = await this.resolveProjectConfigPath(projectId);
		if (!pathResult.ok) {
			if (pathResult.error.code === 'FILE_NOT_FOUND') {
				return ok(null);
			}
			return pathResult;
		}

		return loadOptionalConfigFromPath(pathResult.data);
	}

	private resolveFromLayers(
		agentId: string,
		globalConfig: ElefantConfig | null,
		projectConfig: ElefantConfig | null,
		override?: AgentProfileOverride,
	): Result<ResolvedAgentConfig, ConfigError> {
		const effective = buildDefaultProfile(agentId);
		const sourceMap: Record<string, ConfigSourceLayer> = {};

		collectSourceLeafPaths(effective, 'default', sourceMap);

		if (globalConfig?.agents?.default) {
			applyLayer(
				effective as unknown as Record<string, unknown>,
				cloneAgentProfileOverride(globalConfig.agents.default) as unknown as Record<string, unknown>,
				'global',
				sourceMap,
			);
		}

		if (globalConfig?.agents?.[agentId]) {
			applyLayer(
				effective as unknown as Record<string, unknown>,
				cloneAgentProfileOverride(globalConfig.agents[agentId]) as unknown as Record<string, unknown>,
				'global',
				sourceMap,
			);
		}

		if (projectConfig?.agents?.default) {
			applyLayer(
				effective as unknown as Record<string, unknown>,
				cloneAgentProfileOverride(projectConfig.agents.default) as unknown as Record<string, unknown>,
				'project',
				sourceMap,
			);
		}

		if (projectConfig?.agents?.[agentId]) {
			applyLayer(
				effective as unknown as Record<string, unknown>,
				cloneAgentProfileOverride(projectConfig.agents[agentId]) as unknown as Record<string, unknown>,
				'project',
				sourceMap,
			);
		}

		if (override) {
			applyLayer(
				effective as unknown as Record<string, unknown>,
				cloneAgentProfileOverride(override) as unknown as Record<string, unknown>,
				'override',
				sourceMap,
			);
		}

		const parsed = agentProfileSchema.safeParse(effective);
		if (!parsed.success) {
			return err(
				makeConfigError('CONFIG_INVALID', formatZodErrors(parsed.error), parsed.error.issues),
			);
		}

		return ok({
			...parsed.data,
			_sources: sourceMap,
		});
	}

	public async resolve(
		agentId: string,
		projectId: string | undefined,
		override?: AgentProfileOverride,
	): Promise<Result<ResolvedAgentConfig, ConfigError>> {
		const globalResult = await this.getGlobalConfig();
		if (!globalResult.ok) return globalResult;

		let projectConfig: ElefantConfig | null = null;
		if (projectId) {
			const projectResult = await this.getProjectConfig(projectId);
			if (!projectResult.ok) return projectResult;
			projectConfig = projectResult.data;
		}

		return this.resolveFromLayers(agentId, globalResult.data, projectConfig, override);
	}

	public async listResolvedProfiles(
		projectId: string | undefined,
	): Promise<Result<Record<string, ResolvedAgentConfig>, ConfigError>> {
		const globalResult = await this.getGlobalConfig();
		if (!globalResult.ok) return globalResult;

		let projectConfig: ElefantConfig | null = null;
		if (projectId) {
			const projectResult = await this.getProjectConfig(projectId);
			if (!projectResult.ok) return projectResult;
			projectConfig = projectResult.data;
		}

		const ids = new Set<string>(Object.keys(defaultAgentProfiles));

		for (const id of Object.keys(globalResult.data?.agents ?? {})) {
			ids.add(id);
		}

		for (const id of Object.keys(projectConfig?.agents ?? {})) {
			ids.add(id);
		}

		const resolved: Record<string, ResolvedAgentConfig> = {};
		for (const id of ids) {
			const profileResult = this.resolveFromLayers(id, globalResult.data, projectConfig);
			if (!profileResult.ok) {
				return profileResult;
			}
			resolved[id] = profileResult.data;
		}

		return ok(resolved);
	}

	public async getConfig(): Promise<Result<ElefantConfig, ConfigError>> {
		const globalResult = await this.getGlobalConfig();
		if (!globalResult.ok) return globalResult;

		return ok(globalResult.data ?? configSchema.parse({}));
	}

	public async listProjectProfiles(
		projectId: string | undefined,
	): Promise<Result<Record<string, AgentProfile>, ConfigError>> {
		if (!projectId) return ok({});

		const configResult = await this.getProjectConfig(projectId);
		if (!configResult.ok) {
			return configResult;
		}

		return ok(configResult.data?.agents ?? {});
	}

	public async upsertProjectProfile(
		projectId: string | undefined,
		profile: AgentProfile,
	): Promise<Result<void, ConfigError>> {
		if (!projectId) {
			// No project scoping — write to the global config instead
			return this.upsertGlobalProfile(profile);
		}

		const pathResult = await this.resolveProjectConfigPath(projectId);
		if (!pathResult.ok) {
			return pathResult;
		}

		const configResult = await loadOptionalConfigFromPath(pathResult.data);
		if (!configResult.ok) {
			return configResult;
		}

		const baseConfig = configResult.data ?? configSchema.parse({});
		const nextConfig: ElefantConfig = {
			...baseConfig,
			agents: {
				...(baseConfig.agents ?? {}),
				[profile.id]: profile,
			},
		};

		return writeConfigFile(pathResult.data, nextConfig);
	}

	/** Write a profile to the global config (used when no projectId is provided). */
	private async upsertGlobalProfile(profile: AgentProfile): Promise<Result<void, ConfigError>> {
		const configResult = await loadOptionalConfigFromPath(this.globalConfigPath);
		if (!configResult.ok) return configResult;

		const baseConfig = configResult.data ?? configSchema.parse({});
		const nextConfig: ElefantConfig = {
			...baseConfig,
			agents: { ...(baseConfig.agents ?? {}), [profile.id]: profile },
		};

		return writeConfigFile(this.globalConfigPath, nextConfig);
	}

	public async deleteProjectProfile(
		projectId: string | undefined,
		agentId: string,
	): Promise<Result<void, ConfigError>> {
		if (!projectId) {
			return err(makeConfigError('VALIDATION_ERROR', 'projectId is required to delete a profile from project config'));
		}

		const pathResult = await this.resolveProjectConfigPath(projectId);
		if (!pathResult.ok) {
			return pathResult;
		}

		const configResult = await loadOptionalConfigFromPath(pathResult.data);
		if (!configResult.ok) {
			return configResult;
		}

		const existingConfig = configResult.data;
		if (!existingConfig?.agents?.[agentId]) {
			return err(makeConfigError('FILE_NOT_FOUND', `Profile ${agentId} not found in project config`));
		}

		const nextAgents = { ...existingConfig.agents };
		delete nextAgents[agentId];

		const nextConfig: ElefantConfig = {
			...existingConfig,
			agents: Object.keys(nextAgents).length > 0 ? nextAgents : undefined,
		};

		return writeConfigFile(pathResult.data, nextConfig);
	}
}

/**
 * Discover and load config for daemon startup.
 * Falls back to empty defaults when no config file exists.
 */
export async function loadConfig(): Promise<Result<ElefantConfig, ConfigError>> {
	const discovered = await discoverConfig();
	const merged = applyEnvOverrides(discovered);

	const parsed = configSchema.safeParse(merged);
	if (!parsed.success) {
		return err(
			makeConfigError('CONFIG_INVALID', formatZodErrors(parsed.error), parsed.error.issues),
		);
	}

	return ok(parsed.data);
}
