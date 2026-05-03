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

export type ProviderFormat = 'openai' | 'anthropic' | 'anthropic-compatible';

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
	/**
	 * Fraction of the model context window at which the daemon compacts
	 * older messages. Persisted as a decimal in `[0.5, 0.95]`. The desktop
	 * UI surfaces this as an integer percentage (50–95). Defaults to 0.8
	 * on the daemon side when unset.
	 */
	compactionThreshold?: number;
}

/** A single model entry within a provider's model list. */
export interface RegistryModel {
	id: string;
	name: string;
}

/**
 * A model returned by the daemon's runtime model-list endpoint
 * (`POST /api/providers/models`). The daemon resolves the call against
 * the live provider, so the shape is identical to `RegistryModel` but
 * comes from the provider rather than the bundled registry.
 */
export interface FetchedModel {
	id: string;
	name: string;
}

/**
 * A provider entry from the bundled provider registry.
 * Mirrors the daemon's `RegistryProvider` type.
 */
export interface RegistryProvider {
	id: string;
	name: string;
	baseURL: string;
	format: 'openai' | 'anthropic-compatible';
	envVar: string[];
	iconSvg: string;
	docUrl: string;
	models: RegistryModel[];
}

// ─── MCP (Model Context Protocol) ────────────────────────────────────────────
//
// MCP servers expose tools that Elefant agents can call. A server is reached
// over one of three transports: a local stdio child process, or a remote
// streamable-http / sse endpoint. These types mirror the daemon's
// `mcpServerSchema` from `src/config/schema.ts`.

export type McpTransport = 'stdio' | 'sse' | 'streamable-http';

/**
 * Persisted MCP server configuration. Mirrors the daemon-side schema in
 * `src/config/schema.ts`. The transport-specific fields (`command`/`url`,
 * `env`/`headers`) are validated server-side as a discriminated union;
 * the desktop carries them all on a single shape for UI convenience.
 */
export interface McpServerConfig {
	id: string;
	name: string;
	transport: McpTransport;
	/** Required for stdio. argv-style: command[0] is the executable. */
	command?: string[];
	/** Required for sse / streamable-http. */
	url?: string;
	/** Extra environment variables for stdio child processes. */
	env?: Record<string, string>;
	/** Extra HTTP headers for remote transports. */
	headers?: Record<string, string>;
	enabled?: boolean;
	/** Connection / call timeout in milliseconds. Default 30_000. */
	timeout?: number;
	/** Tool names that should always be loaded for this server. */
	pinnedTools?: string[];
}

/**
 * A configured server enriched with live runtime status from the daemon.
 * Returned by `GET /api/mcp/servers`. The daemon attaches `status`, optional
 * `error`, and `toolCount` on top of the persisted `McpServerConfig`.
 */
export interface McpServerWithStatus extends McpServerConfig {
	status: 'connecting' | 'connected' | 'disabled' | 'failed';
	error?: string;
	toolCount?: number;
}

/**
 * Tool metadata as exposed by `GET /api/mcp/servers/:id/tools`. The
 * `inputSchema` is JSON Schema as returned by the upstream MCP server —
 * structure varies, so we keep it `unknown` and let the form layer pick
 * the bits it needs.
 */
export interface McpToolEntry {
	name: string;
	description: string;
	inputSchema: unknown;
	pinned: boolean;
}

/**
 * A registry entry — one curated/community/bundled MCP server discoverable
 * from the in-app registry browser.
 */
export interface RegistryEntry {
	id: string;
	source: 'anthropic' | 'smithery' | 'bundled';
	name: string;
	displayName: string;
	description: string;
	transport: McpTransport;
	command?: string[];
	url?: string;
	iconUrl?: string;
	useCases?: string[];
	oneLiner?: string;
}

/**
 * Response shape from `GET /api/mcp/registry`. Sectioned by source so the
 * UI can render Curated / Community / Bundled tabs without re-grouping.
 * Some daemons may flatten to `entries[]` for a single-source query —
 * support both shapes.
 */
export interface McpRegistryResponse {
	anthropic?: RegistryEntry[];
	smithery?: RegistryEntry[];
	bundled?: RegistryEntry[];
	entries?: RegistryEntry[];
	hasMore?: boolean;
}

/**
 * SSE event payload pushed by the daemon when an MCP server's connection
 * status changes (`mcp.status.changed`) or its tool list changes
 * (`mcp.tools.changed`). The desktop UI re-fetches the affected server
 * on receipt rather than mutating local state from the event payload.
 */
export interface McpStatusEvent {
	type: 'mcp.status.changed' | 'mcp.tools.changed';
	serverId: string;
	status?: McpServerWithStatus['status'];
	error?: string;
}
