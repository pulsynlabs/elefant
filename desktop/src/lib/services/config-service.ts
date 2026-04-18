import { mkdir, readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { homeDir, join } from '@tauri-apps/api/path';
import type { ElefantConfig, ProviderEntry } from '$lib/daemon/types.js';

const CONFIG_DIR = '.config/elefant';
const CONFIG_FILE = 'elefant.config.json';

const DEFAULT_CONFIG: ElefantConfig = {
	port: 1337,
	providers: [],
	defaultProvider: '',
	logLevel: 'info',
};

async function getConfigPath(): Promise<string> {
	const home = await homeDir();
	return await join(home, CONFIG_DIR, CONFIG_FILE);
}

async function ensureConfigDir(): Promise<void> {
	const home = await homeDir();
	const configDir = await join(home, CONFIG_DIR);
	const dirExists = await exists(configDir);
	if (!dirExists) {
		await mkdir(configDir, { recursive: true });
	}
}

export async function readConfig(): Promise<ElefantConfig | null> {
	try {
		const configPath = await getConfigPath();
		const fileExists = await exists(configPath);

		if (!fileExists) {
			return null;
		}

		const content = await readTextFile(configPath);
		const parsed = JSON.parse(content) as ElefantConfig;
		return parsed;
	} catch (error) {
		console.error('Failed to read config:', error);
		return null;
	}
}

export async function writeConfig(config: ElefantConfig): Promise<void> {
	try {
		await ensureConfigDir();
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new Error(`Could not create config directory (~/.config/elefant/): ${msg}`);
	}
	const configPath = await getConfigPath();
	const content = JSON.stringify(config, null, 2);
	try {
		await writeTextFile(configPath, content);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new Error(`Could not write config file (${configPath}): ${msg}`);
	}
}

export async function getOrCreateConfig(): Promise<ElefantConfig> {
	const existing = await readConfig();
	if (existing) return existing;

	await writeConfig(DEFAULT_CONFIG);
	return { ...DEFAULT_CONFIG };
}

export async function addProvider(provider: ProviderEntry): Promise<void> {
	const config = await getOrCreateConfig();

	if (config.providers.some(p => p.name === provider.name)) {
		throw new Error(`Provider with name "${provider.name}" already exists`);
	}

	config.providers.push(provider);
	if (!config.defaultProvider) {
		config.defaultProvider = provider.name;
	}

	await writeConfig(config);
}

export async function updateProvider(name: string, updated: ProviderEntry): Promise<void> {
	const config = await getOrCreateConfig();
	const index = config.providers.findIndex(p => p.name === name);

	if (index === -1) {
		throw new Error(`Provider "${name}" not found`);
	}

	if (name !== updated.name && config.defaultProvider === name) {
		config.defaultProvider = updated.name;
	}

	config.providers[index] = updated;
	await writeConfig(config);
}

export async function deleteProvider(name: string): Promise<void> {
	const config = await getOrCreateConfig();
	config.providers = config.providers.filter(p => p.name !== name);

	if (config.defaultProvider === name) {
		config.defaultProvider = config.providers[0]?.name ?? '';
	}

	await writeConfig(config);
}

export async function setDefaultProvider(name: string): Promise<void> {
	const config = await getOrCreateConfig();
	config.defaultProvider = name;
	await writeConfig(config);
}

export async function setLogLevel(level: ElefantConfig['logLevel']): Promise<void> {
	const config = await getOrCreateConfig();
	config.logLevel = level;
	await writeConfig(config);
}

export async function setPort(port: number): Promise<void> {
	const config = await getOrCreateConfig();
	config.port = port;
	await writeConfig(config);
}

export const configService = {
	readConfig,
	writeConfig,
	getOrCreateConfig,
	addProvider,
	updateProvider,
	deleteProvider,
	setDefaultProvider,
	setLogLevel,
	setPort,
};
