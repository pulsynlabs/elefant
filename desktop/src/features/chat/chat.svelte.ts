import type { ChatMessage, ContentBlock, ToolCallDisplay } from './types.js';
import type { QuestionEvent } from '$lib/daemon/types.js';
import type { AgentRunOverride } from '$lib/types/agent-config.js';
import { getDaemonClient } from '$lib/daemon/client.js';
import {
	saveSessionHistory,
	loadSessionHistory as loadFromStore,
} from '$lib/services/chat-history.js';

function generateId(): string {
	return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// Conversation state using Svelte 5 runes
let messages = $state<ChatMessage[]>([]);
let isStreaming = $state(false);
let streamingMessageId = $state<string | null>(null);
let selectedProvider = $state<string | null>(null);
// Tracked so finalizeMessage can auto-persist without needing an extra param.
let activeSessionId = $state<string | null>(null);
let maxIterations = $state(50);
let maxTokens = $state(4096);
let temperature = $state(1.0);
let topP = $state(1.0);
let timeoutMs = $state(60000);

// Available providers (populated from config)
let availableProviders = $state<string[]>([]);
let defaultProvider = $state<string | null>(null);

// Per-run agent override applied to the NEXT chat POST. Confirmed via
// AgentOverrideDialog from the composer. Each field is optional so the
// UI can clear individual slots without nuking the whole override.
let agentOverride = $state<AgentRunOverride>({});

export function setAvailableProviders(providers: string[], def: string | null): void {
	availableProviders = providers;
	defaultProvider = def;
	if (!selectedProvider && def) {
		selectedProvider = def;
	}
}

export function addUserMessage(content: string): ChatMessage {
	const msg: ChatMessage = {
		id: generateId(),
		role: 'user',
		content,
		timestamp: new Date(),
	};
	messages = [...messages, msg];
	return msg;
}

export function startAssistantMessage(): string {
	const id = generateId();
	const msg: ChatMessage = {
		id,
		role: 'assistant',
		content: '',
		blocks: [],
		isStreaming: true,
		timestamp: new Date(),
	};
	messages = [...messages, msg];
	streamingMessageId = id;
	isStreaming = true;
	return id;
}

export function appendToken(text: string): void {
	if (!streamingMessageId) return;

	messages = messages.map((msg) => {
		if (msg.id !== streamingMessageId) return msg;
		const updated = { ...msg, content: msg.content + text };

		// Update the last text block or create one
		const blocks: ContentBlock[] = [...(msg.blocks ?? [])];
		const lastBlock = blocks[blocks.length - 1];
		if (lastBlock?.type === 'text') {
			blocks[blocks.length - 1] = { type: 'text', text: lastBlock.text + text };
		} else {
			blocks.push({ type: 'text', text });
		}
		updated.blocks = blocks;
		return updated;
	});
}

export function addToolCall(toolCall: ToolCallDisplay): void {
	if (!streamingMessageId) return;

	messages = messages.map((msg) => {
		if (msg.id !== streamingMessageId) return msg;
		const blocks: ContentBlock[] = [...(msg.blocks ?? []), { type: 'tool_call', toolCall }];
		return { ...msg, blocks };
	});
}

/**
 * Patch the arguments on an already-rendered tool call block once streaming
 * is complete. Called when a `tool_call_update` event arrives — the card was
 * already rendered on `tool_call` (with empty args); this fills in the full
 * arguments so cards like TaskToolCard can resolve their description/agent_type.
 */
export function updateToolCallArguments(toolCallId: string, args: Record<string, unknown>): void {
	if (!streamingMessageId) return;

	messages = messages.map((msg) => {
		if (msg.id !== streamingMessageId) return msg;

		const blocks: ContentBlock[] = (msg.blocks ?? []).map((block) => {
			if (block.type === 'tool_call' && block.toolCall.id === toolCallId) {
				return {
					...block,
					toolCall: {
						...block.toolCall,
						arguments: args,
					},
				};
			}
			return block;
		});

		return { ...msg, blocks };
	});
}

/**
 * Patch daemon-supplied metadata onto an already-rendered tool call block.
 *
 * Fired when a `tool_call_metadata` SSE event arrives. Today the `task`
 * tool is the only producer — it emits metadata at spawn time so
 * `TaskToolCard` can resolve its child run deterministically via
 * `metadata.runId` instead of title-matching against the agent-runs
 * store. Mirrors `updateToolCallArguments` exactly: find the tool call
 * block by id inside the currently-streaming assistant message and
 * replace its `metadata` field with a fresh object so Svelte's reactive
 * derivations re-run.
 */
export function patchToolCallMetadata(
	toolCallId: string,
	metadata: { runId: string; agentType: string; title: string; parentRunId?: string },
): void {
	if (!streamingMessageId) return;

	messages = messages.map((msg) => {
		if (msg.id !== streamingMessageId) return msg;

		const blocks: ContentBlock[] = (msg.blocks ?? []).map((block) => {
			if (block.type === 'tool_call' && block.toolCall.id === toolCallId) {
				return {
					...block,
					toolCall: {
						...block.toolCall,
						metadata,
					},
				};
			}
			return block;
		});

		return { ...msg, blocks };
	});
}

export function addToolResult(toolCallId: string, content: string, resultIsError: boolean): void {
	if (!streamingMessageId) return;

	messages = messages.map((msg) => {
		if (msg.id !== streamingMessageId) return msg;

		const blocks: ContentBlock[] = (msg.blocks ?? []).map((block) => {
			if (block.type === 'tool_call' && block.toolCall.id === toolCallId) {
				return {
					...block,
					toolCall: {
						...block.toolCall,
						result: { toolCallId, content, isError: resultIsError },
					},
				};
			}
			return block;
		});

		return { ...msg, blocks };
	});
}

export function addQuestion(event: QuestionEvent): void {
	if (!streamingMessageId) return;

	// Create a virtual tool call for the question so it renders as a ToolCallDisplay
	const toolCall: ToolCallDisplay = {
		id: event.questionId,
		name: 'question',
		arguments: {
			questions: [{
				question: event.question,
				header: event.header,
				options: event.options,
				multiple: event.multiple,
			}],
			conversationId: event.conversationId,
		},
	};

	messages = messages.map((msg) => {
		if (msg.id !== streamingMessageId) return msg;
		const blocks: ContentBlock[] = [...(msg.blocks ?? []), { type: 'tool_call', toolCall }];
		return { ...msg, blocks };
	});
}

export function finalizeMessage(_finishReason: string): void {
	if (!streamingMessageId) return;

	messages = messages.map((msg) => {
		if (msg.id !== streamingMessageId) return msg;
		return { ...msg, isStreaming: false };
	});

	streamingMessageId = null;
	isStreaming = false;

	// Persist after every completed turn so session restore always has
	// up-to-date history. Fire-and-forget — never block the UI.
	if (activeSessionId) {
		void saveSessionHistory(activeSessionId, messages);
	}
}

export function setStreamingError(error: string): void {
	if (!streamingMessageId) return;

	messages = messages.map((msg) => {
		if (msg.id !== streamingMessageId) return msg;
		return { ...msg, isStreaming: false, isError: true, errorMessage: error };
	});

	streamingMessageId = null;
	isStreaming = false;
}

export function clearConversation(): void {
	messages = [];
	streamingMessageId = null;
	isStreaming = false;
}

/**
 * Map daemon MessageRow records into ChatMessage display objects.
 * Only user and assistant roles are rendered; tool_call/tool_result/system are dropped.
 */
function mapDaemonMessages(rows: Array<{
	id: number; role: string; content: string; created_at: string;
}>): ChatMessage[] {
	return rows
		.filter((r) => r.role === 'user' || r.role === 'assistant')
		.map((r) => ({
			id: String(r.id),
			role: r.role as 'user' | 'assistant',
			content: r.content,
			timestamp: new Date(r.created_at),
			...(r.role === 'assistant'
				? { blocks: [{ type: 'text' as const, text: r.content }] }
				: {}),
		}));
}

/**
 * Load session history and populate the messages array.
 *
 * Strategy (in order):
 * 1. Tauri Store — for sessions that have been active since persistence
 *    was added. Fast, works offline.
 * 2. Daemon DB — for older sessions. Fetches root-level agent run
 *    messages (user + assistant only) from the daemon API.
 */
export async function loadSessionHistory(projectId: string, sessionId: string): Promise<void> {
	activeSessionId = sessionId;

	// Strategy 1: local Tauri Store
	try {
		const stored = await loadFromStore(sessionId);
		if (stored.length > 0) {
			messages = stored;
			return;
		}
	} catch {
		// Fall through to daemon
	}

	// Strategy 2: daemon DB (root runs only — no child agent runs)
	try {
		const client = getDaemonClient();
		const rows = await client.fetchSessionMessages(projectId, sessionId);
		const mapped = mapDaemonMessages(rows);
		if (mapped.length > 0) {
			messages = mapped;
			// Backfill the Tauri Store so next load is instant
			void saveSessionHistory(sessionId, mapped);
		}
	} catch (err) {
		console.error('[chatStore] loadSessionHistory daemon fallback failed:', err);
	}
}

// Build the API message array from conversation history
export function getApiMessages(): Array<{ role: string; content: string }> {
	return messages.map((msg) => ({
		role: msg.role,
		content: msg.content,
	}));
}

/**
 * Build the chat-request payload fields contributed by this store.
 *
 * Field precedence: agent override (set via AgentOverrideDialog) wins
 * over the AdvancedOptions values. Fields set to `0` or `undefined` are
 * omitted rather than sent as falsy so the daemon uses its defaults.
 *
 * Kept pure / dependency-free so it can be unit-tested without a
 * component test runner.
 */
export function buildChatRequestFields(sessionId?: string | null, projectId?: string | null): {
	sessionId?: string;
	projectId?: string;
	provider?: string;
	maxIterations: number;
	maxTokens?: number;
	temperature: number;
	topP: number;
	timeoutMs: number;
} {
	const provider = agentOverride.provider ?? selectedProvider ?? undefined;

	const resolvedMaxTokens =
		agentOverride.maxTokens !== undefined
			? agentOverride.maxTokens
			: maxTokens > 0
				? maxTokens
				: undefined;

	return {
		...(sessionId ? { sessionId } : {}),
		...(projectId ? { projectId } : {}),
		provider,
		maxIterations: agentOverride.maxIterations ?? maxIterations,
		maxTokens: resolvedMaxTokens,
		temperature: agentOverride.temperature ?? temperature,
		topP: agentOverride.topP ?? topP,
		timeoutMs: agentOverride.timeoutMs ?? timeoutMs,
	};
}

/** Snapshot the active override for display / diffing. */
export function getAgentOverride(): AgentRunOverride {
	return { ...agentOverride };
}

/** Replace the active override. Passing `{}` clears it. */
export function setAgentOverride(next: AgentRunOverride): void {
	agentOverride = { ...next };
}

/** Clear all override fields. */
export function clearAgentOverride(): void {
	agentOverride = {};
}

/** True when any override field is currently set. */
export function hasAgentOverride(): boolean {
	return Object.values(agentOverride).some((v) => v !== undefined);
}

export const chatStore = {
	get messages() {
		return messages;
	},
	get isStreaming() {
		return isStreaming;
	},
	get selectedProvider() {
		return selectedProvider;
	},
	get maxIterations() {
		return maxIterations;
	},
	get maxTokens() {
		return maxTokens;
	},
	get temperature() {
		return temperature;
	},
	get topP() {
		return topP;
	},
	get timeoutMs() {
		return timeoutMs;
	},
	get availableProviders() {
		return availableProviders;
	},
	get defaultProvider() {
		return defaultProvider;
	},
	get agentOverride() {
		return agentOverride;
	},
	get hasAgentOverride() {
		return hasAgentOverride();
	},
	setActiveSession: (id: string | null) => {
		activeSessionId = id;
	},
	setProvider: (p: string | null) => {
		selectedProvider = p;
	},
	setMaxIterations: (n: number) => {
		maxIterations = n;
	},
	setMaxTokens: (n: number) => {
		maxTokens = n;
	},
	setTemperature: (n: number) => {
		temperature = n;
	},
	setTopP: (n: number) => {
		topP = n;
	},
	setTimeoutMs: (n: number) => {
		timeoutMs = n;
	},
	setAgentOverride,
	clearAgentOverride,
	getAgentOverride,
	buildChatRequestFields,
	loadSessionHistory,
	addUserMessage,
	startAssistantMessage,
	appendToken,
	addToolCall,
	updateToolCallArguments,
	patchToolCallMetadata,
	addToolResult,
	addQuestion,
	finalizeMessage,
	setStreamingError,
	clearConversation,
	getApiMessages,
	setAvailableProviders,
};
