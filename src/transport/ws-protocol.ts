import { z } from 'zod'

export const JoinMessageSchema = z.object({
	type: z.literal('join'),
	room: z.string(),
})

export const LeaveMessageSchema = z.object({
	type: z.literal('leave'),
	room: z.string(),
})

export const PingMessageSchema = z.object({
	type: z.literal('ping'),
	ts: z.number(),
})

export const PongMessageSchema = z.object({
	type: z.literal('pong'),
	ts: z.number(),
})

export const ApprovalResponseSchema = z.object({
	type: z.literal('approval:response'),
	requestId: z.string(),
	approved: z.boolean(),
	reason: z.string().optional(),
})

export const ClientMessageSchema = z.discriminatedUnion('type', [
	JoinMessageSchema,
	LeaveMessageSchema,
	PingMessageSchema,
	PongMessageSchema,
	ApprovalResponseSchema,
])

export type ClientMessage = z.infer<typeof ClientMessageSchema>

export interface ApprovalRequest {
	type: 'approval:request'
	requestId: string
	tool: string
	args: Record<string, unknown>
	risk: 'low' | 'medium' | 'high'
	conversationId: string
	timeoutMs: number
}

export interface PingServerMessage {
	type: 'ping'
	ts: number
}

export interface EventMessage {
	type: 'event'
	event: string
	data: unknown
}

export type ServerMessage = ApprovalRequest | PingServerMessage | EventMessage

export function serializeMessage(msg: ServerMessage): string {
	return JSON.stringify(msg)
}

export function parseClientMessage(raw: string | Buffer | Uint8Array): ClientMessage | null {
	try {
		const text = typeof raw === 'string' ? raw : Buffer.from(raw).toString()
		const parsed = JSON.parse(text)
		const result = ClientMessageSchema.safeParse(parsed)
		return result.success ? result.data : null
	} catch {
		return null
	}
}
