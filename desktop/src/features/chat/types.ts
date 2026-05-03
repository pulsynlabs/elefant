// Chat feature type definitions

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

export interface ToolCallDisplay {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
	result?: ToolResultDisplay;
	/**
	 * Optional metadata patched in by `chatStore.patchToolCallMetadata`
	 * when a `tool_call_metadata` SSE event arrives for this tool call.
	 *
	 * Today this is only populated for the `task` tool: the daemon emits
	 * one metadata event per spawn carrying the child runId, so the
	 * chat-surface `TaskToolCard` can resolve its child run without
	 * falling back to a title-match against the agent-runs store.
	 */
	metadata?: {
		runId: string;
		agentType: string;
		title: string;
		parentRunId?: string;
	};
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

/**
 * A saved snapshot of a conversation branch.
 * Created when the user forks the conversation at a user message.
 * Stores the message history up to (and including) the forked message,
 * along with metadata for navigation and parentage tracking.
 */
export interface ForkBranch {
	/** Unique identifier (crypto.randomUUID()) */
	id: string;
	/** Auto-derived label from first ~40 chars of the forked user message */
	label: string;
	/** When this branch was created */
	createdAt: Date;
	/** Deep clone (structuredClone) of messages[0..N] inclusive at fork time */
	messages: ChatMessage[];
	/** ID of the branch active at fork time; null if forking from root */
	parentBranchId: string | null;
}

/**
 * Ephemeral state for a side-context session triggered by /btw.
 * Lives only in memory on the chat store — never persisted to disk
 * and never pushed into forkBranches. Restored to mainSnapshot on exit.
 */
export interface SideContext {
	/** Snapshot of main-thread messages at entry (deep clone, restored on exit). */
	mainSnapshot: ChatMessage[];
	/** Side-context messages: starts as a clone of mainSnapshot, then user question + assistant reply append here. */
	messages: ChatMessage[];
	/** When the side context was entered. */
	enteredAt: Date;
	/** Original user question (the part after `/btw `). */
	question: string;
}
