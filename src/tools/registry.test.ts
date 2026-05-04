import { describe, expect, it } from 'bun:test'

import { HookRegistry } from '../hooks/index.ts'
import type { ToolDefinition } from '../types/tools.ts'
import { createToolRegistry, createToolRegistryForRun, filterToolsForAgent, MAX_TOOL_OUTPUT_CHARS, ToolRegistry } from './registry.ts'

describe('ToolRegistry', () => {
	it('registers all 25 tools including research_* and tool_search', () => {
		const registry = createToolRegistry(new HookRegistry())
		const names = registry.getAll().map((tool) => tool.name).sort()

			expect(names).toEqual([
			'apply_patch',
			'bash',
			'edit',
			'glob',
			'grep',
			'lsp',
			'lsp_diagnostics',
			'question',
			'read',
			'reference',
			'research_grep',
			'research_index',
			'research_read',
			'research_search',
			'research_write',
			'skill',
			'slider',
			'todoread',
			'todowrite',
			'tool_list',
			'tool_search',
			'visualize',
			'webfetch',
			'websearch',
			'write',
		])
		expect(names.length).toBe(25)
	})

	it('execute() calls the matching tool', async () => {
		const registry = new ToolRegistry(new HookRegistry())
		const calls: unknown[] = []
		const testTool: ToolDefinition<Record<string, unknown>, string> = {
			name: 'test-tool',
			description: 'Test tool',
			parameters: {},
			execute: async (args) => {
				calls.push(args)
				return { ok: true, data: 'tool ok' }
			},
		}

		registry.register(testTool)

		const result = await registry.execute('test-tool', { value: 123 })
		expect(result.ok).toBe(true)
		expect(calls).toEqual([{ value: 123 }])
		if (result.ok) {
			expect(result.data).toBe('tool ok')
		}
	})

	it('validation rejects missing required fields before executing and emits tool:after', async () => {
		const hooks = new HookRegistry()
		const registry = new ToolRegistry(hooks)
		const calls: unknown[] = []
		const afterResults: Array<{ isError: boolean; content: string }> = []

		hooks.register('tool:after', async (context) => {
			afterResults.push({ isError: context.result.isError, content: context.result.content })
		})

		registry.register({
			name: 'requires-name',
			description: 'Requires a name',
			parameters: {
				name: { type: 'string', description: 'Name', required: true },
			},
			execute: async (args) => {
				calls.push(args)
				return { ok: true, data: 'should not run' }
			},
		})

		const result = await registry.execute('requires-name', {})

		expect(result.ok).toBe(false)
		expect(calls).toEqual([])
		expect(afterResults).toHaveLength(1)
		expect(afterResults[0]?.isError).toBe(true)
		expect(afterResults[0]?.content).toContain('rewrite')
		if (!result.ok) {
			expect(result.error.code).toBe('VALIDATION_ERROR')
			expect(result.error.message).toContain('missing required field "name"')
			expect(result.error.message).toContain('rewrite')
		}
	})

	it('validation rejects wrong primitive types', async () => {
		const registry = new ToolRegistry(new HookRegistry())
		const calls: unknown[] = []

		registry.register({
			name: 'string-only',
			description: 'Requires a string',
			parameters: {
				value: { type: 'string', description: 'Value', required: true },
			},
			execute: async (args) => {
				calls.push(args)
				return { ok: true, data: 'should not run' }
			},
		})

		const result = await registry.execute('string-only', { value: 123 })

		expect(result.ok).toBe(false)
		expect(calls).toEqual([])
		if (!result.ok) {
			expect(result.error.code).toBe('VALIDATION_ERROR')
			expect(result.error.message).toContain('expected string, got number')
			expect(result.error.message).toContain('rewrite')
		}
	})

	it('validation applies defaults without mutating the caller args', async () => {
		const registry = new ToolRegistry(new HookRegistry())
		const calls: unknown[] = []
		const rawArgs: Record<string, unknown> = {}

		registry.register({
			name: 'defaulted-tool',
			description: 'Receives defaults',
			parameters: {
				limit: { type: 'number', description: 'Limit', default: 10 },
			},
			execute: async (args) => {
				calls.push(args)
				return { ok: true, data: 'default ok' }
			},
		})

		const result = await registry.execute('defaulted-tool', rawArgs)

		expect(result.ok).toBe(true)
		expect(calls).toEqual([{ limit: 10 }])
		expect(rawArgs).toEqual({})
	})

	it('validation rejects args that are not objects', async () => {
		const registry = new ToolRegistry(new HookRegistry())
		const calls: unknown[] = []

		registry.register({
			name: 'object-args-only',
			description: 'Requires object args',
			parameters: {},
			execute: async (args) => {
				calls.push(args)
				return { ok: true, data: 'should not run' }
			},
		})

		for (const args of [null, [], 'bad args']) {
			const result = await registry.execute('object-args-only', args)
			expect(result.ok).toBe(false)
			if (!result.ok) {
				expect(result.error.code).toBe('VALIDATION_ERROR')
				expect(result.error.message).toContain('expected an object')
				expect(result.error.message).toContain('rewrite')
			}
		}

		expect(calls).toEqual([])
	})

	it('returns typed error for unknown tools', async () => {
		const registry = new ToolRegistry(new HookRegistry())
		const result = await registry.execute('missing-tool', {})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe('TOOL_NOT_FOUND')
			expect(result.error.message).toContain('missing-tool')
		}
	})

	it('has all new tools available via get()', () => {
		const registry = createToolRegistry(new HookRegistry())

		// All 8 new tools should be retrievable
		expect(registry.get('apply_patch').ok).toBe(true)
		expect(registry.get('webfetch').ok).toBe(true)
		expect(registry.get('websearch').ok).toBe(true)
		expect(registry.get('todowrite').ok).toBe(true)
		expect(registry.get('todoread').ok).toBe(true)
		expect(registry.get('question').ok).toBe(true)
		expect(registry.get('skill').ok).toBe(true)
		expect(registry.get('lsp').ok).toBe(true)
		expect(registry.get('lsp_diagnostics').ok).toBe(true)

		// Original 6 tools should still be available
		expect(registry.get('read').ok).toBe(true)
		expect(registry.get('write').ok).toBe(true)
		expect(registry.get('edit').ok).toBe(true)
		expect(registry.get('glob').ok).toBe(true)
		expect(registry.get('grep').ok).toBe(true)
		expect(registry.get('bash').ok).toBe(true)
	})

	it('fires tool:before and tool:after hooks around execution', async () => {
		const hooks = new HookRegistry()
		const registry = new ToolRegistry(hooks)
		const order: string[] = []

		hooks.register('tool:before', async (context) => {
			order.push(`before:${context.toolName}`)
		})

		hooks.register('tool:after', async (context) => {
			order.push(`after:${context.toolName}:${context.result.isError ? 'error' : 'ok'}`)
		})

		registry.register({
			name: 'tool-with-hooks',
			description: 'Hook test tool',
			parameters: {},
			execute: async () => ({ ok: true, data: 'done' }),
		})

		const result = await registry.execute('tool-with-hooks', { conversationId: 'conv-1' })
		expect(result.ok).toBe(true)
		expect(order).toEqual(['before:tool-with-hooks', 'after:tool-with-hooks:ok'])
	})

	it('truncates large successful tool output at the registry boundary', async () => {
		const hooks = new HookRegistry()
		const registry = new ToolRegistry(hooks)
		const afterResults: Array<{ isError: boolean; content: string }> = []
		const payload = 'a'.repeat(MAX_TOOL_OUTPUT_CHARS + 1)

		hooks.register('tool:after', async (context) => {
			afterResults.push({ isError: context.result.isError, content: context.result.content })
		})

		registry.register({
			name: 'large-output-tool',
			description: 'Returns a large payload',
			parameters: {},
			execute: async () => ({ ok: true, data: payload }),
		})

		const result = await registry.execute('large-output-tool', {})

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.data).toStartWith('a'.repeat(100))
			expect(result.data).toContain('Output truncated')
			expect(result.data).toContain(`showing first ${MAX_TOOL_OUTPUT_CHARS} chars`)
			expect(result.data).not.toContain('a'.repeat(MAX_TOOL_OUTPUT_CHARS + 1))
		}
		expect(afterResults).toHaveLength(1)
		expect(afterResults[0]?.isError).toBe(false)
		expect(afterResults[0]?.content).toContain('Output truncated')
	})

	it('applies truncation regardless of tool identity', async () => {
		const registry = new ToolRegistry(new HookRegistry())
		const payload = 'b'.repeat(MAX_TOOL_OUTPUT_CHARS + 500)

		for (const name of ['alpha-tool', 'beta-tool']) {
			registry.register({
				name,
				description: 'Returns a large payload',
				parameters: {},
				execute: async () => ({ ok: true, data: `${name}:${payload}` }),
			})
		}

		const alpha = await registry.execute('alpha-tool', {})
		const beta = await registry.execute('beta-tool', {})

		expect(alpha.ok).toBe(true)
		expect(beta.ok).toBe(true)
		if (alpha.ok && beta.ok) {
			expect(alpha.data).toContain('Output truncated')
			expect(beta.data).toContain('Output truncated')
			expect(alpha.data).toStartWith('alpha-tool:')
			expect(beta.data).toStartWith('beta-tool:')
		}
	})

	it('leaves output below the registry threshold untouched', async () => {
		const registry = new ToolRegistry(new HookRegistry())
		const payload = 'small output'

		registry.register({
			name: 'small-output-tool',
			description: 'Returns a small payload',
			parameters: {},
			execute: async () => ({ ok: true, data: payload }),
		})

		const result = await registry.execute('small-output-tool', {})

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.data).toBe(payload)
			expect(result.data).not.toContain('Output truncated')
		}
	})

	it('preserves tool-specific webfetch storage notices before registry truncation notice', async () => {
		const registry = new ToolRegistry(new HookRegistry())
		const webfetchNotice = '[Output truncated at 50000 chars. Full content available at: /tmp/elefant-webfetch-test-conv-123.txt]'
		const payload = `${'w'.repeat(MAX_TOOL_OUTPUT_CHARS - webfetchNotice.length - 10)}${webfetchNotice}${'z'.repeat(1_000)}`

		registry.register({
			name: 'webfetch',
			description: 'Synthetic webfetch result',
			parameters: {},
			execute: async () => ({ ok: true, data: payload }),
		})

		const result = await registry.execute('webfetch', {})

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.data).toContain(webfetchNotice)
			expect(result.data).toContain('/tmp/elefant-webfetch-test-conv-123.txt')
			expect(result.data).toContain('Output truncated: showing first')
			expect(result.data.indexOf(webfetchNotice)).toBeLessThan(result.data.lastIndexOf('Output truncated'))
		}
	})

	it('leaves normal validation errors untruncated', async () => {
		const registry = new ToolRegistry(new HookRegistry())

		registry.register({
			name: 'normal-validation-tool',
			description: 'Requires a name',
			parameters: {
				name: { type: 'string', description: 'Name', required: true },
			},
			execute: async () => ({ ok: true, data: 'should not run' }),
		})

		const result = await registry.execute('normal-validation-tool', {})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.message).toContain('missing required field "name"')
			expect(result.error.message).not.toContain('Output truncated')
		}
	})

	it('truncates oversized validation errors uniformly', async () => {
		const hooks = new HookRegistry()
		const registry = new ToolRegistry(hooks)
		const afterResults: Array<{ isError: boolean; content: string }> = []
		const hugeFieldName = `field-${'x'.repeat(MAX_TOOL_OUTPUT_CHARS + 1)}`

		hooks.register('tool:after', async (context) => {
			afterResults.push({ isError: context.result.isError, content: context.result.content })
		})

		registry.register({
			name: 'huge-validation-tool',
			description: 'Requires a huge field name',
			parameters: {
				[hugeFieldName]: { type: 'string', description: 'Huge field', required: true },
			},
			execute: async () => ({ ok: true, data: 'should not run' }),
		})

		const result = await registry.execute('huge-validation-tool', {})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe('VALIDATION_ERROR')
			expect(result.error.message).toContain('Output truncated')
			expect(result.error.message).toContain(`showing first ${MAX_TOOL_OUTPUT_CHARS} chars`)
		}
		expect(afterResults).toHaveLength(1)
		expect(afterResults[0]?.isError).toBe(true)
		expect(afterResults[0]?.content).toContain('Output truncated')
	})

	it('rejects disallowed agent when allowedAgents is set on tool', async () => {
		const registry = new ToolRegistry(new HookRegistry())
		registry.setCurrentAgentName('executor-medium')

		registry.register({
			name: 'restricted-tool',
			description: 'Only for researcher/writer/librarian',
			parameters: {},
			allowedAgents: ['researcher', 'writer', 'librarian'],
			execute: async () => ({ ok: true, data: 'should not run' }),
		})

		const result = await registry.execute('restricted-tool', {})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe('PERMISSION_DENIED')
			expect(result.error.message).toContain('restricted to agents')
			expect(result.error.message).toContain('called by executor-medium')
		}
	})

	it('allows matching agent when allowedAgents is set', async () => {
		const registry = new ToolRegistry(new HookRegistry())
		registry.setCurrentAgentName('researcher')

		registry.register({
			name: 'restricted-tool',
			description: 'Only for researcher/writer/librarian',
			parameters: {},
			allowedAgents: ['researcher', 'writer', 'librarian'],
			execute: async () => ({ ok: true, data: 'allowed' }),
		})

		const result = await registry.execute('restricted-tool', {})

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.data).toBe('allowed')
		}
	})

	it('skips allowedAgents check when the registry has no current agent', async () => {
		const registry = new ToolRegistry(new HookRegistry())
		// No setCurrentAgentName call — simulate createToolRegistry path

		registry.register({
			name: 'restricted-tool',
			description: 'Only for researcher/writer/librarian',
			parameters: {},
			allowedAgents: ['researcher', 'writer', 'librarian'],
			execute: async () => ({ ok: true, data: 'no agent set — passes through' }),
		})

		const result = await registry.execute('restricted-tool', {})

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.data).toBe('no agent set — passes through')
		}
	})

	it('registers all 5 research_* tools in createToolRegistryForRun', () => {
		const database = {
			db: {
				query() {
					return { get: () => ({ path: '/tmp/test-project' }) }
				},
			},
		} as never
		const registry = createToolRegistryForRun({
			hookRegistry: new HookRegistry(),
			database: database as never,
			runRegistry: {} as never,
			providerRouter: {} as never,
			configManager: {} as never,
			currentRun: {
				runId: 'run-1',
				depth: 0,
				agentType: 'researcher',
				title: 'Test',
				sessionId: 'session-1',
				projectId: 'project-1',
				signal: new AbortController().signal,
				discoveredTools: new Set<string>(),
			},
		})

		const names = registry.getAll().map((t) => t.name)
		expect(names).toContain('research_search')
		expect(names).toContain('research_grep')
		expect(names).toContain('research_read')
		expect(names).toContain('research_write')
		expect(names).toContain('research_index')
	})

	it('research_write lists allowedAgents for researcher/writer/librarian only', () => {
		const registry = createToolRegistry(new HookRegistry())
		const tool = registry.get('research_write')
		expect(tool.ok).toBe(true)
		if (tool.ok) {
			expect(tool.data.allowedAgents).toEqual(['researcher', 'writer', 'librarian'])
		}
	})

	it('blocks non-orchestrator from calling visualize via allowedAgents', async () => {
		const registry = new ToolRegistry(new HookRegistry())
		registry.setCurrentAgentName('executor-medium')

		registry.register({
			name: 'visualize',
			description: 'Render inline viz',
			parameters: {},
			allowedAgents: ['orchestrator'],
			execute: async () => ({ ok: true, data: 'should not run' }),
		})

		const result = await registry.execute('visualize', {})
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe('PERMISSION_DENIED')
			expect(result.error.message).toContain('restricted to agents: orchestrator')
			expect(result.error.message).toContain('called by executor-medium')
		}
	})

	it('allows orchestrator to call visualize via allowedAgents', async () => {
		const registry = new ToolRegistry(new HookRegistry())
		registry.setCurrentAgentName('orchestrator')

		registry.register({
			name: 'visualize',
			description: 'Render inline viz',
			parameters: {},
			allowedAgents: ['orchestrator'],
			execute: async () => ({ ok: true, data: 'viz ok' }),
		})

		const result = await registry.execute('visualize', {})
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.data).toBe('viz ok')
		}
	})
})

