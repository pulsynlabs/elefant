import { describe, expect, it } from 'bun:test'

import {
	buildCommandsSection,
	buildContextNoteSection,
	buildIdentitySection,
	buildSystemPrompt,
	buildToolInventorySection,
	buildWorkflowSection,
	type SystemPromptContext,
} from './system-prompt-builder.ts'
import type { ToolDefinition } from '../types/tools.ts'

function createTool(name: string, description: string): ToolDefinition {
	return {
		name,
		description,
		parameters: {},
		execute: async () => ({ ok: true, data: 'ok' }),
	}
}

function createContext(overrides: Partial<SystemPromptContext> = {}): SystemPromptContext {
	return {
		toolRegistry: {
			getAll: () => [
				createTool('read', 'Read a file'),
				createTool('wf_status', 'Show workflow status'),
			],
		},
		sessionMode: 'quick',
		commands: [
			{ trigger: '/status', description: 'Show current workflow state' },
			{ trigger: '/execute', description: 'Begin implementation' },
		],
		...overrides,
	}
}

describe('system-prompt-builder', () => {
	it('buildSystemPrompt returns a non-empty string containing all baseline section markers', () => {
		const prompt = buildSystemPrompt(createContext())

		expect(prompt.length).toBeGreaterThan(0)
		expect(prompt).toContain('## Identity')
		expect(prompt).toContain('## Tool Inventory')
		expect(prompt).toContain('## Commands')
		expect(prompt).toContain('## Context Assembly')
	})

	it('keeps stable section ordering for prompt caching', () => {
		const prompt = buildSystemPrompt(createContext({
			sessionMode: 'spec',
			workflowState: { phase: 'execute', currentWave: 5, totalWaves: 6 },
		}))

		const identity = prompt.indexOf('## Identity')
		const tools = prompt.indexOf('## Tool Inventory')
		const workflow = prompt.indexOf('## Workflow')
		const commands = prompt.indexOf('## Commands')
		const context = prompt.indexOf('## Context Assembly')

		expect(identity).toBeGreaterThanOrEqual(0)
		expect(tools).toBeGreaterThan(identity)
		expect(workflow).toBeGreaterThan(tools)
		expect(commands).toBeGreaterThan(workflow)
		expect(context).toBeGreaterThan(commands)
	})

	it('omits workflow section in Quick Mode', () => {
		const prompt = buildSystemPrompt(createContext({
			sessionMode: 'quick',
			workflowState: { phase: 'execute', currentWave: 5, totalWaves: 6 },
		}))

		expect(prompt).not.toContain('## Workflow')
	})

	it('includes workflow section in Spec Mode with active workflow', () => {
		const prompt = buildSystemPrompt(createContext({
			sessionMode: 'spec',
			workflowState: { phase: 'execute', currentWave: 5, totalWaves: 6 },
		}))

		expect(prompt).toContain('## Workflow')
		expect(prompt).toContain('Phase: execute | Wave: 5/6')
	})

	it('exposes each section generator for isolated testing', () => {
		expect(buildIdentitySection()).toContain('## Identity')
		expect(buildToolInventorySection(createContext().toolRegistry)).toContain('read — Read a file')
		expect(buildWorkflowSection({ sessionMode: 'quick' })).toBe('')
		expect(buildCommandsSection(createContext().commands)).toContain('/status — Show current workflow state')
		expect(buildContextNoteSection()).toContain('## Context Assembly')
	})
})
