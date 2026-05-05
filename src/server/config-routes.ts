import { Elysia } from 'elysia';
import { z } from 'zod';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
	agentProfileSchema,
	configSchema,
	providerSchema,
	fieldNotesConfigSchema,
	visualizeModelOverrideSchema,
	ConfigManager,
	type AgentProfile,
	type ConfigError,
	type ElefantConfig,
	type ResolvedAgentConfig,
} from '../config/index.ts';
import type { ProviderRouter } from '../providers/router.ts';
import { getProviderRegistry } from '../providers/registry/index.ts';

const CONFIG_PATH = join(homedir(), '.config', 'elefant', 'elefant.config.json');

interface FetchedModel {
	id: string;
	name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function fetchProviderModels(
	baseURL: string,
	apiKey: string,
	format: 'openai' | 'anthropic' | 'anthropic-compatible',
): Promise<FetchedModel[]> {
	const normalized = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
	const modelsEndpoint = normalized.endsWith('/v1')
		? `${normalized}/models`
		: `${normalized}/v1/models`;

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};

	if (format === 'openai') {
		headers['Authorization'] = `Bearer ${apiKey}`;
	} else {
		headers['x-api-key'] = apiKey;
		if (format === 'anthropic') {
			headers['anthropic-version'] = '2023-06-01';
		}
	}

	const response = await fetch(modelsEndpoint, {
		method: 'GET',
		headers,
		signal: AbortSignal.timeout(15_000),
	});

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`Provider returned ${response.status}: ${body.slice(0, 200)}`);
	}

	const data = (await response.json()) as unknown;

	// OpenAI-compatible: { data: [{ id, owned_by }] }
	// Anthropic: { data: [{ id, display_name }] }
	if (isRecord(data) && Array.isArray(data.data)) {
		return data.data
			.filter((m: unknown) => isRecord(m) && typeof m.id === 'string')
			.map((m: Record<string, unknown>) => ({
				id: m.id as string,
				name: (m.display_name as string | undefined) ?? (m.id as string),
			}))
			.sort((a: FetchedModel, b: FetchedModel) => a.id.localeCompare(b.id));
	}

	throw new Error('Unexpected response format from provider');
}

// projectId is optional — agent profiles can be global (no project) or
// project-scoped when a projectId is provided.
const ProjectQuerySchema = z.object({
	projectId: z.string().min(1).optional(),
});

const AgentProfilePatchSchema = z
	.object({
		label: z.string().min(1).optional(),
		kind: z.enum(['orchestrator', 'planner', 'executor', 'researcher', 'explorer', 'verifier', 'debugger', 'tester', 'writer', 'librarian', 'default', 'custom']).optional(),
		description: z.string().min(1).optional(),
		enabled: z.boolean().optional(),
		provider: z.string().min(1).optional(),
		model: z.string().min(1).optional(),
		toolsAllowlist: z.array(z.string().min(1)).nullable().optional(),
		permissions: z
			.object({
				read: z.boolean().optional(),
				write: z.boolean().optional(),
				execute: z.boolean().optional(),
			})
			.strict()
			.optional(),
		contextMode: z.enum(['none', 'inherit_session', 'snapshot']).optional(),
		promptFile: z.string().min(1).nullable().optional(),
		promptOverride: z.string().min(1).nullable().optional(),
		behavior: z
			.object({
				provider: z.string().min(1).optional(),
				model: z.string().min(1).optional(),
				temperature: z.number().min(0).max(2).optional(),
				topP: z.number().min(0).max(1).optional(),
				permissionMode: z.string().min(1).optional(),
				workflowMode: z.enum(['quick', 'standard', 'comprehensive', 'milestone']).optional(),
				workflowDepth: z.enum(['shallow', 'standard', 'deep']).optional(),
				autopilot: z.boolean().optional(),
			})
			.strict()
			.optional(),
		tools: z
			.object({
				allowedTools: z.array(z.string().min(1)).optional(),
				deniedTools: z.array(z.string().min(1)).optional(),
				perToolApproval: z.record(z.string(), z.boolean()).optional(),
			})
			.strict()
			.optional(),
	})
	.strict();

function toErrorPayload(error: ConfigError) {
	return {
		ok: false as const,
		error: {
			code: error.code,
			message: error.message,
		},
	};
}

function isPlaceholderApiKey(apiKey: string): boolean {
	return apiKey === 'YOUR_API_KEY_HERE' || apiKey === '';
}

