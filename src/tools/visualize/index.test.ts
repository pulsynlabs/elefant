import { describe, expect, it } from 'bun:test'

import { createVisualizeTool } from './index.js'
import type { VisualizeParams, VizEnvelope, VizType } from './types.js'

const tool = createVisualizeTool()

type ToolResult = Awaited<ReturnType<typeof tool.execute>>

async function executeSuccess(params: VisualizeParams): Promise<VizEnvelope> {
	const result: ToolResult = await tool.execute(params)
	expect(result.ok).toBe(true)
	if (!result.ok) {
		throw new Error(result.error.message)
	}
	expect(result.data.isError).toBe(false)
	const envelope = JSON.parse(result.data.content) as VizEnvelope
	expect(envelope.id).toBeTruthy()
	expect(envelope.intent).toBe(params.intent)
	expect(envelope.title).toBe(params.title)
	return envelope
}

async function executeInvalid(params: VisualizeParams, type: VizType): Promise<string> {
	const result: ToolResult = await tool.execute(params)
	expect(result.ok).toBe(true)
	if (!result.ok) {
		throw new Error(result.error.message)
	}
	expect(result.data.isError).toBe(true)
	expect(result.data.content).toContain(type)
	return result.data.content
}

describe('visualize tool', () => {
	it('restricts execution to the orchestrator agent', () => {
		expect(tool.allowedAgents).toEqual(['orchestrator'])
	})

	it('keeps the tool description compact', () => {
		expect(tool.description.length).toBeLessThanOrEqual(400)
	})

	it('renders mermaid happy path', async () => {
		const envelope = await executeSuccess({
			type: 'mermaid',
			data: { src: 'graph LR; A-->B' },
			intent: 'Show flow',
		})

		expect(envelope.type).toBe('mermaid')
		expect(envelope.data).toEqual({ type: 'mermaid', src: 'graph LR; A-->B' })
	})

	it('renders table happy path', async () => {
		const envelope = await executeSuccess({
			type: 'table',
			data: { cols: ['Name', 'Score'], rows: [{ Name: 'A', Score: 1 }] },
			intent: 'Show scores',
			title: 'Scores',
		})

		expect(envelope.type).toBe('table')
		expect(envelope.data).toEqual({ type: 'table', cols: ['Name', 'Score'], rows: [{ Name: 'A', Score: 1 }] })
	})

	it('renders stat-grid happy path', async () => {
		const envelope = await executeSuccess({
			type: 'stat-grid',
			data: { items: [{ label: 'Latency', value: '120ms', delta: -12, trend: 'down' }] },
			intent: 'Show metrics',
		})

		expect(envelope.type).toBe('stat-grid')
		expect(envelope.data).toEqual({
			type: 'stat-grid',
			items: [{ label: 'Latency', value: '120ms', delta: -12, trend: 'down' }],
		})
	})

	it('renders code happy path', async () => {
		const envelope = await executeSuccess({
			type: 'code',
			data: { lang: 'ts', src: 'const value = 1', title: 'Example' },
			intent: 'Show snippet',
		})

		expect(envelope.type).toBe('code')
		expect(envelope.data).toEqual({ type: 'code', lang: 'ts', src: 'const value = 1', title: 'Example' })
	})

	it('renders research-card happy path', async () => {
		const envelope = await executeSuccess({
			type: 'research-card',
			data: {
				cards: [{ title: 'Finding', summary: 'A concise result', url: 'https://example.com', confidence: 0.9, tags: ['ai'] }],
			},
			intent: 'Show research results',
		})

		expect(envelope.type).toBe('research-card')
		expect(envelope.data).toEqual({
			type: 'research-card',
			cards: [{ title: 'Finding', summary: 'A concise result', url: 'https://example.com', confidence: 0.9, tags: ['ai'] }],
		})
	})

	it('renders loading happy path', async () => {
		const envelope = await executeSuccess({
			type: 'loading',
			data: { msg: 'Researching...', steps: ['Search', 'Synthesize'], step: 1, pct: 50 },
			intent: 'Show progress',
		})

		expect(envelope.type).toBe('loading')
		expect(envelope.data).toEqual({ type: 'loading', msg: 'Researching...', steps: ['Search', 'Synthesize'], step: 1, pct: 50 })
	})

	it('renders comparison happy path', async () => {
		const envelope = await executeSuccess({
			type: 'comparison',
			data: {
				left: { title: 'Option A', items: ['Fast', 'Simple'] },
				right: { title: 'Option B', items: ['Flexible'] },
			},
			intent: 'Compare options',
		})

		expect(envelope.type).toBe('comparison')
		expect(envelope.data).toEqual({
			type: 'comparison',
			left: { title: 'Option A', items: ['Fast', 'Simple'] },
			right: { title: 'Option B', items: ['Flexible'] },
		})
	})

	it('rejects invalid mermaid data', async () => {
		await executeInvalid({ type: 'mermaid', data: { wrongField: 123 }, intent: 'Test' }, 'mermaid')
	})

	it('rejects invalid table data', async () => {
		await executeInvalid({ type: 'table', data: { wrongField: 123 }, intent: 'Test' }, 'table')
	})

	it('rejects invalid stat-grid data', async () => {
		await executeInvalid({ type: 'stat-grid', data: { wrongField: 123 }, intent: 'Test' }, 'stat-grid')
	})

	it('rejects invalid code data', async () => {
		await executeInvalid({ type: 'code', data: { wrongField: 123 }, intent: 'Test' }, 'code')
	})

	it('rejects invalid research-card data', async () => {
		await executeInvalid({ type: 'research-card', data: { wrongField: 123 }, intent: 'Test' }, 'research-card')
	})

	it('rejects invalid loading data', async () => {
		await executeInvalid({ type: 'loading', data: { wrongField: 123 }, intent: 'Test' }, 'loading')
	})

	it('rejects invalid comparison data', async () => {
		await executeInvalid({ type: 'comparison', data: { wrongField: 123 }, intent: 'Test' }, 'comparison')
	})

	it('rejects unknown type', async () => {
		const result = await tool.execute({ type: 'unknown', data: {}, intent: 'Test' })

		expect(result.ok).toBe(true)
		if (!result.ok) {
			throw new Error(result.error.message)
		}
		expect(result.data.isError).toBe(true)
		expect(result.data.content).toContain('unknown')
	})
})
