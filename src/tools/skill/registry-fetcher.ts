import { createHash } from 'node:crypto';
import { mkdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RegistryConfig, SkillsConfig } from '../../config/index.js';
import {
	fetchClawHubRegistry,
	fetchGithubRegistry,
	fetchNativeRegistry,
	type NormalizedSkill,
} from './registry-adapters.js';

const SKILL_FETCH_TIMEOUT_MS = 10_000;

export interface RegistryFetchResult {
	type: RegistryConfig['type'];
	url: string;
	status: 'fetched' | 'cached' | 'failed' | 'disabled';
	skillCount?: number;
	error?: string;
}

interface RegistryFetcherOptions {
	fetchImpl?: typeof fetch;
	now?: () => Date;
	cacheRoot?: string;
}

function defaultCacheRoot(): string {
	return join(homedir(), '.config', 'elefant', 'cache', 'skills');
}

function registryCacheDir(cacheRoot: string, registry: RegistryConfig): string {
	const hash = createHash('sha256').update(registry.url).digest('hex').slice(0, 12);
	return join(cacheRoot, `${registry.type}-${hash}`);
}

function markerPath(cacheDir: string): string {
	return join(cacheDir, '.last-fetched');
}

async function isCacheFresh(cacheDir: string, ttlHours: number, now: Date): Promise<boolean> {
	try {
		const marker = Bun.file(markerPath(cacheDir));
		if (!await marker.exists()) {
			return false;
		}

		const timestamp = Date.parse((await marker.text()).trim());
		if (Number.isNaN(timestamp)) {
			return false;
		}

		const ageMs = now.getTime() - timestamp;
		return ageMs >= 0 && ageMs < ttlHours * 60 * 60 * 1000;
	} catch (error) {
		warn('Failed to read skill registry cache marker', error);
		return false;
	}
}

function warn(message: string, error?: unknown): void {
	if (error === undefined) {
		console.warn(`[skills] ${message}`);
		return;
	}

	const detail = error instanceof Error ? error.message : String(error);
	console.warn(`[skills] ${message}: ${detail}`);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isSafeSkillName(name: string): boolean {
	return name.length > 0 && !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..';
}

async function fetchSkillsForRegistry(registry: RegistryConfig, fetchImpl: typeof fetch): Promise<NormalizedSkill[]> {
	switch (registry.type) {
		case 'native':
			return fetchNativeRegistry(registry.url, fetchImpl);
		case 'clawhub':
			return fetchClawHubRegistry(registry.url, fetchImpl);
		case 'github-registry':
			return fetchGithubRegistry(registry.url, fetchImpl);
	}
}

async function fetchSkillMarkdown(skill: NormalizedSkill, fetchImpl: typeof fetch): Promise<string | null> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), SKILL_FETCH_TIMEOUT_MS);

	try {
		const response = await fetchImpl(skill.skillUrl, { signal: controller.signal });
		if (!response.ok) {
			throw new Error(`SKILL.md fetch failed with HTTP ${response.status}`);
		}

		return await response.text();
	} catch (error) {
		warn(`Failed to download SKILL.md for ${skill.name} from ${skill.skillUrl}`, error);
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
	const tmp = `${filePath}.tmp`;
	await Bun.write(tmp, content);
	await rename(tmp, filePath);
}

async function writeSkill(cacheDir: string, skill: NormalizedSkill, content: string): Promise<boolean> {
	if (!isSafeSkillName(skill.name)) {
		warn(`Skipping unsafe skill name from registry: ${skill.name}`);
		return false;
	}

	const skillDir = join(cacheDir, skill.name);
	const skillPath = join(skillDir, 'SKILL.md');

	try {
		await mkdir(skillDir, { recursive: true });
		await atomicWrite(skillPath, content);
		return true;
	} catch (error) {
		warn(`Failed to write cached SKILL.md for ${skill.name}`, error);
		return false;
	}
}

async function fetchRegistry(
	registry: RegistryConfig,
	config: SkillsConfig,
	opts: Required<RegistryFetcherOptions>,
): Promise<RegistryFetchResult> {
	if (!registry.enabled) {
		return { type: registry.type, url: registry.url, status: 'disabled' };
	}

	const cacheDir = registryCacheDir(opts.cacheRoot, registry);
	const now = opts.now();

	if (await isCacheFresh(cacheDir, config.cacheTtlHours, now)) {
		return { type: registry.type, url: registry.url, status: 'cached' };
	}

	try {
		await mkdir(cacheDir, { recursive: true });

		const skills = await fetchSkillsForRegistry(registry, opts.fetchImpl);
		if (skills.length === 0) {
			warn(`Registry ${registry.url} returned no skills`);
			return { type: registry.type, url: registry.url, status: 'failed', error: 'Registry returned no skills' };
		}

		let written = 0;
		for (const skill of skills) {
			const content = await fetchSkillMarkdown(skill, opts.fetchImpl);
			if (content === null) {
				continue;
			}

			if (await writeSkill(cacheDir, skill, content)) {
				written += 1;
			}
		}

		await Bun.write(markerPath(cacheDir), now.toISOString());

		return { type: registry.type, url: registry.url, status: 'fetched', skillCount: written };
	} catch (error) {
		warn(`Failed to fetch registry ${registry.url}`, error);
		return { type: registry.type, url: registry.url, status: 'failed', error: errorMessage(error) };
	}
}

export async function fetchRegistries(
	config: SkillsConfig,
	opts: RegistryFetcherOptions = {},
): Promise<RegistryFetchResult[]> {
	const resolvedOpts: Required<RegistryFetcherOptions> = {
		fetchImpl: opts.fetchImpl ?? fetch,
		now: opts.now ?? (() => new Date()),
		cacheRoot: opts.cacheRoot ?? defaultCacheRoot(),
	};

	const results: RegistryFetchResult[] = [];
	for (const registry of config.registries) {
		try {
			results.push(await fetchRegistry(registry, config, resolvedOpts));
		} catch (error) {
			warn(`Unexpected registry fetch failure for ${registry.url}`, error);
			results.push({ type: registry.type, url: registry.url, status: 'failed', error: errorMessage(error) });
		}
	}

	return results;
}
