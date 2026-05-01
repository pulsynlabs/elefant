import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configSchema, type RegistryConfig, type SkillsConfig } from '../../config/index.js';
import { fetchRegistries } from './registry-fetcher.js';
import { listSkills } from './resolver.js';

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

function textResponse(body: string): Response {
	return new Response(body, {
		status: 200,
		headers: { 'content-type': 'text/markdown' },
	});
}

function skillsConfig(registries: RegistryConfig[], cacheTtlHours = 24): SkillsConfig {
	return { registries, cacheTtlHours };
}

function createTempCacheRoot(): string {
	return mkdtempSync(join(tmpdir(), 'elefant-registry-integration-'));
}

describe('registry fetcher integration', () => {
	let cacheRoots: string[] = [];

	afterEach(() => {
		for (const cacheRoot of cacheRoots) {
			rmSync(cacheRoot, { recursive: true, force: true });
		}
		cacheRoots = [];
	});

	test('fetches a native registry, writes cache, and listSkills returns the skill', async () => {
		const cacheRoot = createTempCacheRoot();
		cacheRoots.push(cacheRoot);
		const config = skillsConfig([
			{ type: 'native', url: 'https://registry.example.com', enabled: true },
		]);
		const requestedUrls: string[] = [];
		const fetchImpl = (async (input) => {
			const url = String(input);
			requestedUrls.push(url);

			if (url === 'https://registry.example.com/index.json') {
				return jsonResponse({ skills: [{ name: 'native-skill', files: ['SKILL.md'] }] });
			}

			if (url === 'https://registry.example.com/native-skill/SKILL.md') {
				return textResponse('# Native Skill\n\ndescription: Native skill');
			}

			return new Response('not found', { status: 404 });
		}) as unknown as typeof fetch;

		const results = await fetchRegistries(config, {
			fetchImpl,
			now: () => new Date('2026-05-01T12:00:00.000Z'),
			cacheRoot,
		});
		const skills = await listSkills({ cacheRoot, cwd: cacheRoot, home: cacheRoot });

		expect(results).toEqual([
			{ type: 'native', url: 'https://registry.example.com', status: 'fetched', skillCount: 1 },
		]);
		expect(requestedUrls).toEqual([
			'https://registry.example.com/index.json',
			'https://registry.example.com/native-skill/SKILL.md',
		]);
		expect(skills).toContainEqual(expect.objectContaining({
			name: 'native-skill',
			source: 'registry',
			description: '# Native Skill',
		}));
	});

	test('fetches a ClawHub registry, writes cache, and listSkills returns the skill', async () => {
		const cacheRoot = createTempCacheRoot();
		cacheRoots.push(cacheRoot);
		const config = skillsConfig([
			{ type: 'clawhub', url: 'https://clawhub.com', enabled: true },
		]);
		const fetchImpl = (async (input) => {
			const url = String(input);

			if (url === 'https://clawhub.com/api/v1/skills') {
				return jsonResponse({ items: [{ name: 'claw-skill' }], nextCursor: null });
			}

			if (url === 'https://clawhub.com/skills/claw-skill/SKILL.md') {
				return textResponse('# Claw Skill\n\nClawHub registry skill');
			}

			return new Response('not found', { status: 404 });
		}) as unknown as typeof fetch;

		const results = await fetchRegistries(config, {
			fetchImpl,
			now: () => new Date('2026-05-01T12:00:00.000Z'),
			cacheRoot,
		});
		const skills = await listSkills({ cacheRoot, cwd: cacheRoot, home: cacheRoot });

		expect(results).toEqual([
			{ type: 'clawhub', url: 'https://clawhub.com', status: 'fetched', skillCount: 1 },
		]);
		expect(skills).toContainEqual(expect.objectContaining({
			name: 'claw-skill',
			source: 'registry',
			description: '# Claw Skill',
		}));
	});

	test('fetches a GitHub registry, writes cache, and listSkills returns the skill', async () => {
		const cacheRoot = createTempCacheRoot();
		cacheRoots.push(cacheRoot);
		const registryUrl = 'https://raw.githubusercontent.com/example/registry/main/registry.json';
		const config = skillsConfig([
			{ type: 'github-registry', url: registryUrl, enabled: true },
		]);
		const fetchImpl = (async (input) => {
			const url = String(input);

			if (url === registryUrl) {
				return jsonResponse({
					skills: [{ name: 'gh-skill', source: { repo: 'user/repo', path: 'skills/gh-skill' } }],
				});
			}

			if (url === 'https://raw.githubusercontent.com/user/repo/main/skills/gh-skill/SKILL.md') {
				return textResponse('# GH Skill\n\nGitHub registry skill');
			}

			return new Response('not found', { status: 404 });
		}) as unknown as typeof fetch;

		const results = await fetchRegistries(config, {
			fetchImpl,
			now: () => new Date('2026-05-01T12:00:00.000Z'),
			cacheRoot,
		});
		const skills = await listSkills({ cacheRoot, cwd: cacheRoot, home: cacheRoot });

		expect(results).toEqual([
			{ type: 'github-registry', url: registryUrl, status: 'fetched', skillCount: 1 },
		]);
		expect(skills).toContainEqual(expect.objectContaining({
			name: 'gh-skill',
			source: 'registry',
			description: '# GH Skill',
		}));
	});

	test('default config fetches both bundled registries into the cache', async () => {
		const cacheRoot = createTempCacheRoot();
		cacheRoots.push(cacheRoot);
		const defaultConfig = configSchema.parse({});
		const fetchImpl = (async (input) => {
			const url = String(input);

			if (url === 'https://clawhub.com/api/v1/skills') {
				return jsonResponse({ items: [{ name: 'default-claw-skill' }], nextCursor: null });
			}

			if (url === 'https://clawhub.com/skills/default-claw-skill/SKILL.md') {
				return textResponse('# Default Claw Skill\n\nBundled ClawHub skill');
			}

			if (url === 'https://raw.githubusercontent.com/majiayu000/claude-skill-registry-core/main/registry.json') {
				return jsonResponse({
					skills: [{ name: 'default-gh-skill', source: { repo: 'user/repo', path: 'skills/default-gh-skill' } }],
				});
			}

			if (url === 'https://raw.githubusercontent.com/user/repo/main/skills/default-gh-skill/SKILL.md') {
				return textResponse('# Default GH Skill\n\nBundled GitHub skill');
			}

			return new Response('not found', { status: 404 });
		}) as unknown as typeof fetch;

		const results = await fetchRegistries(defaultConfig.skills, {
			fetchImpl,
			now: () => new Date('2026-05-01T12:00:00.000Z'),
			cacheRoot,
		});
		const skills = await listSkills({ cacheRoot, cwd: cacheRoot, home: cacheRoot });

		expect(results).toEqual([
			{ type: 'clawhub', url: 'https://clawhub.com', status: 'fetched', skillCount: 1 },
			{
				type: 'github-registry',
				url: 'https://raw.githubusercontent.com/majiayu000/claude-skill-registry-core/main/registry.json',
				status: 'fetched',
				skillCount: 1,
			},
		]);
		expect(skills).toContainEqual(expect.objectContaining({ name: 'default-claw-skill', source: 'registry' }));
		expect(skills).toContainEqual(expect.objectContaining({ name: 'default-gh-skill', source: 'registry' }));
	});
});
