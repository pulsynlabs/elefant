/**
 * Tests for the categorized tool inventory section generator.
 *
 * Verifies:
 * - Empty registry → graceful empty state
 * - wf_* tools all land in Workflow category
 * - question + slider land in Interactive
 * - Filesystem tools (read, write, edit, glob, grep, bash, apply_patch) land in Filesystem
 * - Provider tools (webfetch, websearch) land in Provider
 * - Unrecognised tools land in Other
 * - Explicit tool.category overrides inference
 * - Categories appear in stable order
 * - Tools sort alphabetically within each category
 * - Dynamic update: a tool added to the registry appears automatically
 */

import { describe, expect, it } from 'bun:test'
import type { ToolDefinition } from '../../types/tools.ts'
import {
	buildToolInventorySection,
	inferCategory,
	type ToolInventorySource,
} from './tool-inventory.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tool(
	name: string,
	description: string,
	category?: string,
): ToolDefinition {
	return {
		name,
		description,
		category,
		parameters: {},
		execute: async () => ({ ok: true, data: 'ok' }),
	}
}

function registry(...tools: ToolDefinition[]): ToolInventorySource {
	return { getAll: () => tools }
}

// All workflow tools registered for Spec Mode.
const WF_TOOLS: ToolDefinition[] = [
	tool('wf_status', 'Check current workflow phase and status'),
	tool('wf_state', 'Transition workflow state, lock or unlock spec'),
	tool('wf_workflow', 'List, create, or activate workflows'),
	tool('wf_requirements', 'Read or write the REQUIREMENTS document'),
	tool('wf_spec', 'Read, write, lock, or amend the SPEC contract'),
	tool('wf_blueprint', 'Read the BLUEPRINT execution plan'),
	tool('wf_chronicle', 'Append to or read from the CHRONICLE log'),
	tool('wf_adl', 'Manage the architectural decision log'),
	tool('wf_checkpoint', 'Save, load, or list execution checkpoints'),
]

const INTERACTIVE_TOOLS: ToolDefinition[] = [
	tool('question', 'Ask the user a structured question with options'),
	tool('slider', 'Present a slider to collect a numeric value'),
]

const FILESYSTEM_TOOLS: ToolDefinition[] = [
	tool('read', 'Read a file from the local filesystem'),
	tool('write', 'Write a file to the local filesystem'),
	tool('edit', 'Perform exact string replacements in files'),
	tool('glob', 'Fast file pattern matching'),
	tool('grep', 'Fast content search with regex'),
	tool('bash', 'Execute a bash command'),
	tool('apply_patch', 'Apply a unified diff patch to a file'),
]

const PROVIDER_TOOLS: ToolDefinition[] = [
	tool('webfetch', 'Fetch content from a URL'),
	tool('websearch', 'Search the web'),
]

const UNRECOGNISED_TOOLS: ToolDefinition[] = [
	tool('task', 'Spawn a sub-agent run'),
	tool('todo_write', 'Create and manage a structured task list'),
]

// ---------------------------------------------------------------------------
// inferCategory
// ---------------------------------------------------------------------------

describe('inferCategory', () => {
	it('maps wf_status to workflow', () => {
		expect(inferCategory('wf_status')).toBe('workflow')
	})

	it('maps any wf_ prefix to workflow', () => {
		expect(inferCategory('wf_future_feature')).toBe('workflow')
	})

	it('maps question to interactive', () => {
		expect(inferCategory('question')).toBe('interactive')
	})

	it('maps slider to interactive', () => {
		expect(inferCategory('slider')).toBe('interactive')
	})

	it('maps read to filesystem', () => {
		expect(inferCategory('read')).toBe('filesystem')
	})

	it('maps write to filesystem', () => {
		expect(inferCategory('write')).toBe('filesystem')
	})

	it('maps apply_patch to filesystem', () => {
		expect(inferCategory('apply_patch')).toBe('filesystem')
	})

	it('maps webfetch to provider', () => {
		expect(inferCategory('webfetch')).toBe('provider')
	})

	it('maps websearch to provider', () => {
		expect(inferCategory('websearch')).toBe('provider')
	})

	it('maps unrecognised names to other', () => {
		expect(inferCategory('task')).toBe('other')
		expect(inferCategory('lsp')).toBe('other')
		expect(inferCategory('unknown_tool')).toBe('other')
	})
})

// ---------------------------------------------------------------------------
// buildToolInventorySection
// ---------------------------------------------------------------------------

