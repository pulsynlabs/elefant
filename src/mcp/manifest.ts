import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const MAX_SERVER_LINE_LENGTH = 1500;
const MAX_VISIBLE_TOOLS = 8;

type ToolWithAnthropicMeta = Tool & {
	_meta?: Record<string, unknown>;
};

function getSearchHint(tool: Tool): string | undefined {
	const meta = (tool as ToolWithAnthropicMeta)._meta;
	const hint = meta?.['anthropic/searchHint'];
	return typeof hint === 'string' && hint.trim().length > 0 ? hint.trim() : undefined;
}

function formatToolName(tool: Tool, alwaysLoad: Set<string>): string {
	const tags: string[] = [];
	if (alwaysLoad.has(tool.name)) {
		tags.push('[always]');
	}

	const hint = getSearchHint(tool);
	if (hint) {
		tags.push(`search:${JSON.stringify(hint)}`);
	}

	return tags.length > 0 ? `${tool.name} ${tags.join(' ')}` : tool.name;
}

function capServerLine(line: string): string {
	if (line.length <= MAX_SERVER_LINE_LENGTH) {
		return line;
	}

	return `${line.slice(0, MAX_SERVER_LINE_LENGTH - 1)}…`;
}

/**
 * Build a compact <mcp_available_tools> block for the system prompt.
 * When selective loading is active, this replaces injecting all full schemas.
 * Format mirrors Claude Code's available-deferred-tools block.
 */
export function buildMcpManifest(
	servers: Array<{ name: string; tools: Tool[]; alwaysLoad?: string[] }>,
): string {
	const serversWithTools = servers.filter((server) => server.tools.length > 0);
	if (serversWithTools.length === 0) {
		return '';
	}

	const lines = serversWithTools.map((server) => {
		const alwaysLoad = new Set(server.alwaysLoad ?? []);
		const visibleTools = server.tools.slice(0, MAX_VISIBLE_TOOLS).map((tool) => formatToolName(tool, alwaysLoad));
		const remainingCount = Math.max(0, server.tools.length - MAX_VISIBLE_TOOLS);
		const suffix = remainingCount > 0 ? `, [+${remainingCount} more]` : '';
		return capServerLine(`Server: ${server.name} (${server.tools.length} tools): ${visibleTools.join(', ')}${suffix}`);
	});

	return [
		'<mcp_available_tools>',
		...lines,
		'Use mcp_search_tools to load tool schemas by keyword or name (e.g., select:list_directory,read_file)',
		'</mcp_available_tools>',
	].join('\n');
}
