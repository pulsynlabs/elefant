import type { ToolCall } from './tools.js';

export type ProviderFormat = 'openai' | 'anthropic' | 'anthropic-compatible';

export interface ProviderConfig {
	name: string;
	baseURL: string;
	apiKey: string;
	model: string;
	format: ProviderFormat;
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
	role: MessageRole;
	content: string;
	toolCalls?: ToolCall[];
	toolCallId?: string;
}

export type {
	ProviderAdapter,
	SendMessageOptions,
	StreamDoneEvent,
	StreamErrorEvent,
	StreamEvent,
	TextDeltaEvent,
	ToolCallCompleteEvent,
	ToolCallDeltaEvent,
	ToolResultEvent,
	ToolCallStartEvent,
} from '../providers/types.ts';
