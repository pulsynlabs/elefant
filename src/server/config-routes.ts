import { Elysia } from 'elysia';
import { z } from 'zod';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
	agentProfileSchema,
	configSchema,
	providerSchema,
	ConfigManager,
	type AgentProfile,
	type ConfigError,
	type ElefantConfig,
} from '../config/index.ts';
import type { ProviderRouter } from '../providers/router.ts';

const CONFIG_PATH = join(homedir(), '.config', 'elefant', 'elefant.config.json');

// projectId is optional — agent profiles can be global (no project) or
// project-scoped when a projectId is provided.
const ProjectQuerySchema = z.object({
	projectId: z.string().min(1).optional(),
});

const AgentProfilePatchSchema = z
	.object({
		label: z.string().min(1).optional(),
		kind: z.enum(['planner', 'executor', 'researcher', 'default', 'custom']).optional(),
		description: z.string().min(1).optional(),
		enabled: z.boolean().optional(),
		behavior: z
			.object({
				provider: z.string().min(1).optional(),
				model: z.string().min(1).optional(),
				permissionMode: z.string().min(1).optional(),
				workflowMode: z.enum(['quick', 'standard', 'comprehensive', 'milestone']).optional(),
				workflowDepth: z.enum(['shallow', 'standard', 'deep']).optional(),
				autopilot: z.boolean().optional(),
			})
			.strict()
			.optional(),
		limits: z
			.object({
				maxIterations: z.number().int().min(1).optional(),
				timeoutMs: z.number().int().min(1).optional(),
				maxConcurrency: z.number().int().min(1).optional(),
				maxTokens: z.number().int().min(1).optional(),
				temperature: z.number().min(0).max(2).optional(),
				topP: z.number().min(0).max(1).optional(),
			})
			.strict()
			.optional(),
		tools: z
			.object({
				mode: z.enum(['auto', 'manual', 'deny_all']).optional(),
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

		const updated: ElefantConfig = {
			...existing,
			...(parsed.data.port !== undefined ? { port: parsed.data.port } : {}),
			...(parsed.data.defaultProvider !== undefined
				? { defaultProvider: parsed.data.defaultProvider }
				: {}),
			...(parsed.data.logLevel !== undefined ? { logLevel: parsed.data.logLevel } : {}),
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

		const baseProfile = existingProjectProfiles.data[params.agentId] ?? baseProfileResult.data;
		const mergedProfile: AgentProfile = {
			...baseProfile,
			...patchParse.data,
			id: params.agentId,
			behavior: {
				...baseProfile.behavior,
				...(patchParse.data.behavior ?? {}),
			},
			limits: {
				...baseProfile.limits,
				...(patchParse.data.limits ?? {}),
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
