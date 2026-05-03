import type { ChatMessage, ContentBlock, ForkBranch, ToolCallDisplay } from './types.js';
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

type UndoEntry = { user: ChatMessage; assistant: ChatMessage };

const MAX_FORK_BRANCHES = 20;

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

// Extended-thinking toggle state. The toggle lives in the chat input
// (UnifiedChatInput) and is reset to false on session change so that a
// new conversation starts in the "fast" default mode regardless of what
// the previous session was using. REQ-004 mandates a disabled-by-default
// fallback when capability is unknown — see currentModelSupportsThinking.
let thinkingEnabled = $state(false);

// Undo/redo stacks for chat message pair reversal. `undo()` pushes the
// last user+assistant pair onto both stacks and removes it from the
// visible message list; `redo()` pops from the redo stack and re-appends.
let undoStack = $state<UndoEntry[]>([]);
let redoStack = $state<UndoEntry[]>([]);

// Fork branch state for conversation branching
let forkBranches = $state<ForkBranch[]>([]);
let activeBranchId = $state<string | null>(null);

/**
 * Best-effort, client-side heuristic for whether the currently selected
 * model supports Anthropic-style extended thinking.
 *
 * The daemon does not (yet) expose a `supportsThinking` flag per model,
 * so we infer it from known model-id patterns. Conservative by design:
 * if the active provider/model is unknown or unrecognised we return
 * false, which leaves the toggle visible-but-disabled per REQ-004.
 *
 * Models known to support extended thinking as of early 2026:
 *   - Claude 3.7 family   (`claude-3-7-*`)
 *   - Claude Sonnet 4.x   (`claude-sonnet-4-*`)
 *   - Claude Opus 4.x     (`claude-opus-4-*`, `claude-4-*`)
 *
 * This is intentionally additive — it never blocks a send, only governs
 * the toggle's `disabled` state. If we mis-classify a model the user
 * still sends fine; they just see the toggle as disabled.
 */
const currentModelSupportsThinking = $derived.by(() => {
	const provider = selectedProvider ?? defaultProvider ?? (availableProviders[0] ?? null);
	if (!provider) return false;
	const lower = provider.toLowerCase();
	if (lower.includes('claude')) {
		return (
			lower.includes('3-7') ||
			lower.includes('sonnet-4') ||
			lower.includes('opus-4') ||
			lower.includes('claude-4')
		);
	}
	return false;
});

// Derive canUndo/canRedo once instead of repeating the guard in every
// call site. Both are false while streaming so the UI can't offer an
// undo/redo affordance mid-generation.
const canUndo = $derived(undoStack.length > 0 && !isStreaming);
const canRedo = $derived(redoStack.length > 0 && !isStreaming);
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
	redoStack = [];
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
	undoStack = [];
	redoStack = [];
	forkBranches = [];
	activeBranchId = null;
	streamingMessageId = null;
	isStreaming = false;
}

/**
 * Remove the last user+assistant message pair from `messages`, push it onto
 * both the undo and redo stacks, and return the user prompt text so callers
 * can restore it to the input field. Returns `null` when there is no complete
 * pair to undo or when a response is currently streaming.
 */
export function undo(): string | null {
	if (isStreaming) return null;

	// Walk messages from the end to find the last assistant message and its
	// immediately preceding user message — that is the "pair" to undo.
	let assistantIdx = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'assistant') {
			assistantIdx = i;
			break;
		}
	}
	if (assistantIdx === -1 || assistantIdx === 0) return null;

	const userIdx = assistantIdx - 1;
	if (messages[userIdx].role !== 'user') return null;

	const user = messages[userIdx];
	const assistant = messages[assistantIdx];
	const entry: UndoEntry = { user, assistant };

	// Remove the pair from the visible message list
	messages = [
		...messages.slice(0, userIdx),
		...messages.slice(assistantIdx + 1),
	];

	// Push to undo stack (FIFO-capped at 50)
	undoStack = [...undoStack, entry];
	if (undoStack.length > 50) undoStack = undoStack.slice(-50);

	// Populate redo stack so the pair can be restored
	redoStack = [...redoStack, entry];

	return user.content;
}

/**
 * Pop the most recently undone entry from the redo stack and re-append its
 * user and assistant messages to `messages`. Returns `false` when there is
 * nothing to redo or a response is currently streaming.
 */
export function redo(): boolean {
	if (isStreaming) return false;
	if (redoStack.length === 0) return false;

	const entry = redoStack[redoStack.length - 1];
	redoStack = redoStack.slice(0, -1);

	messages = [...messages, entry.user, entry.assistant];

	return true;
}

