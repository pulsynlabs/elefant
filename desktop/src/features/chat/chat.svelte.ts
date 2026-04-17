import type { ChatMessage, ContentBlock, ToolCallDisplay } from './types.js';

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

// Available providers (populated from config)
let availableProviders = $state<string[]>([]);
let defaultProvider = $state<string | null>(null);

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
	get availableProviders() {
		return availableProviders;
	},
	get defaultProvider() {
		return defaultProvider;
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
	addUserMessage,
	startAssistantMessage,
	appendToken,
	addToolCall,
	addToolResult,
	finalizeMessage,
	setStreamingError,
	clearConversation,
	getApiMessages,
	setAvailableProviders,
};
