import type { ElefantError } from '../types/errors.ts'
import type { Message } from '../types/providers.ts'
import type { ToolCall, ToolDefinition, ToolResult } from '../types/tools.ts'

export interface TextDeltaEvent {
	type: 'text_delta'
	text: string
}

export interface ToolCallStartEvent {
	type: 'tool_call_start'
	toolCall: { id: string; name: string }
}

export interface ToolCallDeltaEvent {
	type: 'tool_call_delta'
	toolCallId: string
	argumentsDelta: string
}

export interface ToolCallCompleteEvent {
	type: 'tool_call_complete'
	toolCall: ToolCall
}

export interface StreamDoneEvent {
	type: 'done'
	finishReason: 'stop' | 'tool_calls' | 'length' | 'error'
}

export interface StreamErrorEvent {
	type: 'error'
	error: ElefantError
}

export interface ToolResultEvent {
	type: 'tool_result'
	toolResult: ToolResult
}

export interface UsageEvent {
	type: 'usage'
	inputTokens: number
	outputTokens: number
	cacheReadTokens?: number
	cacheWriteTokens?: number
}

export type StreamEvent =
	| TextDeltaEvent
	| ToolCallStartEvent
	| ToolCallDeltaEvent
	| ToolCallCompleteEvent
	| StreamDoneEvent
	| ToolResultEvent
	| StreamErrorEvent
	| UsageEvent

export interface SendMessageOptions {
	provider?: string
	model?: string
	temperature?: number
	topP?: number
	signal?: AbortSignal
}

export interface ProviderAdapter {
	name: string
	sendMessage(
		messages: Message[],
		tools: ToolDefinition[],
		options?: SendMessageOptions,
	): AsyncGenerator<StreamEvent>
}
