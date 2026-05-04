/**
 * Tests for tool_search built-in tool.
 *
 * Covers: keyword search, exact-name lookup, category filter, no-match,
 * discoveredTools wiring, empty registry.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { HookRegistry } from '../../hooks/index.ts';
import { ToolRegistry } from '../registry.ts';
import { createToolSearchTool, type ToolSearchParams } from './index.js';
import type { RunContext } from '../../runs/types.js';
import type { ToolDefinition } from '../../types/tools.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockRunContext(): RunContext {
	return {
		runId: 'test-run',
		depth: 0,
		agentType: 'orchestrator',
		title: 'test',
		sessionId: 'test-session',
		projectId: 'test-project',
		signal: new AbortController().signal,
		discoveredTools: new Set<string>(),
	};
}

function makeTool(
	name: string,
	description: string,
	params: Record<string, { type: string; description: string; required?: boolean; default?: unknown }> = {},
): ToolDefinition {
	return {
		name,
		description,
		parameters: params as ToolDefinition['parameters'],
		execute: async () => ({ ok: true as const, data: 'ok' }),
	};
}

function registerFixtureTools(registry: ToolRegistry): void {
	registry.register(makeTool('read', 'Read a file from the filesystem', {
		path: { type: 'string', description: 'File path', required: true },
	}));
	registry.register(makeTool('write', 'Write content to a file', {
		path: { type: 'string', description: 'File path', required: true },
		content: { type: 'string', description: 'Content to write', required: true },
	}));
	registry.register(makeTool('edit', 'Edit a file with string replacements', {
		path: { type: 'string', description: 'File path', required: true },
		oldString: { type: 'string', description: 'Text to replace', required: true },
		newString: { type: 'string', description: 'Replacement text', required: true },
	}));
	registry.register(makeTool('git_status', 'Show the working tree status', {
		repo: { type: 'string', description: 'Repository path', required: false },
	}));
	registry.register(makeTool('git_commit', 'Create a new commit', {
		message: { type: 'string', description: 'Commit message', required: true },
	}));
	registry.register(makeTool('mcp__github__search_repos', 'Search GitHub repositories'));
	registry.register(makeTool('mcp__github__list_issues', 'List GitHub issues for a repo'));
	registry.register(makeTool('mcp__slack__send_message', 'Send a message to a Slack channel', {
		channel: { type: 'string', description: 'Channel name', required: true },
		text: { type: 'string', description: 'Message text', required: true },
	}));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createToolSearchTool', () => {
	it('returns a ToolDefinition with name "tool_search"', () => {
		const registry = new ToolRegistry(new HookRegistry());
		const runContext = createMockRunContext();
		const tool = createToolSearchTool({ registry, runContext });

		expect(tool.name).toBe('tool_search');
		expect(tool.description).toContain('Search for available tools');
	});

	it('has the expected parameters', () => {
		const registry = new ToolRegistry(new HookRegistry());
		const runContext = createMockRunContext();
		const tool = createToolSearchTool({ registry, runContext });

		expect(tool.parameters.query).toBeDefined();
		expect(tool.parameters.names).toBeDefined();
		expect(tool.parameters.category).toBeDefined();
		expect(tool.parameters.limit).toBeDefined();
		expect(tool.parameters.limit.default).toBe(10);
	});
});

// ---------------------------------------------------------------------------
// Keyword search
// ---------------------------------------------------------------------------

describe('tool_search — keyword search', () => {
	let registry: ToolRegistry;
	let runContext: RunContext;

	beforeEach(() => {
		registry = new ToolRegistry(new HookRegistry());
		registerFixtureTools(registry);
		runContext = createMockRunContext();
	});

	async function search(params: ToolSearchParams): Promise<string> {
		const tool = createToolSearchTool({ registry, runContext });
		const result = await tool.execute(params);
		if (!result.ok) throw new Error(result.error.message);
		return result.data;
	}

	it('returns matching built-in tools by keyword', async () => {
		// 'git' matches git_status, git_commit (prefix), and mcp__github__* (substring)
		const output = await search({ query: 'git' });
		expect(output).toContain('git_status');
		expect(output).toContain('git_commit');
		expect(output).toContain('Found 4 tools matching "git"');
		expect(output).toContain('mcp__github__search_repos');
		expect(output).toContain('mcp__github__list_issues');
	});

	it('returns only builtin tools when category filter is applied', async () => {
		const output = await search({ query: 'git', category: 'builtin' });
		expect(output).toContain('git_status');
		expect(output).toContain('git_commit');
		expect(output).toContain('Found 2 tools matching "git"');
		expect(output).not.toContain('mcp__');
	});

	it('returns a single tool when only one matches', async () => {
		const output = await search({ query: 'read' });
		expect(output).toContain('read');
		expect(output).toContain('Found 1 tool matching "read"');
		expect(output).not.toContain('## write'); // 'write' doesn't match 'read'
	});

	it('includes parameter details in output', async () => {
		const output = await search({ query: 'edit' });
		expect(output).toContain('## edit');
		expect(output).toContain('Description:');
		expect(output).toContain('Parameters:');
		expect(output).toContain('path (string, required)');
		expect(output).toContain('oldString (string, required)');
		expect(output).toContain('newString (string, required)');
	});

	it('writes matched tool names to runContext.discoveredTools', async () => {
		await search({ query: 'git' });
		expect(runContext.discoveredTools.has('git_status')).toBe(true);
		expect(runContext.discoveredTools.has('git_commit')).toBe(true);
	});

	it('does not write unmatched tool names to discoveredTools', async () => {
		await search({ query: 'git' });
		expect(runContext.discoveredTools.has('read')).toBe(false);
		expect(runContext.discoveredTools.has('write')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Exact names lookup
// ---------------------------------------------------------------------------

describe('tool_search — exact names lookup', () => {
	let registry: ToolRegistry;
	let runContext: RunContext;

	beforeEach(() => {
		registry = new ToolRegistry(new HookRegistry());
		registerFixtureTools(registry);
		runContext = createMockRunContext();
	});

	async function search(params: ToolSearchParams): Promise<string> {
		const tool = createToolSearchTool({ registry, runContext });
		const result = await tool.execute(params);
		if (!result.ok) throw new Error(result.error.message);
		return result.data;
	}

	it('returns tools by exact name (case-insensitive)', async () => {
		const output = await search({ names: ['read', 'WRITE', 'edit'] });
		expect(output).toContain('## read');
		expect(output).toContain('## write');
		expect(output).toContain('## edit');
		expect(output).toContain('Found 3 tools');
	});

	it('skips names not in the registry', async () => {
		const output = await search({ names: ['read', 'nonexistent', 'write'] });
		expect(output).toContain('## read');
		expect(output).toContain('## write');
		expect(output).toContain('Found 2 tools');
		expect(output).not.toContain('nonexistent');
	});

	it('writes discoveredNames for exact-name matches', async () => {
		await search({ names: ['read', 'write'] });
		expect(runContext.discoveredTools.has('read')).toBe(true);
		expect(runContext.discoveredTools.has('write')).toBe(true);
		expect(runContext.discoveredTools.has('edit')).toBe(false);
	});

	it('returns no-match message when none of the names exist', async () => {
		const output = await search({ names: ['nonexistent', 'also-missing'] });
		expect(output).toContain('No tools found matching your search');
	});

	it('supports names array with MCP tools', async () => {
		const output = await search({ names: ['mcp__slack__send_message'] });
		expect(output).toContain('mcp__slack__send_message');
		expect(runContext.discoveredTools.has('mcp__slack__send_message')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Category filter
// ---------------------------------------------------------------------------

describe('tool_search — category filter', () => {
	let registry: ToolRegistry;
	let runContext: RunContext;

	beforeEach(() => {
		registry = new ToolRegistry(new HookRegistry());
		registerFixtureTools(registry);
		runContext = createMockRunContext();
	});

	async function search(params: ToolSearchParams): Promise<string> {
		const tool = createToolSearchTool({ registry, runContext });
		const result = await tool.execute(params);
		if (!result.ok) throw new Error(result.error.message);
		return result.data;
	}

	it('filters to builtin tools only', async () => {
		const output = await search({ query: 'git', category: 'builtin' });
		expect(output).toContain('git_status');
		expect(output).toContain('git_commit');
		// No MCP tools should leak in
		expect(output).not.toContain('mcp__');
	});

	it('filters to mcp tools only', async () => {
		const output = await search({ query: 'github', category: 'mcp' });
		expect(output).toContain('mcp__github__search_repos');
		expect(output).toContain('mcp__github__list_issues');
		expect(output).not.toContain('git_status');
	});

	it('"all" category imposes no filter', async () => {
		const unrestricted = await search({ query: 'git' });
		const allExplicit = await search({ query: 'git', category: 'all' });
		expect(unrestricted).toBe(allExplicit);
	});

	it('undefined category imposes no filter', async () => {
		const unrestricted = await search({ query: 'git' });
		const undefinedCat = await search({ query: 'git', category: undefined });
		expect(unrestricted).toBe(undefinedCat);
	});

	it('returns no-match when category excludes all query-matched results', async () => {
		// 'edit' matches only builtin tools; with category='mcp' nothing survives
		const output = await search({ query: 'edit', category: 'mcp' });
		expect(output).toContain('No tools found matching your search');
	});

	it('header reflects category when no query/names specified', async () => {
		const output = await search({ category: 'mcp' });
		expect(output).toContain('category "mcp"');
		expect(output).toContain('mcp__github__search_repos');
	});
});

// ---------------------------------------------------------------------------
// No results / help message
// ---------------------------------------------------------------------------

describe('tool_search — no results', () => {
	it('returns a helpful message when nothing matches', async () => {
		const registry = new ToolRegistry(new HookRegistry());
		registerFixtureTools(registry);
		const runContext = createMockRunContext();
		const tool = createToolSearchTool({ registry, runContext });

		const result = await tool.execute({ query: 'xyznonexistent123' });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data).toContain('No tools found matching your search');
		expect(result.data).toContain('builtin, mcp, skill');
	});

	it('returns a message about empty registry', async () => {
		const registry = new ToolRegistry(new HookRegistry());
		// Register nothing
		const runContext = createMockRunContext();
		const tool = createToolSearchTool({ registry, runContext });

		const result = await tool.execute({ query: 'anything' });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data).toBe('No tools are currently registered.');
	});
});

// ---------------------------------------------------------------------------
// Limit
// ---------------------------------------------------------------------------

describe('tool_search — limit', () => {
	it('respects an explicit limit', async () => {
		const registry = new ToolRegistry(new HookRegistry());
		// Register 10 tools
		for (let i = 0; i < 10; i++) {
			registry.register(makeTool(`tool-${i}`, `Tool number ${i}`));
		}
		const runContext = createMockRunContext();
		const tool = createToolSearchTool({ registry, runContext });

		const result = await tool.execute({ limit: 5 });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const count = (result.data.match(/## /g) || []).length;
		expect(count).toBe(5);
	});

	it('defaults to 10 when limit is not specified', async () => {
		const registry = new ToolRegistry(new HookRegistry());
		for (let i = 0; i < 15; i++) {
			registry.register(makeTool(`tool-${i}`, `Tool number ${i}`));
		}
		const runContext = createMockRunContext();
		const tool = createToolSearchTool({ registry, runContext });

		const result = await tool.execute({});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const count = (result.data.match(/## /g) || []).length;
		expect(count).toBe(10);
	});
});

// ---------------------------------------------------------------------------
// DiscoveredTools accumulation
// ---------------------------------------------------------------------------

describe('tool_search — discoveredTools accumulation', () => {
	it('accumulates discovered tools across multiple calls', async () => {
		const registry = new ToolRegistry(new HookRegistry());
		registerFixtureTools(registry);
		const runContext = createMockRunContext();

		const tool = createToolSearchTool({ registry, runContext });

		await tool.execute({ query: 'git' });
		expect(runContext.discoveredTools.has('git_status')).toBe(true);
		expect(runContext.discoveredTools.has('git_commit')).toBe(true);

		// Second call adds more
		await tool.execute({ query: 'github' });
		expect(runContext.discoveredTools.has('git_status')).toBe(true);
		expect(runContext.discoveredTools.has('mcp__github__search_repos')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// MCP tool handling
// ---------------------------------------------------------------------------

describe('tool_search — MCP tools', () => {
	it('discovers MCP tools and includes parameter details', async () => {
		const registry = new ToolRegistry(new HookRegistry());
		registerFixtureTools(registry);
		const runContext = createMockRunContext();
		const tool = createToolSearchTool({ registry, runContext });

		const result = await tool.execute({ query: 'slack' });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data).toContain('mcp__slack__send_message');
		expect(result.data).toContain('channel (string, required)');
		expect(result.data).toContain('text (string, required)');
		expect(runContext.discoveredTools.has('mcp__slack__send_message')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Empty params (no query, no names, no category)
// ---------------------------------------------------------------------------

describe('tool_search — no filters', () => {
	it('returns all tools (subject to default limit) with no params', async () => {
		const registry = new ToolRegistry(new HookRegistry());
		registerFixtureTools(registry);
		const runContext = createMockRunContext();
		const tool = createToolSearchTool({ registry, runContext });

		const result = await tool.execute({});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		// We have 8 fixture tools, all should appear
		expect(result.data).toContain('Found 8 tools');
		expect(result.data).toContain('read');
		expect(result.data).toContain('mcp__github__search_repos');
	});

	it('writes all returned tool names to discoveredTools', async () => {
		const registry = new ToolRegistry(new HookRegistry());
		registerFixtureTools(registry);
		const runContext = createMockRunContext();
		const tool = createToolSearchTool({ registry, runContext });

		await tool.execute({});
		expect(runContext.discoveredTools.size).toBe(8);
		expect(runContext.discoveredTools.has('read')).toBe(true);
		expect(runContext.discoveredTools.has('git_status')).toBe(true);
		expect(runContext.discoveredTools.has('mcp__github__search_repos')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Skill catalog integration
// ---------------------------------------------------------------------------

import type { SkillCatalogEntry } from './index.js';

/** A fake skill catalog for testing — three skills with distinct keywords. */
const fixtureSkillCatalog: SkillCatalogEntry[] = [
	{ name: 'video-marketing', summary: 'Plan and create video marketing scripts and content' },
	{ name: 'p5js', summary: 'Production pipeline for interactive and generative visual art using p5.js' },
	{ name: 'comfyui', summary: 'Generate images, video, and audio with ComfyUI' },
];

