// Daemon API type definitions

export interface HealthResponse {
	ok: boolean;
	status: 'running';
	uptime: number;
	timestamp: string;
	/** Absolute path to the daemon entry point. Used by the desktop app to restart. */
	entryPath?: string;
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
	projectId?: string;
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

/**
 * Fired once argument streaming is complete for an already-announced tool
 * call. The chat store patches the existing tool call block with the full
 * arguments so downstream cards (e.g. TaskToolCard) can show details.
 */
export interface ToolCallUpdateEvent {
	type: 'tool_call_update';
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

/**
 * Fired by the `task` tool at spawn time, alongside the project-level
 * `agent_run.spawned` event. Carries the child runId (and the agent
 * type, title, and parent runId) so `TaskToolCard` can resolve its
 * child run deterministically instead of title-matching against the
 * agent-runs store. Delivered through the chat SSE stream because the
 * tool-call → child-run pairing is a chat-local concern that must be
 * available even when the project SSE subscription hasn't hydrated
 * yet (and to survive stream replay).
 */
export interface ToolCallMetadataEvent {
	type: 'tool_call_metadata';
	toolCallId: string;
	runId: string;
	agentType: string;
	title: string;
	parentRunId?: string;
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

export type ChatStreamEvent =
	| TokenEvent
	| ToolCallEvent
	| ToolCallUpdateEvent
	| ToolCallMetadataEvent
	| ToolResultEvent
	| DoneEvent
	| ErrorEvent
	| QuestionEvent;

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
