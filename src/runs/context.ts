import type { Message } from '../types/providers.ts'
import type { AgentRunContextMode, RunContext } from './types.ts'

export interface SessionMessagesReader {
	getSessionMessages(sessionId: string): Message[]
}

export interface BuildInitialMessagesContext {
	contextMode: AgentRunContextMode
	sessionId: string
	db: SessionMessagesReader
}

export interface InitialMessagesSource {
	contextMode: AgentRunContextMode
	getMessages: () => Message[]
}

export type CreateRunContextInput = Omit<RunContext, 'discoveredTools'> & {
	discoveredTools?: Set<string>
}

export function createRunContext(input: CreateRunContextInput): RunContext {
	return {
		...input,
		discoveredTools: input.discoveredTools ?? new Set<string>(),
	}
}

function cloneMessages(messages: Message[]): Message[] {
	return messages.map((message) => ({
		...message,
		toolCalls: message.toolCalls ? [...message.toolCalls] : undefined,
	}))
}

export function buildInitialMessages(ctx: BuildInitialMessagesContext): InitialMessagesSource {
	if (ctx.contextMode === 'none') {
		return {
			contextMode: 'none',
			getMessages: () => [],
		}
	}

	if (ctx.contextMode === 'snapshot') {
		const snapshot = cloneMessages(ctx.db.getSessionMessages(ctx.sessionId))
		return {
			contextMode: 'snapshot',
			getMessages: () => snapshot,
		}
	}

	return {
		contextMode: 'inherit_session',
		getMessages: () => ctx.db.getSessionMessages(ctx.sessionId),
	}
}
