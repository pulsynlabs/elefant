// Chat feature type definitions

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

export interface ToolCallDisplay {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
	result?: ToolResultDisplay;
}

export interface ToolResultDisplay {
	toolCallId: string;
	content: string;
	isError: boolean;
}

export type ContentBlock =
	| { type: 'text'; text: string }
	| { type: 'tool_call'; toolCall: ToolCallDisplay }
	| { type: 'tool_result'; result: ToolResultDisplay };

export interface ChatMessage {
	id: string;
	role: MessageRole;
	content: string;
	blocks?: ContentBlock[];
	isStreaming?: boolean;
	isError?: boolean;
	errorMessage?: string;
	timestamp: Date;
}
