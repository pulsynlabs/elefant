import type { ToolWithMeta } from './types.ts';

export function searchMcpTools(
	tools: ToolWithMeta[],
	query: string,
	options: { server?: string; maxResults?: number } = {},
): ToolWithMeta[] {
	const maxResults = options.maxResults ?? 5;
	const candidates = options.server
		? tools.filter((entry) => entry.serverName === options.server || entry.serverId === options.server)
		: tools;
	const trimmedQuery = query.trim();

	if (trimmedQuery.length === 0) {
		return [];
	}

	if (trimmedQuery.toLowerCase().startsWith('select:')) {
		const names = trimmedQuery
			.slice('select:'.length)
			.split(',')
			.map((name) => name.trim())
			.filter(Boolean);

		return candidates
			.filter((entry) => names.includes(entry.tool.name))
			.slice(0, maxResults);
	}

	const words = trimmedQuery.toLowerCase().split(/\s+/).filter(Boolean);
	const scored = candidates
		.map((entry) => {
			const haystack = `${entry.tool.name} ${entry.tool.description ?? ''} ${entry.serverName}`.toLowerCase();
			const score = words.filter((word) => haystack.includes(word)).length;
			return { entry, score };
		})
		.filter(({ score }) => score > 0)
		.sort((a, b) => b.score - a.score);

	return scored.slice(0, maxResults).map(({ entry }) => entry);
}