/**
 * Fork the conversation at the given user message index.
 *
 * Creates a ForkBranch snapshot capturing the message history up to and
 * including the forked message, truncates the visible message list to before
 * the fork point, and returns the forked user message text so the caller can
 * restore it to the chat input.
 *
 * The first fork in a conversation also creates an implicit "root" branch
 * capturing the pre-fork state so that `switchToBranch()` is symmetric from
 * the start.
 *
 * Returns `null` when the operation is a no-op (streaming, invalid index,
 * or the target message is not a user message).
 */
export function fork(messageIndex: number): string | null {
	if (isStreaming) return null;
	if (messageIndex < 0 || messageIndex >= messages.length) return null;
	if (messages[messageIndex].role !== 'user') return null;

	// First fork in a fresh conversation: create an implicit root branch
	// capturing the pre-fork state so switchToBranch is always symmetric.
	if (activeBranchId === null && forkBranches.length === 0) {
		const rootBranch: ForkBranch = {
			id: crypto.randomUUID(),
			label: 'Root',
			createdAt: new Date(),
			messages: structuredClone(messages),
			parentBranchId: null,
		};
		forkBranches = [...forkBranches, rootBranch];
		activeBranchId = rootBranch.id;
	}

	const userContent = messages[messageIndex].content;

	const newBranch: ForkBranch = {
		id: crypto.randomUUID(),
		label: userContent.slice(0, 40).trim(),
		createdAt: new Date(),
		messages: structuredClone(messages.slice(0, messageIndex + 1)),
		parentBranchId: activeBranchId,
	};

	// Push new branch; if over cap, drop oldest
	const next = [...forkBranches, newBranch];
	forkBranches = next.length > MAX_FORK_BRANCHES ? next.slice(-MAX_FORK_BRANCHES) : next;

	// Truncate messages to before the fork point
	messages = messages.slice(0, messageIndex);

	return userContent;
}

/**
 * Switch the conversation view to a previously forked branch.
 *
 * Saves the current message state as the active branch's snapshot (so
 * round-trip switching is lossless), restores the target branch's message
 * snapshot, updates `activeBranchId`, and clears the undo/redo stacks
 * (per-branch linear history).
 *
 * Returns `false` when the operation is a no-op (streaming or the target
 * branch does not exist).
 */
export function switchToBranch(branchId: string): boolean {
	if (isStreaming) return false;

	const target = forkBranches.find((b) => b.id === branchId);
	if (!target) return false;

	// Save current messages as the snapshot for the currently active branch
	if (activeBranchId !== null) {
		forkBranches = forkBranches.map((b) =>
			b.id === activeBranchId ? { ...b, messages: structuredClone(messages) } : b,
		);
	}
	// If activeBranchId is null (switching from implicit root — shouldn't
	// normally happen if fork() always creates root first, but handle
	// defensively): skip the snapshot save; root state is lost.

	// Restore target branch's message snapshot
	messages = structuredClone(target.messages);

	// Update active branch
	activeBranchId = branchId;

	// Reset undo/redo stacks — each branch has its own linear history
	undoStack = [];
	redoStack = [];

	return true;
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

/**
 * Toggle or set extended-thinking mode for the active session.
 *
 * Pure setter — UnifiedChatInput calls this when the user clicks the
 * ThinkingToggle pill. State is intentionally session-scoped: it resets
 * to false whenever the active session changes (see setActiveSession).
 */
export function setThinkingEnabled(next: boolean): void {
	thinkingEnabled = next;
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
	get thinkingEnabled() {
		return thinkingEnabled;
	},
	get currentModelSupportsThinking() {
		return currentModelSupportsThinking;
	},
	get canUndo() {
		return canUndo;
	},
	get canRedo() {
		return canRedo;
	},
	get redoCount() {
		return redoStack.length;
	},
	get forkBranches() {
		return forkBranches;
	},
	get activeBranchId() {
		return activeBranchId;
	},
	get forkBranchCount() {
		return forkBranches.length;
	},
	setActiveSession: (id: string | null) => {
		activeSessionId = id;
		// Each session starts in "fast" mode — the toggle is opt-in per
		// conversation. This avoids surprising users who turned thinking on
		// in a previous session and then opened a fresh one.
		thinkingEnabled = false;
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
	setThinkingEnabled,
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
	undo,
	redo,
	fork,
	switchToBranch,
	getApiMessages,
	setAvailableProviders,
};
