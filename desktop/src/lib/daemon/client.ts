import type {
	HealthResponse,
	ChatRequest,
	ChatStreamEvent,
	ProviderEntry,
} from './types.js';
import { parseSSEStream } from './sse-parser.js';

/**
 * Agent run record from the daemon (snake_case fields as returned by the API).
 */
export interface AgentRun {
	run_id: string;
	session_id: string;
	project_id: string;
	parent_run_id: string | null;
	agent_type: string;
	title: string;
	status: 'running' | 'done' | 'error' | 'cancelled';
	created_at: string;
	started_at: string;
	ended_at: string | null;
	context_mode: 'none' | 'inherit_session' | 'snapshot';
	error_message: string | null;
}

/**
 * Message row from the daemon (snake_case fields as returned by the API).
 */
export interface MessageRow {
	id: number;
	run_id: string;
	seq: number;
	role: 'system' | 'user' | 'assistant' | 'tool_call' | 'tool_result';
	content: string;
	tool_name: string | null;
	created_at: string;
}

// Default daemon URL — consumed by events.ts (SSE) and approvals.ts (WebSocket).
// Keep in sync with `settingsStore.daemonUrl` when users customise the port.
export const DAEMON_URL = 'http://localhost:1337';

// Eden Treaty client (future wiring):
//
// When the daemon is published as `@elefant/daemon` (or this app is in the
// same workspace as `src/index.ts`), swap the raw fetch calls below for a
// fully typed treaty client:
//
//   import { treaty } from '@elysiajs/eden';
//   import type { App } from '@elefant/daemon';
//   export const api = treaty<App>(DAEMON_URL);
//
// SSE streams (chat, project events) should still use the native `fetch` /
// `EventSource` paths — treaty does not wrap streaming responses cleanly.

export class DaemonClient {
	private baseUrl: string;
	private timeout: number;

	constructor(baseUrl: string = 'http://localhost:1337', timeout: number = 5000) {
		this.baseUrl = baseUrl;
		this.timeout = timeout;
	}

	setBaseUrl(url: string): void {
		this.baseUrl = url;
	}

	getBaseUrl(): string {
		return this.baseUrl;
	}

	async checkHealth(): Promise<HealthResponse> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.timeout);

		try {
			const response = await fetch(`${this.baseUrl}/health`, {
				signal: controller.signal,
				headers: { 'Accept': 'application/json' },
			});

			if (!response.ok) {
				throw new Error(`Health check failed: HTTP ${response.status}`);
			}

			const data = await response.json() as HealthResponse;
			return data;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	async *streamChat(
		request: ChatRequest,
		signal?: AbortSignal
	): AsyncGenerator<ChatStreamEvent> {
		const response = await fetch(`${this.baseUrl}/api/chat`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'text/event-stream',
			},
			body: JSON.stringify(request),
			signal,
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Unknown error');
			throw new Error(`Chat request failed: HTTP ${response.status} — ${errorText}`);
		}

		if (!response.body) {
			throw new Error('No response body for SSE stream');
		}

		yield* parseSSEStream(response.body);
	}

	async getProviders(): Promise<ProviderEntry[]> {
		// In v1, providers come from the config file (not a daemon API endpoint)
		// This is a placeholder that returns empty — the config service reads them directly
		return [];
	}

	async answerQuestion(
		questionId: string,
		answers: string[]
	): Promise<{ ok: true } | { ok: false; error: string }> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.timeout);
		try {
			const response = await fetch(`${this.baseUrl}/tools/question/answer/${questionId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ answers }),
				signal: controller.signal,
			});
			if (!response.ok) {
				const text = await response.text().catch(() => `HTTP ${response.status}`);
				return { ok: false, error: text };
			}
			return await response.json() as { ok: true } | { ok: false; error: string };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
		} finally {
			clearTimeout(timeoutId);
		}
	}

	/**
	 * Fetch all messages for a session by fanning out through agent runs.
	 * Retrieves runs for the session, then fetches messages for each run.
	 * Returns messages in chronological order (by run creation, then by seq within run).
	 */
	async fetchSessionMessages(projectId: string, sessionId: string): Promise<MessageRow[]> {
		// 1. Fetch runs for session
		const runsResp = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/agent-runs`, {
			headers: { Accept: 'application/json' },
		});
		if (!runsResp.ok) return [];

		const runsJson = (await runsResp.json()) as { ok: true; data: AgentRun[] } | AgentRun[];
		// Handle both response shapes (some older routes return array directly)
		const runs: AgentRun[] = Array.isArray(runsJson)
			? runsJson
			: (runsJson as { ok: true; data: AgentRun[] }).data ?? [];

		// Only fetch root-level runs (no parent). Child/sub-agent runs belong
		// to their own view and must not be mixed into the main chat history.
		const rootRuns = runs.filter((r) => r.parent_run_id === null);

		// Sort defensively by created_at (oldest first) for chronological message order
		rootRuns.sort((a, b) => a.created_at.localeCompare(b.created_at));

		// 2. For each root run, fetch messages
		const allMessages: MessageRow[] = [];
		for (const run of rootRuns) {
			const runId = run.run_id;
			if (!runId) continue;

			const msgsResp = await fetch(
				`${this.baseUrl}/api/projects/${projectId}/runs/${runId}/messages`,
				{ headers: { Accept: 'application/json' } }
			);
			if (!msgsResp.ok) continue;

			const msgsJson = (await msgsResp.json()) as {
				ok: true;
				data: { messages: MessageRow[] };
			};
			const msgs = msgsJson?.data?.messages ?? [];
			allMessages.push(...msgs);
		}

		return allMessages;
	}
}

// Singleton instance — initialized with default URL, updated from settings
let clientInstance: DaemonClient | null = null;

export function getDaemonClient(baseUrl?: string): DaemonClient {
	if (!clientInstance) {
		clientInstance = new DaemonClient(baseUrl);
	} else if (baseUrl && baseUrl !== clientInstance.getBaseUrl()) {
		clientInstance.setBaseUrl(baseUrl);
	}
	return clientInstance;
}
