import { z } from "zod";

const FETCH_TIMEOUT_MS = 10_000;
const CLAWHUB_ITEM_CAP = 500;

const NativeRegistrySchema = z.object({
	skills: z.array(z.object({
		name: z.string(),
		files: z.array(z.string()),
	})),
});

const ClawHubRegistrySchema = z.object({
	items: z.array(z.object({
		name: z.string(),
		slug: z.string().optional(),
		download_url: z.string().optional(),
	}).passthrough()),
	nextCursor: z.string().nullable().optional(),
});

const GithubRegistrySchema = z.object({
	skills: z.array(z.object({
		name: z.string(),
		source: z.object({
			repo: z.string(),
			path: z.string(),
			branch: z.string().optional(),
		}),
	})),
});

export interface NormalizedSkill {
	name: string;
	skillUrl: string;
}

async function fetchJsonWithTimeout(url: string, fetchImpl: typeof fetch): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const response = await fetchImpl(url, { signal: controller.signal });
		if (!response.ok) {
			throw new Error(`Registry fetch failed with HTTP ${response.status}`);
		}

		return await response.json();
	} finally {
		clearTimeout(timeout);
	}
}

function warnRegistryFailure(kind: string, url: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	console.warn(`[skills] Failed to fetch ${kind} registry from ${url}: ${message}`);
}

function trimTrailingSlash(url: string): string {
	return url.replace(/\/+$/, "");
}

function nativeIndexUrl(url: string): string {
	return url.endsWith(".json") ? url : `${trimTrailingSlash(url)}/index.json`;
}

function nativeBaseUrl(indexUrl: string): string {
	if (indexUrl.endsWith("/index.json")) {
		return indexUrl.slice(0, -"/index.json".length);
	}

	return indexUrl.replace(/\/[^/]*\.json$/, "");
}

function joinUrl(...parts: string[]): string {
	const [first = "", ...rest] = parts;
	return [trimTrailingSlash(first), ...rest.map((part) => part.replace(/^\/+|\/+$/g, ""))].join("/");
}

export async function fetchNativeRegistry(url: string, fetchImpl: typeof fetch = fetch): Promise<NormalizedSkill[]> {
	const indexUrl = nativeIndexUrl(url);

	try {
		const json = await fetchJsonWithTimeout(indexUrl, fetchImpl);
		const registry = NativeRegistrySchema.parse(json);
		const baseUrl = nativeBaseUrl(indexUrl);

		return registry.skills
			.filter((skill) => skill.files.some((file) => file.split("/").at(-1) === "SKILL.md"))
			.map((skill) => ({
				name: skill.name,
				skillUrl: joinUrl(baseUrl, skill.name, "SKILL.md"),
			}));
	} catch (error) {
		warnRegistryFailure("native", indexUrl, error);
		return [];
	}
}

export async function fetchClawHubRegistry(url: string, fetchImpl: typeof fetch = fetch): Promise<NormalizedSkill[]> {
	const baseUrl = trimTrailingSlash(url);
	const normalized: NormalizedSkill[] = [];
	let cursor: string | null | undefined;
	const seenCursors = new Set<string>();

	try {
		for (let page = 0; normalized.length < CLAWHUB_ITEM_CAP && page < CLAWHUB_ITEM_CAP; page += 1) {
			const pageUrl = new URL(`${baseUrl}/api/v1/skills`);
			if (cursor) {
				pageUrl.searchParams.set("cursor", cursor);
			}

			const json = await fetchJsonWithTimeout(pageUrl.toString(), fetchImpl);
			const pageData = ClawHubRegistrySchema.parse(json);
			const remaining = CLAWHUB_ITEM_CAP - normalized.length;

			normalized.push(...pageData.items.slice(0, remaining).map((item) => ({
				name: item.name,
				skillUrl: item.download_url ?? joinUrl(baseUrl, "skills", item.name, "SKILL.md"),
			})));

			cursor = pageData.nextCursor;
			if (!cursor || seenCursors.has(cursor)) {
				break;
			}

			seenCursors.add(cursor);
		}

		return normalized;
	} catch (error) {
		warnRegistryFailure("ClawHub", baseUrl, error);
		return [];
	}
}

export async function fetchGithubRegistry(url: string, fetchImpl: typeof fetch = fetch): Promise<NormalizedSkill[]> {
	try {
		const json = await fetchJsonWithTimeout(url, fetchImpl);
		const registry = GithubRegistrySchema.parse(json);

		return registry.skills.map((skill) => {
			const branch = skill.source.branch ?? "main";
			return {
				name: skill.name,
				skillUrl: joinUrl("https://raw.githubusercontent.com", skill.source.repo, branch, skill.source.path, "SKILL.md"),
			};
		});
	} catch (error) {
		warnRegistryFailure("GitHub", url, error);
		return [];
	}
}
