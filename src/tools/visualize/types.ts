import type { z } from 'zod'
import type { VizPayloadSchema, VisualizeParamsSchema } from './schemas.js'

export type VizType = 'mermaid' | 'table' | 'stat-grid' | 'code' | 'field-notes-card' | 'loading' | 'comparison'
export type VizPayload = z.infer<typeof VizPayloadSchema>
export type VisualizeParams = z.infer<typeof VisualizeParamsSchema>

export type MermaidPayload = Extract<VizPayload, { type: 'mermaid' }>
export type TablePayload = Extract<VizPayload, { type: 'table' }>
export type StatGridPayload = Extract<VizPayload, { type: 'stat-grid' }>
export type CodePayload = Extract<VizPayload, { type: 'code' }>
export type FieldNotesCardPayload = Extract<VizPayload, { type: 'field-notes-card' }>
export type LoadingPayload = Extract<VizPayload, { type: 'loading' }>
export type ComparisonPayload = Extract<VizPayload, { type: 'comparison' }>

export interface VizEnvelope {
	id: string
	type: VizType
	intent: string
	title?: string
	data: VizPayload
}
