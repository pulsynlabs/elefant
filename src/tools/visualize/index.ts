import type { ElefantError } from '../../types/errors.js'
import type { Result } from '../../types/result.js'
import { ok } from '../../types/result.js'
import type { ToolDefinition } from '../../types/tools.js'
import { VisualizeParamsSchema, VizPayloadSchema } from './schemas.js'
import type { VisualizeParams, VizEnvelope, VizType } from './types.js'

interface VisualizeToolResult {
	content: string
	isError: boolean
}

const VISUALIZE_DESCRIPTION = 'Render inline viz: mermaid|table|stat-grid|code|research-card|loading|comparison. Pass type, data payload, intent, optional title.'

function invalidResult(content: string): Result<VisualizeToolResult, ElefantError> {
	return ok({ content, isError: true })
}

export function createVisualizeTool(): ToolDefinition<VisualizeParams, VisualizeToolResult> {
	return {
		name: 'visualize',
		description: VISUALIZE_DESCRIPTION,
		parameters: {
			type: {
				type: 'string',
				required: true,
				description: 'Viz type: mermaid, table, stat-grid, code, research-card, loading, or comparison.',
			},
			data: {
				type: 'object',
				required: true,
				description: 'Type-specific viz payload.',
			},
			intent: {
				type: 'string',
				required: true,
				description: 'Short reason for rendering this visualization.',
			},
			title: {
				type: 'string',
				required: false,
				description: 'Optional heading for the visualization.',
			},
		},
		inputJSONSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['type', 'data', 'intent'],
			properties: {
				type: { type: 'string', enum: ['mermaid', 'table', 'stat-grid', 'code', 'research-card', 'loading', 'comparison'] },
				data: { type: 'object', additionalProperties: true },
				intent: { type: 'string' },
				title: { type: 'string' },
			},
		},
		execute: async (params): Promise<Result<VisualizeToolResult, ElefantError>> => {
			const topResult = VisualizeParamsSchema.safeParse(params)
			if (!topResult.success) {
				return invalidResult(`Invalid visualize params: ${topResult.error.message}`)
			}

			const dataResult = VizPayloadSchema.safeParse({
				type: topResult.data.type,
				...topResult.data.data,
			})
			if (!dataResult.success) {
				return invalidResult(`Invalid viz data for type "${topResult.data.type}": ${dataResult.error.message}`)
			}

			const vizType: VizType = dataResult.data.type
			const envelope: VizEnvelope = {
				id: crypto.randomUUID(),
				type: vizType,
				intent: topResult.data.intent,
				title: topResult.data.title,
				data: dataResult.data,
			}
			void envelope

			throw new Error('not implemented')
		},
	}
}
