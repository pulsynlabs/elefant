import { describe, expect, it } from 'bun:test';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { MAX_MCP_DESCRIPTION_LENGTH } from './manager.ts';
import { searchMcpTools } from './search.ts';
import type { ToolWithMeta } from './types.ts';

function tool(name: string, description: string): Tool {
	return {
		name,
		description,
		inputSchema: { type: 'object' },
	};
}

function withMeta(serverId: string, serverName: string, tools: Tool[]): ToolWithMeta[] {
	return tools.map((entry) => ({ serverId, serverName, tool: entry }));
}

describe('searchMcpTools', () => {
	it('returns exact tools by name in select mode', () => {
		const tools = [
			...withMeta('github-id', 'github', [tool('create_issue', 'Create a GitHub issue')]),
			...withMeta('slack-id', 'slack', [tool('post_message', 'Post a Slack message')]),
		];

		expect(searchMcpTools(tools, 'select:post_message,create_issue').map((entry) => entry.tool.name))
			.toEqual(['create_issue', 'post_message']);
	});

	it('returns keyword matches sorted by score', () => {
		const tools = [
			...withMeta('search-id', 'search', [tool('web_search', 'Search web pages')]),
			...withMeta('files-id', 'filesystem', [tool('read_file', 'Read local files')]),
			...withMeta('github-id', 'github', [tool('search_issues', 'Search GitHub issues')]),
		];

		const results = searchMcpTools(tools, 'search github');

		expect(results.map((entry) => entry.tool.name)).toEqual(['search_issues', 'web_search']);
	});

	it('scopes candidates to one server when server filter is provided', () => {
		const tools = [
			...withMeta('github-id', 'github', [tool('search_issues', 'Search GitHub issues')]),
			...withMeta('slack-id', 'slack', [tool('search_messages', 'Search Slack messages')]),
		];

		const results = searchMcpTools(tools, 'search', { server: 'slack' });

		expect(results.map((entry) => entry.serverName)).toEqual(['slack']);
		expect(results.map((entry) => entry.tool.name)).toEqual(['search_messages']);
	});

	it('returns no results for empty queries or no matches', () => {
		const tools = withMeta('files-id', 'filesystem', [tool('read_file', 'Read local files')]);

		expect(searchMcpTools(tools, '')).toEqual([]);
		expect(searchMcpTools(tools, 'postgres database')).toEqual([]);
	});

	it('returns tools with already-truncated descriptions', () => {
		const longDescription = 'a'.repeat(MAX_MCP_DESCRIPTION_LENGTH + 50);
		const tools = withMeta('docs-id', 'docs', [
			tool('search_docs', longDescription.slice(0, MAX_MCP_DESCRIPTION_LENGTH)),
		]);

		const [result] = searchMcpTools(tools, 'docs');

		expect(result?.tool.description).toHaveLength(MAX_MCP_DESCRIPTION_LENGTH);
	});
});
