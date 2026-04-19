// Agent run types for the desktop UI layer.
//
// These mirror the daemon shapes returned by `/api/agent-runs/*` and
// the SSE envelopes published on the project event stream.

export type AgentRunStatus = 'running' | 'done' | 'error' | 'cancelled';

export type AgentRunContextMode = 'none' | 'inherit_session' | 'snapshot';

export interface AgentRun {
	runId: string;
	sessionId: string;
	projectId: string;
	parentRunId: string | null;
	agentType: string;
	title: string;
	status: AgentRunStatus;
	contextMode: AgentRunContextMode;
	createdAt: string;
	startedAt: string | null;
	endedAt: string | null;
	errorMessage: string | null;
}

/**
 * Envelope every `agent_run.*` SSE event ships with. The daemon publishes
 * via `publishRunEvent` in `src/runs/events.ts`.
 */
export interface AgentRunEventEnvelope {
	ts: string;
	projectId: string;
	sessionId: string;
	runId: string;
	parentRunId: string | null;
	agentType: string;
	title: string;
	seq: number;
	type: string;
	data: unknown;
}

/** An entry in a run's rendered transcript. */
export type AgentRunTranscriptEntry =
	| { kind: 'token'; text: string; seq: number }
	| { kind: 'tool_call'; id: string; name: string; arguments: Record<string, unknown>; seq: number }
	| {
			kind: 'tool_result';
			toolCallId: string;
			content: string;
			isError: boolean;
			seq: number;
	  }
	| {
			kind: 'question';
			questionId: string;
			question: string;
			options: Array<{ label: string; description?: string }>;
			multiple: boolean;
			seq: number;
	  }
	| { kind: 'terminal'; status: AgentRunStatus; message: string; seq: number };

/**
 * Node shape used by `AgentRunTree` — a run plus its direct children.
 * Children are pre-sorted by `createdAt`.
 */
export interface AgentRunTreeNode {
	run: AgentRun;
	children: AgentRunTreeNode[];
}

/** Daemon wraps success responses as `{ ok: true, data }`. */
export type DaemonResult<T> =
	| { ok: true; data: T }
	| { ok: false; error: string | { code?: string; message?: string } };

/** Raw agent-run row returned by the daemon (snake_case). */
export interface AgentRunRow {
	run_id: string;
	session_id: string;
	project_id: string;
	parent_run_id: string | null;
	agent_type: string;
	title: string;
	status: AgentRunStatus;
	context_mode: AgentRunContextMode;
	created_at: string;
	started_at: string | null;
	ended_at: string | null;
	error_message: string | null;
}

/** Data payload for `agent_run.status_changed` events. */
export interface AgentRunStatusChangedData {
	runId: string;
	sessionId: string;
	projectId: string;
	parentRunId?: string;
	title: string;
	previousStatus: AgentRunStatus;
	nextStatus: AgentRunStatus;
	reason?: string;
}

/** Convert a daemon row (snake_case) to the UI `AgentRun` (camelCase). */
export function agentRunFromRow(row: AgentRunRow): AgentRun {
	return {
		runId: row.run_id,
		sessionId: row.session_id,
		projectId: row.project_id,
		parentRunId: row.parent_run_id,
		agentType: row.agent_type,
		title: row.title,
		status: row.status,
		contextMode: row.context_mode,
		createdAt: row.created_at,
		startedAt: row.started_at,
		endedAt: row.ended_at,
		errorMessage: row.error_message,
	};
}
