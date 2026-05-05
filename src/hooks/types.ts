import type { Message } from '../types/providers.ts';
import type { ToolResult } from '../types/tools.ts';
import type {
	PermissionDecisionStatus,
	Risk,
} from '../permissions/types.ts';

export interface ToolBeforeContext {
	readonly toolName: string;
	readonly args: Readonly<Record<string, unknown>>;
	readonly conversationId: string;
	readonly veto?: boolean;
	readonly error?: {
		readonly code: string;
		readonly message: string;
		readonly expected?: readonly string[];
		readonly actual?: string;
		readonly tool?: string;
	};
}

export interface ToolAfterContext {
	readonly toolName: string;
	readonly args: Readonly<Record<string, unknown>>;
	readonly result: ToolResult;
	readonly durationMs: number;
	readonly conversationId: string;
}

export interface MessageBeforeContext {
	readonly messages: readonly Message[];
	readonly provider: string;
	readonly model: string;
	readonly runId?: string;
	readonly sessionId?: string;
	readonly projectId?: string;
}

export interface MessageAfterContext {
	readonly messages: readonly Message[];
	readonly provider: string;
	readonly model: string;
	readonly durationMs: number;
	readonly runId?: string;
	readonly sessionId?: string;
	readonly projectId?: string;
}

export interface StreamStartContext {
	readonly provider: string;
	readonly model: string;
	readonly conversationId: string;
}

export interface StreamEndContext {
	readonly provider: string;
	readonly model: string;
	readonly conversationId: string;
	readonly totalTokens?: number;
}

export interface ShutdownContext {
	readonly reason: 'SIGTERM' | 'SIGINT' | 'manual';
}

export interface HookContextMap {
	'tool:before': ToolBeforeContext;
	'tool:after': ToolAfterContext;
	'message:before': MessageBeforeContext;
	'message:after': MessageAfterContext;
	'stream:start': StreamStartContext;
	'stream:end': StreamEndContext;
	shutdown: ShutdownContext;
	'project:open': {
		readonly projectId: string;
		readonly projectPath: string;
		readonly elefantDir: string;
	};
	'project:close': {
		readonly projectId: string;
	};
	'session:start': {
		readonly sessionId: string;
		readonly projectId: string;
		readonly conversationId: string;
	};
	'session:end': {
		readonly sessionId: string;
		readonly projectId: string;
		readonly totalTokens?: number;
	};
	'session:pre_compact': {
		readonly messages: readonly Message[];
		readonly tokenCount: number;
		readonly contextWindow: number;
		readonly sessionId: string;
		readonly conversationId: string;
	};
	'session:compact': {
		readonly messages: readonly import('../types/providers.ts').Message[];
		readonly tokenCount: number;
		readonly contextWindow: number;
		readonly summary?: string;
	};
	'session:post_compact': {
		readonly messagesBefore: readonly Message[];
		readonly messagesAfter: readonly Message[];
		readonly tokenCountBefore: number;
		readonly tokenCountAfter: number;
		readonly summary: string;
		readonly didCompact: boolean;
		readonly skipReason?: 'pending_tool_call' | 'hook_cancelled';
		readonly sessionId: string;
		readonly conversationId: string;
	};
	'context:transform': {
		readonly system: string[];
		readonly sessionId: string;
		readonly phase?: string;
	};
	'system:transform': {
		readonly messages: Message[];
		readonly sessionId: string;
		readonly conversationId: string;
		readonly runId?: string;
		readonly projectId?: string;
		readonly state: unknown;
		readonly budgets: {
			readonly tokens: number;
		};
	};
	'permission:ask': {
		readonly tool: string;
		readonly args: Readonly<Record<string, unknown>>;
		readonly conversationId: string;
		readonly sessionId?: string;
		readonly projectId?: string;
		readonly agent?: string;
		readonly risk: Risk;
		readonly classification?: Risk;
		readonly status?: PermissionDecisionStatus;
		readonly reason?: string;
	};
	'tool:block': {
		readonly tool: string;
		readonly reason: string;
		readonly conversationId: string;
	};
	'tool:allow': {
		readonly tool: string;
		readonly conversationId: string;
	};
	'wf:locked': { readonly workflowId: string; readonly projectId: string; readonly lockedAt: string };
	'wf:unlocked': { readonly workflowId: string; readonly projectId: string };
	'wf:amended': { readonly workflowId: string; readonly projectId: string; readonly version: number; readonly rationale: string };
	'wf:phase_transitioned': { readonly workflowId: string; readonly projectId: string; readonly from: string; readonly to: string; readonly forced: boolean };
	'blueprint:created': { readonly workflowId: string; readonly projectId: string };
	'wave:started': { readonly workflowId: string; readonly projectId: string; readonly waveNumber: number; readonly taskCount: number };
	'wave:completed': { readonly workflowId: string; readonly projectId: string; readonly waveNumber: number };
	'task:assigned': { readonly workflowId: string; readonly projectId: string; readonly taskId: string; readonly agentRunId: string };
	'task:completed': { readonly workflowId: string; readonly projectId: string; readonly taskId: string };
	'spec:acceptance_confirmed': {
		readonly projectId: string;
		readonly workflowId: string;
		readonly confirmedAt: string;
	};
}

export type HookEventName = keyof HookContextMap;
export type HookResult<E extends HookEventName> =
	| void
	| { cancel: true }
	| Partial<HookContextMap[E]>;
export type HookHandler<E extends HookEventName> = (
	context: HookContextMap[E],
) => Promise<HookResult<E>> | HookResult<E>;
export type Disposer = () => void;

export const HOOK_EVENT_NAMES: readonly HookEventName[] = [
	'tool:before',
	'tool:after',
	'message:before',
	'message:after',
	'stream:start',
	'stream:end',
	'shutdown',
	'project:open',
	'project:close',
	'session:start',
	'session:end',
	'session:pre_compact',
	'session:compact',
	'session:post_compact',
	'context:transform',
	'system:transform',
	'permission:ask',
	'tool:block',
	'tool:allow',
	'wf:locked',
	'wf:unlocked',
	'wf:amended',
	'wf:phase_transitioned',
	'blueprint:created',
	'wave:started',
	'wave:completed',
	'task:assigned',
	'task:completed',
	'spec:acceptance_confirmed',
];
