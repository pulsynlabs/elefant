// Daemon API type definitions

export interface HealthResponse {
	ok: boolean;
	status: 'running';
	uptime: number;
	timestamp: string;
}

export interface ErrorResponse {
	ok: false;
	error: string;
	code?: string;
	details?: unknown;
}

export interface MessageRole {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	toolCalls?: ToolCallPayload[];
	toolCallId?: string;
}

export interface ToolCallPayload {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface ChatRequest {
	messages: MessageRole[];
	sessionId?: string;
	provider?: string;
	maxIterations?: number;
	maxTokens?: number;
	temperature?: number;
	topP?: number;
	timeoutMs?: number;
}

// SSE Event types (discriminated union)
export interface TokenEvent {
	type: 'token';
	text: string;
}

export interface ToolCallEvent {
	type: 'tool_call';
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface ToolResultEvent {
	type: 'tool_result';
	toolCallId: string;
	content: string;
	isError: boolean;
}

export interface DoneEvent {
	type: 'done';
	finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface ErrorEvent {
	type: 'error';
	code: string;
	message: string;
	details?: unknown;
}

export interface QuestionEvent {
	type: 'question';
	questionId: string;
	question: string;
	header: string;
	options: Array<{ label: string; description?: string }>;
	multiple: boolean;
	conversationId?: string;
}

export type ChatStreamEvent = TokenEvent | ToolCallEvent | ToolResultEvent | DoneEvent | ErrorEvent | QuestionEvent;

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type ProviderFormat = 'openai' | 'anthropic';

export interface ProviderEntry {
	name: string;
	baseURL: string;
	apiKey: string;
	model: string;
	format: ProviderFormat;
}

export interface ElefantConfig {
	port: number;
	providers: ProviderEntry[];
	defaultProvider: string;
	logLevel: LogLevel;
}