describe('buildToolInventorySection', () => {
	it('returns graceful empty state for empty registry', () => {
		const result = buildToolInventorySection(registry())
		expect(result).toContain('## Available Tools')
		expect(result).toContain('No tools are currently registered')
	})

	it('is non-empty when tools are registered', () => {
		const result = buildToolInventorySection(registry(
			tool('read', 'Read a file'),
		))
		expect(result.length).toBeGreaterThan(0)
	})

	// -----------------------------------------------------------------------
	// Category placement
	// -----------------------------------------------------------------------

	it('places all wf_* tools under the Workflow category', () => {
		const result = buildToolInventorySection(registry(...WF_TOOLS))

		// Every wf_ tool should appear after the Workflow heading and before
		// any subsequent category heading (here Interactive plus Others)
		const workflowStart = result.indexOf('### Workflow')
		expect(workflowStart).toBeGreaterThan(0)

		for (const t of WF_TOOLS) {
			const pos = result.indexOf(t.name)
			expect(pos).toBeGreaterThan(workflowStart)
		}
	})

	it('places question and slider under the Interactive category', () => {
		const result = buildToolInventorySection(registry(...INTERACTIVE_TOOLS))

		const interactiveStart = result.indexOf('### Interactive')
		expect(interactiveStart).toBeGreaterThan(0)

		for (const t of INTERACTIVE_TOOLS) {
			const pos = result.indexOf(t.name)
			expect(pos).toBeGreaterThan(interactiveStart)
		}
	})

	it('places read, write, edit, glob, grep, bash, apply_patch under Filesystem', () => {
		const result = buildToolInventorySection(registry(...FILESYSTEM_TOOLS))

		const fsStart = result.indexOf('### Filesystem')
		expect(fsStart).toBeGreaterThan(0)

		for (const t of FILESYSTEM_TOOLS) {
			const pos = result.indexOf(t.name)
			expect(pos).toBeGreaterThan(fsStart)
		}
	})

	it('places webfetch and websearch under Provider', () => {
		const result = buildToolInventorySection(registry(...PROVIDER_TOOLS))

		const providerStart = result.indexOf('### Provider')
		expect(providerStart).toBeGreaterThan(0)

		for (const t of PROVIDER_TOOLS) {
			const pos = result.indexOf(t.name)
			expect(pos).toBeGreaterThan(providerStart)
		}
	})

	it('places unrecognised tools under Other', () => {
		const result = buildToolInventorySection(registry(
			tool('task', 'Spawn a sub-agent'),
			tool('lsp', 'Language server operations'),
		))

		const otherStart = result.indexOf('### Other')
		expect(otherStart).toBeGreaterThan(0)

		expect(result.indexOf('task', otherStart)).toBeGreaterThan(otherStart)
		expect(result.indexOf('lsp', otherStart)).toBeGreaterThan(otherStart)
	})

	// -----------------------------------------------------------------------
	// Category ordering
	// -----------------------------------------------------------------------

	it('renders categories in stable order: Workflow → Interactive → Filesystem → Provider → Other', () => {
		const allTools = [
			...WF_TOOLS,
			...INTERACTIVE_TOOLS,
			...FILESYSTEM_TOOLS,
			...PROVIDER_TOOLS,
			...UNRECOGNISED_TOOLS,
		]
		const result = buildToolInventorySection(registry(...allTools))

		const wfIdx = result.indexOf('### Workflow')
		const intIdx = result.indexOf('### Interactive')
		const fsIdx = result.indexOf('### Filesystem')
		const provIdx = result.indexOf('### Provider')
		const otherIdx = result.indexOf('### Other')

		expect(wfIdx).toBeGreaterThan(0)
		expect(intIdx).toBeGreaterThan(wfIdx)
		expect(fsIdx).toBeGreaterThan(intIdx)
		expect(provIdx).toBeGreaterThan(fsIdx)
		expect(otherIdx).toBeGreaterThan(provIdx)
	})

	it('omits empty categories entirely', () => {
		const result = buildToolInventorySection(registry(
			tool('read', 'Read a file'),
		))

		expect(result).toContain('### Filesystem')
		expect(result).not.toContain('### Workflow')
		expect(result).not.toContain('### Interactive')
		expect(result).not.toContain('### Provider')
		expect(result).not.toContain('### Other')
	})

	// -----------------------------------------------------------------------
	// Explicit category override
	// -----------------------------------------------------------------------

	it('honours explicit tool.category over inferred category', () => {
		const overridden = tool('read', 'Read with extra context', 'provider')
		const result = buildToolInventorySection(registry(overridden))

		// Should appear under Provider, not Filesystem
		const providerIdx = result.indexOf('### Provider')
		expect(providerIdx).toBeGreaterThan(0)
		expect(result.indexOf('read', providerIdx)).toBeGreaterThan(providerIdx)
	})

	// -----------------------------------------------------------------------
	// Alphabetical sorting within categories
	// -----------------------------------------------------------------------

	it('sorts tools alphabetically within each category', () => {
		const shuffled: ToolDefinition[] = [
			tool('grep', 'Grep'),
			tool('read', 'Read'),
			tool('bash', 'Bash'),
			tool('write', 'Write'),
			tool('edit', 'Edit'),
			tool('apply_patch', 'Apply patch'),
			tool('glob', 'Glob'),
		]
		const result = buildToolInventorySection(registry(...shuffled))

		const fsStart = result.indexOf('### Filesystem')
		const sortedSegment = result.slice(fsStart)

		// apply_patch should appear before bash, read before write, etc.
		const applyIdx = sortedSegment.indexOf('**apply_patch**')
		const bashIdx = sortedSegment.indexOf('**bash**')
		const readIdx = sortedSegment.indexOf('**read**')
		const writeIdx = sortedSegment.indexOf('**write**')

		expect(applyIdx).toBeLessThan(bashIdx)
		expect(readIdx).toBeLessThan(writeIdx)
	})

	// -----------------------------------------------------------------------
	// Format
	// -----------------------------------------------------------------------

	it('uses bold name + em-dash + description format', () => {
		const result = buildToolInventorySection(registry(
			tool('webfetch', 'Fetch content from a URL'),
		))

		expect(result).toContain('- **webfetch** — Fetch content from a URL')
	})

	// -----------------------------------------------------------------------
	// Dynamic update
	// -----------------------------------------------------------------------

	it('reflects tools added to the registry after the last call', () => {
		const mutableTools: ToolDefinition[] = [tool('read', 'Read a file')]
		const src: ToolInventorySource = { getAll: () => mutableTools }

		const before = buildToolInventorySection(src)
		expect(before).toContain('### Filesystem')
		expect(before).not.toContain('wf_status')

		// Add a workflow tool after the first call.
		mutableTools.push(tool('wf_status', 'Show workflow status'))

		const after = buildToolInventorySection(src)
		expect(after).toContain('### Workflow')
		expect(after).toContain('- **wf_status** — Show workflow status')
	})
})