function stripResolvedSources(profile: ResolvedAgentConfig): AgentProfile {
	const clone: AgentProfile & { _sources?: unknown } = { ...profile };
	delete clone._sources;
	return clone;
}

async function readConfigFile(): Promise<ElefantConfig | null> {
	try {
		const file = Bun.file(CONFIG_PATH);
		if (!(await file.exists())) {
			return null;
		}

		const raw = await file.json();
		const parsed = configSchema.safeParse(raw);
		if (!parsed.success) {
			return null;
		}

		return parsed.data;
	} catch {
		return null;
	}
}

async function writeConfigFile(config: ElefantConfig): Promise<void> {
	await Bun.write(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

function createDefaultConfig(): ElefantConfig {
	return configSchema.parse({});
}

export function createConfigRoutes<TApp extends Elysia>(
	app: TApp,
	providerRouter: ProviderRouter,
	configManager: ConfigManager,
): TApp {
	app.get('/api/config', async ({ set }) => {
		const config = await readConfigFile();
		if (!config) {
			set.status = 404;
			return { ok: false, error: 'No config file found' };
		}

		return {
			ok: true,
			config: {
				...config,
				providers: config.providers.map((provider) => ({
					...provider,
					apiKey: isPlaceholderApiKey(provider.apiKey) ? '' : '•'.repeat(8),
				})),
			},
		};
	});

	app.put('/api/config', async ({ body, set }) => {
		const schema = z
			.object({
				port: z.number().int().min(1).max(65535).optional(),
				defaultProvider: z.string().min(1).optional(),
				logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional(),
				compactionThreshold: z.number().min(0.5).max(0.95).optional(),
				visualizeModelOverride: visualizeModelOverrideSchema.nullable().optional(),
				research: fieldNotesConfigSchema.partial().optional(),
			})
			.strict();

		const parsed = schema.safeParse(body);
		if (!parsed.success) {
			set.status = 400;
			return {
				ok: false,
				error: 'Invalid request',
				details: parsed.error.issues,
			};
		}

		const existing = await readConfigFile();
		if (!existing) {
			set.status = 404;
			return { ok: false, error: 'No config file found — create a provider first' };
		}

		// Merge research block — incoming patch is shallow-merged onto existing
		// research config. providerConfig is treated atomically (replace, not merge)
		// so callers can fully reset provider-specific fields by sending an empty
		// object or undefined.
		const mergedResearch = parsed.data.research !== undefined
			? {
				...existing.research,
				...parsed.data.research,
			}
			: existing.research;

		const updated: ElefantConfig = {
			...existing,
			...(parsed.data.port !== undefined ? { port: parsed.data.port } : {}),
			...(parsed.data.defaultProvider !== undefined
				? { defaultProvider: parsed.data.defaultProvider }
				: {}),
			...(parsed.data.logLevel !== undefined ? { logLevel: parsed.data.logLevel } : {}),
			...(parsed.data.compactionThreshold !== undefined
				? { compactionThreshold: parsed.data.compactionThreshold }
				: {}),
			...(parsed.data.visualizeModelOverride !== undefined
				? { visualizeModelOverride: parsed.data.visualizeModelOverride }
				: {}),
			...(parsed.data.research !== undefined ? { research: mergedResearch } : {}),
		};

		await writeConfigFile(updated);
		providerRouter.reload(updated);
		return { ok: true };
	});

	app.post('/api/providers', async ({ body, set }) => {
		const parsed = providerSchema.safeParse(body);
		if (!parsed.success) {
			set.status = 400;
			return { ok: false, error: 'Invalid provider', details: parsed.error.issues };
		}

		const existing = (await readConfigFile()) ?? createDefaultConfig();

		const existingIndex = existing.providers.findIndex((provider) => provider.name === parsed.data.name);
		if (existingIndex !== -1) {
			const existingProvider = existing.providers[existingIndex];
			if (isPlaceholderApiKey(existingProvider.apiKey)) {
				existing.providers[existingIndex] = parsed.data;
			} else {
				set.status = 409;
				return { ok: false, error: `Provider "${parsed.data.name}" already exists` };
			}
		} else {
			existing.providers.push(parsed.data);
		}

		if (!existing.defaultProvider) {
			existing.defaultProvider = parsed.data.name;
		}

		await writeConfigFile(existing);
		providerRouter.reload(existing);
		return { ok: true };
	});

	app.put('/api/providers/:name', async ({ params, body, set }) => {
		const parsed = providerSchema.safeParse(body);
		if (!parsed.success) {
			set.status = 400;
			return { ok: false, error: 'Invalid provider', details: parsed.error.issues };
		}

		const config = await readConfigFile();
		if (!config) {
			set.status = 404;
			return { ok: false, error: 'No config file found' };
		}

		const index = config.providers.findIndex((provider) => provider.name === params.name);
		if (index === -1) {
			set.status = 404;
			return { ok: false, error: `Provider "${params.name}" not found` };
		}

		if (params.name !== parsed.data.name && config.defaultProvider === params.name) {
			config.defaultProvider = parsed.data.name;
		}

		config.providers[index] = parsed.data;
		await writeConfigFile(config);
		providerRouter.reload(config);
		return { ok: true };
	});

	app.delete('/api/providers/:name', async ({ params, set }) => {
		const config = await readConfigFile();
		if (!config) {
			set.status = 404;
			return { ok: false, error: 'No config file found' };
		}

		const before = config.providers.length;
		config.providers = config.providers.filter((provider) => provider.name !== params.name);
		if (config.providers.length === before) {
			set.status = 404;
			return { ok: false, error: `Provider "${params.name}" not found` };
		}

		if (config.defaultProvider === params.name) {
			config.defaultProvider = config.providers[0]?.name ?? '';
		}

		await writeConfigFile(config);
		providerRouter.reload(config);
		return { ok: true };
	});

	app.get('/api/providers/registry', () => {
		const providers = getProviderRegistry();
		return { providers };
	});

	// Fetch models for ALL configured providers using the real stored API keys.
	// The desktop cannot do this itself because GET /api/config masks keys as '••••••••'.
	app.get('/api/providers/all-models', async () => {
		let config: ElefantConfig;
		try {
			const raw = await Bun.file(CONFIG_PATH).json() as unknown;
			const parsed = configSchema.safeParse(raw);
			if (!parsed.success) return { ok: true, models: [] };
			config = parsed.data;
		} catch {
			return { ok: true, models: [] };
		}

		type ModelEntry = { provider: string; id: string; name: string };
		const allModels: ModelEntry[] = [];

		await Promise.allSettled(
			config.providers.map(async (provider) => {
				if (!provider.apiKey || !provider.baseURL) return;
				try {
					const models = await fetchProviderModels(
						provider.baseURL,
						provider.apiKey,
						provider.format as 'openai' | 'anthropic' | 'anthropic-compatible',
					);
					for (const m of models) {
						allModels.push({ provider: provider.name, id: m.id, name: m.name || m.id });
					}
				} catch {
					// Provider unreachable — skip silently
				}
			}),
		);

		return { ok: true, models: allModels };
	});

	app.post('/api/providers/models', async ({ body, set }) => {
		const { baseURL, apiKey, format } = body as {
			baseURL?: string;
			apiKey?: string;
			format?: string;
		};

		if (!baseURL || !apiKey || !format) {
			set.status = 400;
			return { ok: false, error: 'baseURL, apiKey, and format are required' };
		}

		try {
			const models = await fetchProviderModels(
				baseURL,
				apiKey,
				format as 'openai' | 'anthropic' | 'anthropic-compatible',
			);
			return { ok: true, models };
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error.message : 'Failed to fetch models',
			};
		}
	});

	app.get('/api/config/agents', async ({ query, set }) => {
		const queryParse = ProjectQuerySchema.safeParse(query);
		const projectId = queryParse.success ? queryParse.data.projectId : undefined;

		const resolved = await configManager.listResolvedProfiles(projectId);
		if (!resolved.ok) {
			set.status = resolved.error.code === 'FILE_NOT_FOUND' ? 404 : 400;
			return toErrorPayload(resolved.error);
		}

		return { ok: true, data: resolved.data };
	});

	app.get('/api/config/agents/:agentId', async ({ params, query, set }) => {
		const queryParse = ProjectQuerySchema.safeParse(query);
		const projectId = queryParse.success ? queryParse.data.projectId : undefined;

		const resolved = await configManager.resolve(params.agentId, projectId);
		if (!resolved.ok) {
			set.status = resolved.error.code === 'FILE_NOT_FOUND' ? 404 : 400;
			return toErrorPayload(resolved.error);
		}

		return { ok: true, data: resolved.data };
	});

	app.post('/api/config/agents', async ({ body, query, set }) => {
		const queryParse = ProjectQuerySchema.safeParse(query);
		const projectId = queryParse.success ? queryParse.data.projectId : undefined;

		const profileParse = agentProfileSchema.safeParse(body);
		if (!profileParse.success) {
			set.status = 400;
			return {
				ok: false,
				error: {
					code: 'VALIDATION_ERROR',
					message: profileParse.error.message,
				},
			};
		}

		const projectProfiles = await configManager.listProjectProfiles(projectId);
		if (!projectProfiles.ok) {
			set.status = projectProfiles.error.code === 'FILE_NOT_FOUND' ? 404 : 400;
			return toErrorPayload(projectProfiles.error);
		}

		if (projectProfiles.data[profileParse.data.id]) {
			set.status = 409;
			return {
				ok: false,
				error: {
					code: 'VALIDATION_ERROR',
					message: `Profile ${profileParse.data.id} already exists in project layer`,
				},
			};
		}

		const writeResult = await configManager.upsertProjectProfile(
			projectId,
			profileParse.data,
		);
		if (!writeResult.ok) {
			set.status = writeResult.error.code === 'FILE_NOT_FOUND' ? 404 : 400;
			return toErrorPayload(writeResult.error);
		}

		const resolved = await configManager.resolve(profileParse.data.id, projectId);
		if (!resolved.ok) {
			set.status = resolved.error.code === 'FILE_NOT_FOUND' ? 404 : 400;
			return toErrorPayload(resolved.error);
		}

		set.status = 201;
		return { ok: true, data: resolved.data };
	});

	// POST with explicit agentId in URL — creates/upserts with URL param taking precedence
	app.post('/api/config/agents/:agentId', async ({ params, body, query, set }) => {
		const queryParse = ProjectQuerySchema.safeParse(query);
		const projectId = queryParse.success ? queryParse.data.projectId : undefined;

		// URL param takes precedence over body agentId
		const bodyWithAgentId = {
			...(body as Record<string, unknown>),
			id: params.agentId,
		};

		const profileParse = agentProfileSchema.safeParse(bodyWithAgentId);
		if (!profileParse.success) {
			set.status = 400;
			return {
				ok: false,
				error: {
					code: 'VALIDATION_ERROR',
					message: profileParse.error.message,
				},
			};
		}

		const projectProfiles = await configManager.listProjectProfiles(projectId);
		if (!projectProfiles.ok) {
			set.status = projectProfiles.error.code === 'FILE_NOT_FOUND' ? 404 : 400;
			return toErrorPayload(projectProfiles.error);
		}

		if (projectProfiles.data[profileParse.data.id]) {
			set.status = 409;
			return {
				ok: false,
				error: {
					code: 'VALIDATION_ERROR',
					message: `Profile ${profileParse.data.id} already exists in project layer`,
				},
			};
		}

		const writeResult = await configManager.upsertProjectProfile(
			projectId,
			profileParse.data,
		);
		if (!writeResult.ok) {
			set.status = writeResult.error.code === 'FILE_NOT_FOUND' ? 404 : 400;
			return toErrorPayload(writeResult.error);
		}

		const resolved = await configManager.resolve(profileParse.data.id, projectId);
		if (!resolved.ok) {
			set.status = resolved.error.code === 'FILE_NOT_FOUND' ? 404 : 400;
			return toErrorPayload(resolved.error);
		}

		set.status = 201;
		return { ok: true, data: resolved.data };
	});

	app.put('/api/config/agents/:agentId', async ({ params, body, query, set }) => {
		const queryParse = ProjectQuerySchema.safeParse(query);
		const projectId = queryParse.success ? queryParse.data.projectId : undefined;

		const patchParse = AgentProfilePatchSchema.safeParse(body);
		if (!patchParse.success) {
			set.status = 400;
			return {
				ok: false,
				error: {
					code: 'VALIDATION_ERROR',
					message: patchParse.error.message,
				},
			};
		}

		const existingProjectProfiles = await configManager.listProjectProfiles(projectId);
		if (!existingProjectProfiles.ok) {
			set.status = existingProjectProfiles.error.code === 'FILE_NOT_FOUND' ? 404 : 400;
			return toErrorPayload(existingProjectProfiles.error);
		}

		const baseProfileResult = await configManager.resolve(params.agentId, projectId);
		if (!baseProfileResult.ok) {
			set.status = baseProfileResult.error.code === 'FILE_NOT_FOUND' ? 404 : 400;
			return toErrorPayload(baseProfileResult.error);
		}

		const baseProfile = existingProjectProfiles.data[params.agentId] ?? stripResolvedSources(baseProfileResult.data);
		const mergedProfile: AgentProfile = {
			...baseProfile,
			...patchParse.data,
			id: params.agentId,
			permissions: {
				read: patchParse.data.permissions?.read ?? baseProfile.permissions.read,
				write: patchParse.data.permissions?.write ?? baseProfile.permissions.write,
				execute: patchParse.data.permissions?.execute ?? baseProfile.permissions.execute,
			},
			behavior: {
				...baseProfile.behavior,
				...(patchParse.data.behavior ?? {}),
			},
			tools: {
				...baseProfile.tools,
				...(patchParse.data.tools ?? {}),
			},
		};

		const profileParse = agentProfileSchema.safeParse(mergedProfile);
		if (!profileParse.success) {
			set.status = 400;
			return {
				ok: false,
				error: {
					code: 'VALIDATION_ERROR',
					message: profileParse.error.message,
				},
			};
		}

		const updateResult = await configManager.upsertProjectProfile(
			projectId,
			profileParse.data,
		);
		if (!updateResult.ok) {
			set.status = updateResult.error.code === 'FILE_NOT_FOUND' ? 404 : 400;
			return toErrorPayload(updateResult.error);
		}

		const resolved = await configManager.resolve(params.agentId, projectId);
		if (!resolved.ok) {
			set.status = resolved.error.code === 'FILE_NOT_FOUND' ? 404 : 400;
			return toErrorPayload(resolved.error);
		}

		return { ok: true, data: resolved.data };
	});

	app.patch('/api/config/agents/:agentId', async ({ params, body, query, set }) => {
		const queryParse = ProjectQuerySchema.safeParse(query);
		const projectId = queryParse.success ? queryParse.data.projectId : undefined;

		const patchParse = AgentProfilePatchSchema.safeParse(body);
		if (!patchParse.success) {
			set.status = 400;
			return {
				ok: false,
				error: {
					code: 'VALIDATION_ERROR',
					message: patchParse.error.message,
				},
			};
		}

		const existingProjectProfiles = await configManager.listProjectProfiles(projectId);
		if (!existingProjectProfiles.ok) {
			set.status = existingProjectProfiles.error.code === 'FILE_NOT_FOUND' ? 404 : 400;
			return toErrorPayload(existingProjectProfiles.error);
		}

		const baseProfileResult = await configManager.resolve(params.agentId, projectId);
		if (!baseProfileResult.ok) {
			set.status = baseProfileResult.error.code === 'FILE_NOT_FOUND' ? 404 : 400;
			return toErrorPayload(baseProfileResult.error);
		}

		const baseProfile = existingProjectProfiles.data[params.agentId] ?? stripResolvedSources(baseProfileResult.data);
		const mergedProfile: AgentProfile = {
			...baseProfile,
			...patchParse.data,
			id: params.agentId,
			permissions: {
				...baseProfile.permissions,
				...(patchParse.data.permissions ?? {}),
			},
			behavior: {
				...baseProfile.behavior,
				...(patchParse.data.behavior ?? {}),
			},
			tools: {
				...baseProfile.tools,
				...(patchParse.data.tools ?? {}),
			},
		};

		const profileParse = agentProfileSchema.safeParse(mergedProfile);
		if (!profileParse.success) {
			set.status = 400;
			return {
				ok: false,
				error: {
					code: 'VALIDATION_ERROR',
					message: profileParse.error.message,
				},
			};
		}

		const updateResult = await configManager.upsertProjectProfile(
			projectId,
			profileParse.data,
		);
		if (!updateResult.ok) {
			set.status = updateResult.error.code === 'FILE_NOT_FOUND' ? 404 : 400;
			return toErrorPayload(updateResult.error);
		}

		const resolved = await configManager.resolve(params.agentId, projectId);
		if (!resolved.ok) {
			set.status = resolved.error.code === 'FILE_NOT_FOUND' ? 404 : 400;
			return toErrorPayload(resolved.error);
		}

		return { ok: true, data: resolved.data };
	});

	app.delete('/api/config/agents/:agentId', async ({ params, query, set }) => {
		const queryParse = ProjectQuerySchema.safeParse(query);
		const projectId = queryParse.success ? queryParse.data.projectId : undefined;

		const deletion = await configManager.deleteProjectProfile(
			projectId,
			params.agentId,
		);
		if (!deletion.ok) {
			set.status = deletion.error.code === 'FILE_NOT_FOUND' ? 404 : 400;
			return toErrorPayload(deletion.error);
		}

		return { ok: true, data: { deleted: params.agentId } };
	});

	return app;
}
