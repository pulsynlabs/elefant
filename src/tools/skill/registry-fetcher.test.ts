import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RegistryConfig, SkillsConfig } from '../../config/index.js';
import { fetchRegistries } from './registry-fetcher.js';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' },
		...init,
	});
}

function textResponse(body: string, init?: ResponseInit): Response {
	return new Response(body, {
		status: 200,
		headers: { 'content-type': 'text/markdown' },
		...init,
	});
}

function skillsConfig(registries: RegistryConfig[], cacheTtlHours = 24): SkillsConfig {
	return { registries, cacheTtlHours };
}

function cacheDir(cacheRoot: string, registry: RegistryConfig): string {
	const hash = createHash('sha256').update(registry.url).digest('hex').slice(0, 12);
	return join(cacheRoot, `${registry.type}-${hash}`);
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

describe('fetchRegistries', () => {
	let cacheRoot: string;

	beforeEach(async () => {
		cacheRoot = await mkdtemp();
	});

	afterEach(async () => {
		await rm(cacheRoot, { recursive: true, force: true });
	});

	test('successfully fetches a native registry and writes SKILL.md plus marker', async () => {
		const registry: RegistryConfig = { type: 'native', url: 'https://example.com/skills', enabled: true };
		const requestedUrls: string[] = [];
		const fetchImpl = (async (input) => {
			const url = String(input);
			requestedUrls.push(url);

			if (url === 'https://example.com/skills/index.json') {
				return jsonResponse({ skills: [{ name: 'p5js', files: ['SKILL.md'] }] });
			}

			if (url === 'https://example.com/skills/p5js/SKILL.md') {
				return textResponse('# P5.js Skill');
			}

			return new Response('not found', { status: 404 });
		}) as unknown as typeof fetch;

		const result = await fetchRegistries(skillsConfig([registry]), {
			fetchImpl,
			now: () => new Date('2026-05-01T12:00:00.000Z'),
			cacheRoot,
		});

		const dir = cacheDir(cacheRoot, registry);
		expect(result).toEqual([{ type: 'native', url: registry.url, status: 'fetched', skillCount: 1 }]);
		expect(requestedUrls).toEqual([
			'https://example.com/skills/index.json',
			'https://example.com/skills/p5js/SKILL.md',
		]);
		expect(await readFile(join(dir, 'p5js', 'SKILL.md'), 'utf8')).toBe('# P5.js Skill');
		expect(await readFile(join(dir, '.last-fetched'), 'utf8')).toBe('2026-05-01T12:00:00.000Z');
	});

	test('uses fresh cache without calling fetch', async () => {
		const registry: RegistryConfig = { type: 'native', url: 'https://example.com/skills', enabled: true };
		const dir = cacheDir(cacheRoot, registry);
		await mkdir(dir, { recursive: true });
		await Bun.write(join(dir, '.last-fetched'), '2026-05-01T11:00:00.000Z');
		let calls = 0;
		const fetchImpl = (async () => {
			calls += 1;
			return jsonResponse({ skills: [] });
		}) as unknown as typeof fetch;

		const result = await fetchRegistries(skillsConfig([registry], 24), {
			fetchImpl,
			now: () => new Date('2026-05-01T12:00:00.000Z'),
			cacheRoot,
		});

		expect(calls).toBe(0);
		expect(result).toEqual([{ type: 'native', url: registry.url, status: 'cached' }]);
	});

	test('refetches when cache marker is older than TTL', async () => {
		const registry: RegistryConfig = { type: 'native', url: 'https://example.com/skills', enabled: true };
		const dir = cacheDir(cacheRoot, registry);
		await mkdir(dir, { recursive: true });
		await Bun.write(join(dir, '.last-fetched'), '2026-04-30T11:00:00.000Z');
		let calls = 0;
		const fetchImpl = (async (input) => {
			calls += 1;
			const url = String(input);

			if (url.endsWith('/index.json')) {
				return jsonResponse({ skills: [{ name: 'fresh', files: ['SKILL.md'] }] });
			}

			return textResponse('Fresh content');
		}) as unknown as typeof fetch;

		const result = await fetchRegistries(skillsConfig([registry], 24), {
			fetchImpl,
			now: () => new Date('2026-05-01T12:00:00.000Z'),
			cacheRoot,
		});

		expect(calls).toBe(2);
		expect(result[0]).toEqual({ type: 'native', url: registry.url, status: 'fetched', skillCount: 1 });
		expect(await readFile(join(dir, '.last-fetched'), 'utf8')).toBe('2026-05-01T12:00:00.000Z');
		expect(await readFile(join(dir, 'fresh', 'SKILL.md'), 'utf8')).toBe('Fresh content');
	});

	test('returns disabled for disabled registry without calling fetch', async () => {
		const registry: RegistryConfig = { type: 'clawhub', url: 'https://clawhub.com', enabled: false };
		let calls = 0;
		const fetchImpl = (async () => {
			calls += 1;
			return jsonResponse({ items: [] });
		}) as unknown as typeof fetch;

		const result = await fetchRegistries(skillsConfig([registry]), { fetchImpl, cacheRoot });

		expect(calls).toBe(0);
		expect(result).toEqual([{ type: 'clawhub', url: registry.url, status: 'disabled' }]);
	});

	test('marks registry failed when adapter returns an empty list', async () => {
		const registry: RegistryConfig = { type: 'native', url: 'https://example.com/skills', enabled: true };
		const fetchImpl = (async () => new Response('server down', { status: 500 })) as unknown as typeof fetch;

		const result = await fetchRegistries(skillsConfig([registry]), { fetchImpl, cacheRoot });

		expect(result).toEqual([{ type: 'native', url: registry.url, status: 'failed', error: 'Registry returned no skills' }]);
		expect(await exists(join(cacheDir(cacheRoot, registry), 'p5js', 'SKILL.md'))).toBe(false);
	});

	test('skips failed individual SKILL.md downloads and continues writing other skills', async () => {
		const registry: RegistryConfig = { type: 'native', url: 'https://example.com/skills', enabled: true };
		const fetchImpl = (async (input) => {
			const url = String(input);

			if (url === 'https://example.com/skills/index.json') {
				return jsonResponse({
					skills: [
						{ name: 'good-skill', files: ['SKILL.md'] },
						{ name: 'bad-skill', files: ['SKILL.md'] },
					],
				});
			}

			if (url === 'https://example.com/skills/good-skill/SKILL.md') {
				return textResponse('Good skill');
			}

			return new Response('missing', { status: 404 });
		}) as unknown as typeof fetch;

		const result = await fetchRegistries(skillsConfig([registry]), { fetchImpl, cacheRoot });
		const dir = cacheDir(cacheRoot, registry);

		expect(result).toEqual([{ type: 'native', url: registry.url, status: 'fetched', skillCount: 1 }]);
		expect(await readFile(join(dir, 'good-skill', 'SKILL.md'), 'utf8')).toBe('Good skill');
		expect(await exists(join(dir, 'bad-skill', 'SKILL.md'))).toBe(false);
		expect(await exists(join(dir, '.last-fetched'))).toBe(true);
	});
});

async function mkdtemp(): Promise<string> {
	return await import('node:fs/promises').then((fs) => fs.mkdtemp(join(tmpdir(), 'elefant-registry-fetcher-')));
}
