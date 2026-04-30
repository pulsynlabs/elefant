import { describe, expect, it } from 'bun:test';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { buildMcpManifest } from './manifest.ts';

type TestTool = Tool & { _meta?: Record<string, unknown> };

function tool(name: string, meta?: Record<string, unknown>): Tool {
	const entry: TestTool = {
		name,
		description: `Tool ${name}`,
		inputSchema: { type: 'object' },
	};

	if (meta) {
		entry._meta = meta;
	}

	return entry;
}

describe('buildMcpManifest', () => {
	it('returns empty string when no tools are available', () => {
		expect(buildMcpManifest([])).toBe('');
		expect(buildMcpManifest([{ name: 'empty', tools: [] }])).toBe('');
	});

	it('generates a manifest for one server', () => {
		const manifest = buildMcpManifest([
			{ name: 'filesystem', tools: [tool('list_directory'), tool('read_file')] },
		]);

		expect(manifest).toContain('<mcp_available_tools>');
		expect(manifest).toContain('Server: filesystem (2 tools): list_directory, read_file');
		expect(manifest).toContain('Use mcp_search_tools');
		expect(manifest).toContain('</mcp_available_tools>');
	});

	it('generates lines for multiple servers and summarizes hidden tools', () => {
		const manifest = buildMcpManifest([
			{ name: 'filesystem', tools: Array.from({ length: 10 }, (_, index) => tool(`file_${index}`)) },
			{ name: 'github', tools: [tool('create_issue')] },
		]);

		expect(manifest).toContain('Server: filesystem (10 tools): file_0, file_1, file_2, file_3, file_4, file_5, file_6, file_7, [+2 more]');
		expect(manifest).toContain('Server: github (1 tools): create_issue');
	});

	it('includes search hints from anthropic metadata', () => {
		const manifest = buildMcpManifest([
			{ name: 'docs', tools: [tool('search_docs', { 'anthropic/searchHint': 'documentation lookup' })] },
		]);

		expect(manifest).toContain('search_docs search:"documentation lookup"');
	});

	it('annotates always-load tools', () => {
		const manifest = buildMcpManifest([
			{ name: 'filesystem', tools: [tool('read_file'), tool('write_file')], alwaysLoad: ['read_file'] },
		]);

		expect(manifest).toContain('read_file [always]');
		expect(manifest).toContain('write_file');
	});

	it('caps each server line at 1500 chars', () => {
		const manifest = buildMcpManifest([
			{ name: 'long', tools: Array.from({ length: 8 }, (_, index) => tool(`${'very_long_tool_name_'.repeat(20)}${index}`)) },
		]);
		const serverLine = manifest.split('\n').find((line) => line.startsWith('Server: long'));

		expect(serverLine).toBeDefined();
		expect(serverLine!.length).toBeLessThanOrEqual(1500);
	});
});
