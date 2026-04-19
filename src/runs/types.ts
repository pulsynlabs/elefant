import { z } from 'zod'

export const AgentRunStatusSchema = z.enum(['running', 'done', 'error', 'cancelled'])
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>

export const AgentRunContextModeSchema = z.enum(['none', 'inherit_session', 'snapshot'])
export type AgentRunContextMode = z.infer<typeof AgentRunContextModeSchema>

export const AgentRunRowSchema = z.object({
	run_id: z.string().min(1),
	session_id: z.string().min(1),
	project_id: z.string().min(1),
	parent_run_id: z.string().min(1).nullable(),
	agent_type: z.string().min(1),
	title: z.string().min(1),
	status: AgentRunStatusSchema,
	created_at: z.string(),
	started_at: z.string(),
	ended_at: z.string().nullable(),
	context_mode: AgentRunContextModeSchema,
	error_message: z.string().nullable(),
})
export type AgentRunRow = z.infer<typeof AgentRunRowSchema>

export const InsertAgentRunSchema = AgentRunRowSchema.partial({
	created_at: true,
	started_at: true,
	ended_at: true,
	error_message: true,
	status: true,
}).extend({
	run_id: z.string().min(1).optional().default(() => crypto.randomUUID()),
	session_id: z.string().min(1),
	project_id: z.string().min(1),
	parent_run_id: z.string().min(1).nullable().optional(),
	agent_type: z.string().min(1),
	title: z.string().min(1),
	context_mode: AgentRunContextModeSchema,
	status: AgentRunStatusSchema.optional().default('running'),
})
export type InsertAgentRun = z.infer<typeof InsertAgentRunSchema>

export interface RunContext {
	runId: string
	parentRunId?: string
	depth: number
	agentType: string
	title: string
	sessionId: string
	projectId: string
	signal: AbortSignal
}

export interface AgentRunEventEnvelope {
	ts: string
	projectId: string
	sessionId: string
	runId: string
	parentRunId: string | null
	agentType: string
	title: string
	seq: number
	type: string
	data: unknown
}

export interface AgentRunStatusChangedData {
	runId: string
	sessionId: string
	projectId: string
	parentRunId?: string
	agentType: string
	title: string
	previousStatus: AgentRunStatus
	nextStatus: AgentRunStatus
	reason?: string
}

export type AgentRunToolCallMetadataData = {
	toolCallId: string
	runId: string
	parentRunId?: string
	agentType: string
	title: string
}
