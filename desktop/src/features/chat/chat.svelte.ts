import type { ChatMessage, ContentBlock, ToolCallDisplay } from './types.js';
import type { QuestionEvent } from '$lib/daemon/types.js';
import type { AgentRunOverride } from '$lib/types/agent-config.js';

function generateId(): string {
	return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// Conversation state using Svelte 5 runes
let messages = $state<ChatMessage[]>([]);
let isStreaming = $state(false);
let streamingMessageId = $state<string | null>(null);
let selectedProvider = $state<string | null>(null);
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
export function buildChatRequestFields(sessionId?: string | null): {
	sessionId?: string;
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
	addUserMessage,
	startAssistantMessage,
	appendToken,
	addToolCall,
	addToolResult,
	addQuestion,
	finalizeMessage,
	setStreamingError,
	clearConversation,
	getApiMessages,
	setAvailableProviders,
};
