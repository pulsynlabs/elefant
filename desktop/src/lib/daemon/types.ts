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

export interface VisualizeModelOverride {
	provider: string;
	model: string;
}

export type EmbeddingProviderName =
	| 'bundled-cpu'
	| 'bundled-gpu'
	| 'bundled-large'
	| 'ollama'
	| 'lm-studio'
	| 'vllm'
	| 'openai'
	| 'openai-compatible'
	| 'google'
	| 'disabled';

export interface ResearchProviderConfig {
	baseUrl?: string;
	apiKey?: string;
	model?: string;
	bundledModelId?: string;
}

export interface ResearchConfig {
	enabled: boolean;
	provider: EmbeddingProviderName;
	editorOverride?: string;
	providerConfig?: ResearchProviderConfig;
}

export interface ElefantConfig {
	port: number;
	providers: ProviderEntry[];
	defaultProvider: string;
	logLevel: LogLevel;
	hardwareAccelerationDisabled?: boolean;
	visualizeModelOverride?: VisualizeModelOverride | null;
	research?: ResearchConfig;
}

export interface ResearchHardwareProfile {
	ramGB: number;
	cpuCores: number;
	hasGPU: boolean;
	hasNPU: boolean;
	platform: 'linux' | 'darwin' | 'win32' | 'other';
	gpuName: string | null;
}

export type RecommendedTier = 'bundled-large' | 'bundled-gpu' | 'bundled-cpu';

export interface ResearchStatus {
	projectId: string;
	provider: EmbeddingProviderName;
	providerIsLocal: boolean;
	embeddingDim: number;
	vectorEnabled: boolean;
	recommendedTier: RecommendedTier | null;
	hardware: ResearchHardwareProfile | null;
	totalDocs: number;
	totalChunks: number;
	lastIndexedAt: string | null;
	driftCount: number;
	diskSizeBytes: number;
	indexExists: boolean;
}

// ─── Research tree, file, and search shapes ─────────────────────────────────
//
// Mirror the payloads served by `src/server/routes-research.ts`. Frontmatter
// is a permissive shape because the canonical Zod-validated definition lives
// in the daemon and the desktop only needs a handful of fields.

export interface ResearchFrontmatter {
	id?: string | null;
	title?: string;
	section?: string;
	tags?: string[];
	sources?: string[];
	confidence?: 'high' | 'medium' | 'low' | string;
	created?: string;
	updated?: string;
	author_agent?: string;
	workflow?: string | null;
	summary?: string;
	[key: string]: unknown;
}

export interface ResearchTreeFile {
	name: string;
	/** Section-relative path, e.g. `02-tech/sqlite-vec.md`. */
	path: string;
	title: string;
	summary: string;
	tags: string[];
	confidence: string;
	updated: string;
	research_link: string;
}

export interface ResearchTreeSection {
	/** Folder name, e.g. `02-tech`. */
	name: string;
	/** Human label, e.g. `Tech`. */
	label: string;
	files: ResearchTreeFile[];
}

export interface ResearchTree {
	sections: ResearchTreeSection[];
	/** ISO-8601 timestamp of when the tree was assembled. */
	lastRefreshed: string;
}

export interface ResearchFile {
	path: string;
	frontmatter: ResearchFrontmatter;
	/** Sanitized HTML rendered by the daemon. Empty when `meta=true`. */
	html: string;
	rawBody: string;
	research_link: string;
}

export interface ResearchSearchResult {
	path: string;
	section: string;
	title: string;
	summary: string;
	score: number;
	snippet: string;
	frontmatter: ResearchFrontmatter;
	research_link: string;
}

export type ResearchSearchMode = 'semantic' | 'keyword' | 'hybrid';

export interface ResearchSearchOptions {
	k?: number;
	section?: string;
	tags?: string[];
	mode?: ResearchSearchMode;
	minScore?: number;
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
