import { describe, expect, it } from 'bun:test'

import { HookRegistry } from '../hooks/index.ts'
import type { ToolDefinition } from '../types/tools.ts'
import { createToolRegistry, ToolRegistry } from './registry.ts'

describe('ToolRegistry', () => {
	it('registers all 15 tools', () => {
		const registry = createToolRegistry(new HookRegistry())
		const names = registry.getAll().map((tool) => tool.name).sort()

		expect(names).toEqual([
			'apply_patch',
			'bash',
			'edit',
			'glob',
			'grep',
			'lsp',
			'question',
			'read',
			'skill',
			'todoread',
			'todowrite',
			'tool_list',
			'webfetch',
			'websearch',
			'write',
		])
		expect(names.length).toBe(15)
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
})