describe('filterToolsForAgent', () => {
	const publicTool: ToolDefinition = {
		name: 'public-tool',
		description: 'Everyone can use',
		parameters: {},
		execute: async () => ({ ok: true, data: 'ok' }),
	}

	const restrictedTool: ToolDefinition = {
		name: 'restricted-tool',
		description: 'Only orchestrator',
		parameters: {},
		allowedAgents: ['orchestrator'],
		execute: async () => ({ ok: true, data: 'ok' }),
	}

	const multiAgentTool: ToolDefinition = {
		name: 'multi-agent-tool',
		description: 'Researcher and writer',
		parameters: {},
		allowedAgents: ['researcher', 'writer'],
		execute: async () => ({ ok: true, data: 'ok' }),
	}

	it('includes public tools for any agent', () => {
		const result = filterToolsForAgent([publicTool], 'executor-medium')
		expect(result).toHaveLength(1)
		expect(result[0]!.name).toBe('public-tool')
	})

	it('excludes restricted tools for non-matching agent', () => {
		const result = filterToolsForAgent([publicTool, restrictedTool], 'executor-medium')
		expect(result).toHaveLength(1)
		expect(result[0]!.name).toBe('public-tool')
	})

	it('includes restricted tools for matching agent', () => {
		const result = filterToolsForAgent([publicTool, restrictedTool], 'orchestrator')
		expect(result).toHaveLength(2)
		expect(result.map((t) => t.name).sort()).toEqual(['public-tool', 'restricted-tool'])
	})

	it('handles multi-agent allowlists', () => {
		expect(filterToolsForAgent([multiAgentTool], 'researcher')).toHaveLength(1)
		expect(filterToolsForAgent([multiAgentTool], 'writer')).toHaveLength(1)
		expect(filterToolsForAgent([multiAgentTool], 'executor-medium')).toHaveLength(0)
	})

	it('includes all tools when agentType matches no restriction but some have none', () => {
		const allTools = [publicTool, restrictedTool, multiAgentTool]
		// orchestrator matches restricted, but not multi-agent
		const result = filterToolsForAgent(allTools, 'orchestrator')
		expect(result.map((t) => t.name).sort()).toEqual(['public-tool', 'restricted-tool'])
	})

	it('returns empty array for empty input', () => {
		expect(filterToolsForAgent([], 'orchestrator')).toEqual([])
	})
})
