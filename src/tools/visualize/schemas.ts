import { z } from 'zod'

export const mermaidSchema = z.object({
	type: z.literal('mermaid'),
	src: z.string(),
}).strict()

export const tableSchema = z.object({
	type: z.literal('table'),
	cols: z.array(z.string()),
	rows: z.array(z.record(z.string(), z.unknown())),
}).strict()

export const statGridSchema = z.object({
	type: z.literal('stat-grid'),
	items: z.array(z.object({
		label: z.string(),
		value: z.union([z.string(), z.number()]),
		delta: z.number().optional(),
		trend: z.enum(['up', 'down', 'flat']).optional(),
	}).strict()),
}).strict()

export const codeSchema = z.object({
	type: z.literal('code'),
	lang: z.string(),
	src: z.string(),
	title: z.string().optional(),
}).strict()

export const fieldNotesCardSchema = z.object({
	type: z.literal('field-notes-card'),
	cards: z.array(z.object({
		title: z.string(),
		summary: z.string(),
		url: z.string().optional(),
		confidence: z.number().min(0).max(1).optional(),
		tags: z.array(z.string()).optional(),
	}).strict()),
}).strict()

export const loadingSchema = z.object({
	type: z.literal('loading'),
	msg: z.string(),
	steps: z.array(z.string()).optional(),
	step: z.number().int().optional(),
	pct: z.number().min(0).max(100).optional(),
}).strict()

export const comparisonSchema = z.object({
	type: z.literal('comparison'),
	left: z.object({
		title: z.string(),
		items: z.array(z.string()),
	}).strict(),
	right: z.object({
		title: z.string(),
		items: z.array(z.string()),
	}).strict(),
}).strict()

export const VizPayloadSchema = z.discriminatedUnion('type', [
	mermaidSchema,
	tableSchema,
	statGridSchema,
	codeSchema,
	fieldNotesCardSchema,
	loadingSchema,
	comparisonSchema,
])

export const VisualizeParamsSchema = z.object({
	type: z.string(),
	data: z.record(z.string(), z.unknown()),
	intent: z.string(),
	title: z.string().optional(),
}).strict()