function createToolSearchWithSkills(
	registry: ToolRegistry,
	runContext: RunContext,
): ReturnType<typeof createToolSearchTool> {
	return createToolSearchTool({ registry, runContext, skillCatalog: fixtureSkillCatalog });
}

describe('tool_search — skill catalog search', () => {
	let registry: ToolRegistry;
	let runContext: RunContext;

	beforeEach(() => {
		registry = new ToolRegistry(new HookRegistry());
		registerFixtureTools(registry);
		runContext = createMockRunContext();
	});

	async function search(params: ToolSearchParams): Promise<string> {
		const tool = createToolSearchWithSkills(registry, runContext);
		const result = await tool.execute(params);
		if (!result.ok) throw new Error(result.error.message);
		return result.data;
	}

	it('returns matching skills by keyword', async () => {
		const output = await search({ query: 'video' });
		// 'video-marketing' and 'comfyui' both mention 'video'
		expect(output).toContain('video-marketing');
		expect(output).toContain('comfyui');
		// 'p5js' does not mention 'video'
		expect(output).not.toContain('p5js');
	});

	it('filters to only skills with category: "skill"', async () => {
		const output = await search({ category: 'skill' });
		expect(output).toContain('video-marketing');
		expect(output).toContain('p5js');
		expect(output).toContain('comfyui');
		// No tool entries should leak in
		expect(output).not.toContain('## read');
		expect(output).not.toContain('mcp__');
		expect(output).toContain('Found 3 tools in category "skill"');
	});

	it('filters skills by both query and category', async () => {
		const output = await search({ query: 'video', category: 'skill' });
		expect(output).toContain('video-marketing');
		expect(output).toContain('comfyui');
		expect(output).not.toContain('p5js');
		// Tools matching 'video' should be excluded by category filter
		expect(output).not.toContain('mcp__');
	});

	it('includes skill summary in output', async () => {
		const output = await search({ query: 'p5js' });
		expect(output).toContain('## p5js (skill)');
		expect(output).toContain('Summary: Production pipeline for interactive and generative visual art');
	});

	it('includes invocation hint for skills', async () => {
		const output = await search({ query: 'comfyui' });
		expect(output).toContain("Hint: Call skill('comfyui') to load the full content");
	});

	it('does NOT add skill names to discoveredTools', async () => {
		await search({ query: 'video', category: 'skill' });
		expect(runContext.discoveredTools.has('video-marketing')).toBe(false);
		expect(runContext.discoveredTools.has('comfyui')).toBe(false);
		expect(runContext.discoveredTools.has('p5js')).toBe(false);
	});

	it('only adds actual tools (not skills) to discoveredTools in mixed results', async () => {
		// 'edit' matches 'edit' tool AND could match skills in description
		await search({ query: 'content' });
		// Skills matching 'content' should NOT be in discoveredTools
		expect(runContext.discoveredTools.has('video-marketing')).toBe(false);
		// Actual tools should still be added
		expect(runContext.discoveredTools.has('write')).toBe(true);
	});

	it('finds skills by exact name', async () => {
		const output = await search({ names: ['p5js', 'video-marketing'] });
		expect(output).toContain('## p5js (skill)');
		expect(output).toContain('## video-marketing (skill)');
		expect(output).toContain('Found 2 tools');
	});

	it('handles mixed exact names (tools + skills)', async () => {
		const output = await search({ names: ['read', 'p5js'] });
		expect(output).toContain('## read');
		expect(output).toContain('## p5js (skill)');
		expect(output).toContain('Found 2 tools');
		expect(runContext.discoveredTools.has('read')).toBe(true);
		expect(runContext.discoveredTools.has('p5js')).toBe(false);
	});

	it('returns no-match for skill query with wrong category', async () => {
		// 'video' matches skills, but with category='builtin' no skill passes
		const output = await search({ query: 'video', category: 'builtin' });
		expect(output).toContain('No tools found matching your search');
	});

	it('returns skills with other categories in mixed mode (no filter)', async () => {
		const output = await search({ query: 'video' });
		// Should find both skills and any tools matching 'video'
		expect(output).toContain('video-marketing');
		expect(output).toContain('comfyui');
	});

	it('no-match message still lists skill category', async () => {
		const output = await search({ query: 'xyznonexistent123' });
		expect(output).toContain('builtin, mcp, skill');
	});
});

describe('tool_search — skill catalog: empty or absent', () => {
	it('backward compatible — absent skillCatalog produces no skill results', async () => {
		const registry = new ToolRegistry(new HookRegistry());
		registerFixtureTools(registry);
		const runContext = createMockRunContext();
		const tool = createToolSearchTool({ registry, runContext });

		const result = await tool.execute({ category: 'skill' });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data).toContain('No tools found matching your search');
	});

	it('empty skillCatalog produces no skill results', async () => {
		const registry = new ToolRegistry(new HookRegistry());
		registerFixtureTools(registry);
		const runContext = createMockRunContext();
		const tool = createToolSearchTool({ registry, runContext, skillCatalog: [] });

		const result = await tool.execute({ category: 'skill' });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data).toContain('No tools found matching your search');
	});

	it('empty skillCatalog does not affect tool-only search', async () => {
		const registry = new ToolRegistry(new HookRegistry());
		registerFixtureTools(registry);
		const runContext = createMockRunContext();
		const tool = createToolSearchTool({ registry, runContext, skillCatalog: [] });

		const result = await tool.execute({ query: 'git' });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data).toContain('git_status');
		expect(result.data).toContain('git_commit');
		expect(runContext.discoveredTools.has('git_status')).toBe(true);
	});
});
