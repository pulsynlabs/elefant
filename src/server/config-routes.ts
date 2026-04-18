import { Elysia } from 'elysia'
import { z } from 'zod'

import { configSchema, providerSchema } from '../config/schema.ts'
import type { ElefantConfig } from '../config/index.ts'
import type { ProviderRouter } from '../providers/router.ts'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CONFIG_PATH = join(homedir(), '.config', 'elefant', 'elefant.config.json')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readConfigFile(): Promise<ElefantConfig | null> {
	try {
		const file = Bun.file(CONFIG_PATH)
		if (!(await file.exists())) return null
		const raw = await file.json()
		const parsed = configSchema.safeParse(raw)
		return parsed.success ? parsed.data : null
	} catch {
		return null
	}
}

async function writeConfigFile(config: ElefantConfig): Promise<void> {
	// Bun.write creates parent directories automatically
	await Bun.write(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n')
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createConfigRoutes<TApp extends Elysia>(app: TApp, providerRouter: ProviderRouter): TApp {
	// GET /api/config — read full config
	app.get('/api/config', async ({ set }) => {
		const config = await readConfigFile()
		if (!config) {
			set.status = 404
			return { ok: false, error: 'No config file found' }
		}
		// Mask API keys — send empty string for unconfigured, bullets for real keys
		const isPlaceholder = (key: string) => key === 'YOUR_API_KEY_HERE' || key === ''
		return {
			ok: true,
			config: {
				...config,
				providers: config.providers.map((p) => ({
					...p,
					apiKey: isPlaceholder(p.apiKey) ? '' : '•'.repeat(8),
				})),
			},
		}
	})

	// PUT /api/config — update general settings (port, logLevel, defaultProvider)
	app.put('/api/config', async ({ body, set }) => {
		const schema = z.object({
			port: z.number().int().min(1).max(65535).optional(),
			defaultProvider: z.string().min(1).optional(),
			logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional(),
		})

		const parsed = schema.safeParse(body)
		if (!parsed.success) {
			set.status = 400
			return { ok: false, error: 'Invalid request', details: parsed.error.issues }
		}

		const existing = await readConfigFile()
		if (!existing) {
			set.status = 404
			return { ok: false, error: 'No config file found — create a provider first' }
		}

		const updated: ElefantConfig = {
			...existing,
			...(parsed.data.port !== undefined ? { port: parsed.data.port } : {}),
			...(parsed.data.defaultProvider !== undefined
				? { defaultProvider: parsed.data.defaultProvider }
				: {}),
			...(parsed.data.logLevel !== undefined ? { logLevel: parsed.data.logLevel } : {}),
		}

		await writeConfigFile(updated)
		providerRouter.reload(updated)
		return { ok: true }
	})

	// POST /api/providers — add a provider
	app.post('/api/providers', async ({ body, set }) => {
		const parsed = providerSchema.safeParse(body)
		if (!parsed.success) {
			set.status = 400
			return { ok: false, error: 'Invalid provider', details: parsed.error.issues }
		}

		const existing = (await readConfigFile()) ?? {
			port: 1337,
			providers: [],
			defaultProvider: '',
			logLevel: 'info' as const,
		}

		const existingIndex = existing.providers.findIndex((p) => p.name === parsed.data.name)
		if (existingIndex !== -1) {
			const existingProvider = existing.providers[existingIndex]
			// If the existing entry is a placeholder, overwrite it silently
			if (existingProvider.apiKey === 'YOUR_API_KEY_HERE' || existingProvider.apiKey === '') {
				existing.providers[existingIndex] = parsed.data
			} else {
				set.status = 409
				return { ok: false, error: `Provider "${parsed.data.name}" already exists` }
			}
		} else {
			existing.providers.push(parsed.data)
		}

		if (!existing.defaultProvider) {
			existing.defaultProvider = parsed.data.name
		}

		await writeConfigFile(existing)
		providerRouter.reload(existing)
		return { ok: true }
	})

	// PUT /api/providers/:name — update a provider
	app.put('/api/providers/:name', async ({ params, body, set }) => {
		const parsed = providerSchema.safeParse(body)
		if (!parsed.success) {
			set.status = 400
			return { ok: false, error: 'Invalid provider', details: parsed.error.issues }
		}

		const config = await readConfigFile()
		if (!config) {
			set.status = 404
			return { ok: false, error: 'No config file found' }
		}

		const index = config.providers.findIndex((p) => p.name === params.name)
		if (index === -1) {
			set.status = 404
			return { ok: false, error: `Provider "${params.name}" not found` }
		}

		// If the name changed, update defaultProvider reference too
		if (params.name !== parsed.data.name && config.defaultProvider === params.name) {
			config.defaultProvider = parsed.data.name
		}

		config.providers[index] = parsed.data
		await writeConfigFile(config)
		providerRouter.reload(config)
		return { ok: true }
	})

	// DELETE /api/providers/:name — remove a provider
	app.delete('/api/providers/:name', async ({ params, set }) => {
		const config = await readConfigFile()
		if (!config) {
			set.status = 404
			return { ok: false, error: 'No config file found' }
		}

		const before = config.providers.length
		config.providers = config.providers.filter((p) => p.name !== params.name)

		if (config.providers.length === before) {
			set.status = 404
			return { ok: false, error: `Provider "${params.name}" not found` }
		}

		if (config.defaultProvider === params.name) {
			config.defaultProvider = config.providers[0]?.name ?? ''
		}

		await writeConfigFile(config)
		providerRouter.reload(config)
		return { ok: true }
	})

	return app
}
