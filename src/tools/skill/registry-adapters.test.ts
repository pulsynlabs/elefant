import { describe, test, expect } from 'bun:test';
import {
	fetchClawHubRegistry,
	fetchGithubRegistry,
	fetchNativeRegistry,
} from './registry-adapters.js';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' },
		...init,
	});
}

function fetchJson(body: unknown): typeof fetch {
	return (async () => jsonResponse(body)) as typeof fetch;
}

describe('fetchNativeRegistry', () => {
	test('normalizes a valid native index.json registry', async () => {
		const fetchImpl = fetchJson({
			skills: [{ name: 'p5js', files: ['SKILL.md', 'README.md'] }],
		});

		const result = await fetchNativeRegistry('https://example.com/skills', fetchImpl);

		expect(result).toEqual([
			{ name: 'p5js', skillUrl: 'https://example.com/skills/p5js/SKILL.md' },
		]);
	});

	test('uses an explicit .json URL directly', async () => {
		const requestedUrls: string[] = [];
		const fetchImpl = (async (input) => {
			requestedUrls.push(String(input));
			return jsonResponse({ skills: [{ name: 'design', files: ['SKILL.md'] }] });
		}) as typeof fetch;

		const result = await fetchNativeRegistry('https://example.com/catalog/index.json', fetchImpl);

		expect(requestedUrls).toEqual(['https://example.com/catalog/index.json']);
		expect(result).toEqual([
			{ name: 'design', skillUrl: 'https://example.com/catalog/design/SKILL.md' },
		]);
	});

	test('returns an empty array for malformed native JSON', async () => {
		const result = await fetchNativeRegistry('https://example.com/skills', fetchJson({ invalid: true }));

		expect(result).toEqual([]);
	});

	test('returns an empty array when native fetch rejects', async () => {
		const fetchImpl = (async () => {
			throw new Error('network down');
		}) as typeof fetch;

		const result = await fetchNativeRegistry('https://example.com/skills', fetchImpl);

		expect(result).toEqual([]);
	});

	test('returns an empty array when native fetch times out', async () => {
		const originalSetTimeout = globalThis.setTimeout;
		const fetchImpl = ((_input, init) => new Promise<Response>((_resolve, reject) => {
			init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
		})) as typeof fetch;

		try {
			globalThis.setTimeout = ((handler) => {
				if (typeof handler === 'function') {
					queueMicrotask(() => handler());
				}

				return 0 as ReturnType<typeof setTimeout>;
			}) as typeof setTimeout;

			expect(await fetchNativeRegistry('https://example.com/skills', fetchImpl)).toEqual([]);
		} finally {
			globalThis.setTimeout = originalSetTimeout;
		}
	});
});

describe('fetchClawHubRegistry', () => {
	test('normalizes a single ClawHub page', async () => {
		const result = await fetchClawHubRegistry('https://clawhub.com', fetchJson({
			items: [{ name: 'comfyui' }],
			nextCursor: null,
		}));

		expect(result).toEqual([
			{ name: 'comfyui', skillUrl: 'https://clawhub.com/skills/comfyui/SKILL.md' },
		]);
	});

	test('uses download_url when ClawHub provides one', async () => {
		const result = await fetchClawHubRegistry('https://clawhub.com', fetchJson({
			items: [{ name: 'custom', download_url: 'https://cdn.example.com/custom/SKILL.md' }],
			nextCursor: null,
		}));

		expect(result).toEqual([
			{ name: 'custom', skillUrl: 'https://cdn.example.com/custom/SKILL.md' },
		]);
	});

	test('fetches multiple ClawHub pages using the cursor', async () => {
		const requestedUrls: string[] = [];
		const fetchImpl = (async (input) => {
			const url = String(input);
			requestedUrls.push(url);

			if (url.includes('cursor=abc')) {
				return jsonResponse({ items: [{ name: 'second' }], nextCursor: null });
			}

			return jsonResponse({ items: [{ name: 'first' }], nextCursor: 'abc' });
		}) as typeof fetch;

		const result = await fetchClawHubRegistry('https://clawhub.com', fetchImpl);

		expect(requestedUrls).toEqual([
			'https://clawhub.com/api/v1/skills',
			'https://clawhub.com/api/v1/skills?cursor=abc',
		]);
		expect(result).toEqual([
			{ name: 'first', skillUrl: 'https://clawhub.com/skills/first/SKILL.md' },
			{ name: 'second', skillUrl: 'https://clawhub.com/skills/second/SKILL.md' },
		]);
	});

	test('returns an empty array when ClawHub fetch rejects', async () => {
		const fetchImpl = (async () => {
			throw new Error('network down');
		}) as typeof fetch;

		const result = await fetchClawHubRegistry('https://clawhub.com', fetchImpl);

		expect(result).toEqual([]);
	});

	test('caps ClawHub pagination at 500 normalized items', async () => {
		let calls = 0;
		const fetchImpl = (async () => {
			calls += 1;
			return jsonResponse({
				items: Array.from({ length: 100 }, (_, index) => ({ name: `skill-${calls}-${index}` })),
				nextCursor: `cursor-${calls}`,
			});
		}) as typeof fetch;

		const result = await fetchClawHubRegistry('https://clawhub.com', fetchImpl);

		expect(result).toHaveLength(500);
		expect(calls).toBe(5);
		expect(result.at(-1)).toEqual({
			name: 'skill-5-99',
			skillUrl: 'https://clawhub.com/skills/skill-5-99/SKILL.md',
		});
	});
});

describe('fetchGithubRegistry', () => {
	test('normalizes a valid GitHub registry', async () => {
		const result = await fetchGithubRegistry('https://raw.githubusercontent.com/user/repo/main/registry.json', fetchJson({
			skills: [{
				name: 'design',
				source: { repo: 'user/repo', path: 'skills/design', branch: 'main' },
			}],
		}));

		expect(result).toEqual([
			{
				name: 'design',
				skillUrl: 'https://raw.githubusercontent.com/user/repo/main/skills/design/SKILL.md',
			},
		]);
	});

	test('defaults GitHub registry branch to main', async () => {
		const result = await fetchGithubRegistry('https://raw.githubusercontent.com/user/repo/main/registry.json', fetchJson({
			skills: [{ name: 'minimal', source: { repo: 'user/repo', path: 'skills/minimal' } }],
		}));

		expect(result).toEqual([
			{
				name: 'minimal',
				skillUrl: 'https://raw.githubusercontent.com/user/repo/main/skills/minimal/SKILL.md',
			},
		]);
	});

	test('returns an empty array for malformed GitHub registry JSON', async () => {
		const result = await fetchGithubRegistry('https://raw.githubusercontent.com/user/repo/main/registry.json', fetchJson({ invalid: true }));

		expect(result).toEqual([]);
	});
});
