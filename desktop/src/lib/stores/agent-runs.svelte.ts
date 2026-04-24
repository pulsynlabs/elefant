// Agent run store (Svelte 5 runes).
//
// Tracks the life of every agent run visible in the UI for a given project:
//   - metadata (AgentRun rows returned from the daemon)
//   - per-run transcript events demultiplexed from the project SSE stream
//   - which tabs are open and which tab is active
//
// The store subscribes to the project-level event stream at
// `/api/projects/:id/events` and fans events out to the correct run by
// envelope.runId — a SINGLE SSE connection serves every run in the
// project (see MUST NOT: "do not add a new SSE connection per run").

import { DAEMON_URL } from '$lib/daemon/client.js';
import {
	agentRunFromRow,
	type AgentRun,
	type AgentRunContextMode,
	type AgentRunEventEnvelope,
	type AgentRunRow,
	type AgentRunTranscriptEntry,
	type AgentRunTreeNode,
	type DaemonResult,
} from '$lib/types/agent-run.js';

// ─── State ───────────────────────────────────────────────────────────────────

let runs = $state<Record<string, AgentRun>>({});
let transcripts = $state<Record<string, AgentRunTranscriptEntry[]>>({});
let activeRunId = $state<string | null>(null);
let openRunIds = $state<string[]>([]);
let lastError = $state<string | null>(null);
let isLoading = $state(false);

// O(1) index for child lookups: parentRunId -> child runIds (unsorted)
let childrenByParent = $state<Record<string, string[]>>({});

// Status tracking for sidebar indicator dots (MH3)
// unseenRunIds: runs that have new output since last viewed
let unseenRunIds = $state<Set<string>>(new Set());
// awaitingQuestionIds: runs with an outstanding question awaiting user input
let awaitingQuestionIds = $state<Set<string>>(new Set());

// SSE subscription state (kept at module level — there is at most one
// active subscription per project at a time).
let sseSubscription: {
	projectId: string;
	eventSource: EventSource;
	lastEventId: string | null;
	reconnectTimer: ReturnType<typeof setTimeout> | null;
} | null = null;

// ─── Derived selectors ──────────────────────────────────────────────────────

/**
 * Returns runs for a given session, sorted oldest-first by createdAt.
 * Intentionally returns a function so callers pick their sessionId
 * without needing a per-session subscription.
 */
function runsForSession(sessionId: string): AgentRun[] {
	return Object.values(runs)
		.filter((r) => r.sessionId === sessionId)
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Builds a parent/child tree for the session, rooted at runs with no
 * parentRunId (or whose parent lives in another session). Orphans are
 * surfaced as roots so nothing is hidden if parent data is late.
 */
function runTree(sessionId: string): AgentRunTreeNode[] {
	const sessionRuns = runsForSession(sessionId);
	const byId = new Map<string, AgentRunTreeNode>(
		sessionRuns.map((run) => [run.runId, { run, children: [] }]),
	);
	const roots: AgentRunTreeNode[] = [];

	for (const node of byId.values()) {
		const parentId = node.run.parentRunId;
		if (parentId && byId.has(parentId)) {
			byId.get(parentId)!.children.push(node);
		} else {
			roots.push(node);
		}
	}
	return roots;
}

/**
 * Returns direct children of a run, sorted by createdAt ASC.
 * Uses the O(1) childrenByParent index for efficient lookups.
 */
function childRunsForRun(runId: string): AgentRun[] {
	const childIds = childrenByParent[runId] ?? [];
	return childIds
		.map((id) => runs[id])
		.filter((r): r is AgentRun => r !== undefined)
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Returns the chain from rootRunId to activeRunId (inclusive), ordered
 * from root to active. Returns [] if activeRunId is not a descendant
 * of rootRunId or if activeRunId is not provided.
 * Max depth supported: 4 levels (root -> child -> grandchild -> great-grandchild).
 */
function activeChildPath(rootRunId: string, activeRunId?: string): AgentRun[] {
	if (!activeRunId || !runs[activeRunId]) return [];

	// Build path from activeRunId up to root (or until we hit a dead end)
	const path: AgentRun[] = [];
	let currentId: string | null = activeRunId;
	let depth = 0;
	const MAX_DEPTH = 4;

	while (currentId && depth < MAX_DEPTH) {
		const currentRun: AgentRun | undefined = runs[currentId];
		if (!currentRun) break;

		path.unshift(currentRun);

		// Check if we've reached the root
		if (currentId === rootRunId) {
			return path;
		}

		currentId = currentRun.parentRunId;
		depth++;
	}

	// If we exited the loop without finding rootRunId, activeRunId is not a descendant
	return [];
}

/**
 * Returns true if the run has unseen output (blue dot indicator).
 * Cleared when the user navigates to that run via setActiveRun.
 */
function isUnseen(runId: string): boolean {
	return unseenRunIds.has(runId);
}

/**
 * Returns true if the run has an outstanding question awaiting answer (yellow dot indicator).
 * Set when agent_run.question arrives; cleared on next token/tool_call/tool_result.
 */
function isAwaitingQuestion(runId: string): boolean {
	return awaitingQuestionIds.has(runId);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function clearError(): void {
	lastError = null;
}

function setError(message: string): void {
	lastError = message;
	console.error('[agent-runs]', message);
}

function appendToTranscript(runId: string, entry: AgentRunTranscriptEntry): void {
	const existing = transcripts[runId] ?? [];
	transcripts = { ...transcripts, [runId]: [...existing, entry] };
}

function upsertRun(run: AgentRun): void {
	const existing = runs[run.runId];
	runs = { ...runs, [run.runId]: run };

	// Maintain childrenByParent index
	if (existing?.parentRunId !== run.parentRunId) {
		// Remove from old parent's children list
		if (existing?.parentRunId) {
			const oldParentChildren = childrenByParent[existing.parentRunId] ?? [];
			childrenByParent = {
				...childrenByParent,
				[existing.parentRunId]: oldParentChildren.filter((id) => id !== run.runId),
			};
		}
		// Add to new parent's children list
		if (run.parentRunId) {
			const newParentChildren = childrenByParent[run.parentRunId] ?? [];
			if (!newParentChildren.includes(run.runId)) {
				childrenByParent = {
					...childrenByParent,
					[run.parentRunId]: [...newParentChildren, run.runId],
				};
			}
		}
	} else if (!existing && run.parentRunId) {
		// New run with a parent — add to index
		const parentChildren = childrenByParent[run.parentRunId] ?? [];
		if (!parentChildren.includes(run.runId)) {
			childrenByParent = {
				...childrenByParent,
				[run.parentRunId]: [...parentChildren, run.runId],
			};
		}
	}
}

function updateRunStatus(
	runId: string,
	status: AgentRun['status'],
	errorMessage: string | null = null,
): void {
	const existing = runs[runId];
	if (!existing) return;
	runs = {
		...runs,
		[runId]: {
			...existing,
			status,
			errorMessage: errorMessage ?? existing.errorMessage,
			endedAt: existing.endedAt ?? new Date().toISOString(),
		},
	};
}

/**
 * Route a single SSE envelope to the correct run transcript. Unknown
 * event types are silently ignored so server-side additions don't break
 * the UI. Unknown runIds still get transcript slots so the UI can
 * recover the moment the run row arrives via `refreshSession`.
 */
export function applyRunEvent(envelope: AgentRunEventEnvelope): void {
	// Guard against malformed payloads hitting via the SSE stream. We
	// tolerate missing fields so a single bad event cannot poison the
	// whole subscription.
	if (!envelope || typeof envelope.runId !== 'string' || typeof envelope.type !== 'string') {
		return;
	}

	const runId = envelope.runId;
	const seq = typeof envelope.seq === 'number' ? envelope.seq : 0;
	const data = (envelope.data ?? {}) as Record<string, unknown>;

	switch (envelope.type) {
		case 'agent_run.spawned': {
			// If we don't yet have the row from REST, synthesize one from
			// the envelope so the UI can show the run immediately.
			if (!runs[runId]) {
				// Read contextMode from event data if available (MH4)
				const contextMode = (data.contextMode as AgentRunContextMode) ?? 'none';
				upsertRun({
					runId,
					sessionId: envelope.sessionId,
					projectId: envelope.projectId,
					parentRunId: envelope.parentRunId,
					agentType: envelope.agentType,
					title: envelope.title,
					status: 'running',
					contextMode,
					createdAt: envelope.ts,
					startedAt: envelope.ts,
					endedAt: null,
					errorMessage: null,
				});
			}
			break;
		}
		case 'agent_run.token': {
			const text = typeof data.text === 'string' ? data.text : '';
			appendToTranscript(runId, { kind: 'token', text, seq });
			// Mark as unseen if this run is not currently active (MH3 blue dot)
			if (activeRunId !== runId) {
				unseenRunIds = new Set([...unseenRunIds, runId]);
			}
			// Clear awaiting question flag — agent moved past the question (MH3 yellow dot)
			if (awaitingQuestionIds.has(runId)) {
				const next = new Set(awaitingQuestionIds);
				next.delete(runId);
				awaitingQuestionIds = next;
			}
			break;
		}
		case 'agent_run.tool_call': {
			// The daemon emits { toolCall: { id, name, arguments } } — unwrap
			// the nested toolCall field before reading individual properties.
			// Pre-existing bug: store was reading data.id/name/arguments (flat)
			// but agent-loop.ts always emits { toolCall: event.toolCall }.
			const tc = (typeof data.toolCall === 'object' && data.toolCall !== null)
				? (data.toolCall as Record<string, unknown>)
				: data;
			appendToTranscript(runId, {
				kind: 'tool_call',
				id: typeof tc.id === 'string' ? tc.id : '',
				name: typeof tc.name === 'string' ? tc.name : '',
				arguments:
					typeof tc.arguments === 'object' && tc.arguments !== null
						? (tc.arguments as Record<string, unknown>)
						: {},
				seq,
			});
			// Mark as unseen if this run is not currently active (MH3 blue dot)
			if (activeRunId !== runId) {
				unseenRunIds = new Set([...unseenRunIds, runId]);
			}
			// Clear awaiting question flag — agent moved past the question (MH3 yellow dot)
			if (awaitingQuestionIds.has(runId)) {
				const next = new Set(awaitingQuestionIds);
				next.delete(runId);
				awaitingQuestionIds = next;
			}
			break;
		}
		case 'agent_run.tool_result': {
			// The daemon emits { toolResult: { toolCallId, content, isError } } — unwrap.
			// Same nested-vs-flat mismatch as agent_run.tool_call above.
			const tr = (typeof data.toolResult === 'object' && data.toolResult !== null)
				? (data.toolResult as Record<string, unknown>)
				: data;
			appendToTranscript(runId, {
				kind: 'tool_result',
				toolCallId: typeof tr.toolCallId === 'string' ? tr.toolCallId : '',
				content: typeof tr.content === 'string' ? tr.content : '',
				isError: typeof tr.isError === 'boolean' ? tr.isError : false,
				seq,
			});
			// Mark as unseen if this run is not currently active (MH3 blue dot)
			if (activeRunId !== runId) {
				unseenRunIds = new Set([...unseenRunIds, runId]);
			}
			// Clear awaiting question flag — agent moved past the question (MH3 yellow dot)
			if (awaitingQuestionIds.has(runId)) {
				const next = new Set(awaitingQuestionIds);
				next.delete(runId);
				awaitingQuestionIds = next;
			}
			break;
		}
		case 'agent_run.tool_call_metadata': {
			// Merge metadata onto existing tool_call entry by toolCallId.
			// Preferred routing uses envelope.runId = parent run id, but we
			// also support fallback lookup via data.parentRunId for older
			// producers that emitted envelope.runId = child run id.
			const toolCallId = typeof data.toolCallId === 'string' ? data.toolCallId : '';
			const parentRunId = typeof data.parentRunId === 'string' ? data.parentRunId : '';
			const targetRunId = transcripts[runId]
				? runId
				: (parentRunId && transcripts[parentRunId] ? parentRunId : runId);
			const existingTranscript = transcripts[targetRunId];
			if (!existingTranscript || !toolCallId) break;

			const entryIndex = existingTranscript.findIndex(
				(e) => e.kind === 'tool_call' && e.id === toolCallId,
			);
			if (entryIndex === -1) break;

			const entry = existingTranscript[entryIndex];
			if (entry.kind !== 'tool_call') break;

			// Merge metadata fields
			const metadata = {
				runId: typeof data.runId === 'string' ? data.runId : '',
				parentRunId: typeof data.parentRunId === 'string' ? data.parentRunId : undefined,
				agentType: typeof data.agentType === 'string' ? data.agentType : '',
				title: typeof data.title === 'string' ? data.title : '',
			};

			// Create updated entry with metadata
			const updatedEntry = { ...entry, metadata };
			const updatedTranscript = [...existingTranscript];
			updatedTranscript[entryIndex] = updatedEntry;
			transcripts = { ...transcripts, [targetRunId]: updatedTranscript };
			break;
		}
		case 'agent_run.question': {
			appendToTranscript(runId, {
				kind: 'question',
				questionId: typeof data.questionId === 'string' ? data.questionId : '',
				question: typeof data.question === 'string' ? data.question : '',
				options: Array.isArray(data.options)
					? (data.options as Array<{ label: string; description?: string }>)
					: [],
				multiple: typeof data.multiple === 'boolean' ? data.multiple : false,
				seq,
			});
			// Set awaiting question flag (MH3 yellow dot indicator)
			awaitingQuestionIds = new Set([...awaitingQuestionIds, runId]);
			break;
		}
		case 'agent_run.done':
		case 'agent_run.completed': {
			updateRunStatus(runId, 'done');
			appendToTranscript(runId, {
				kind: 'terminal',
				status: 'done',
				message: 'Run complete.',
				seq,
			});
			break;
		}
		case 'agent_run.error': {
			const message = typeof data.message === 'string' ? data.message : 'Run failed.';
			updateRunStatus(runId, 'error', message);
			appendToTranscript(runId, { kind: 'terminal', status: 'error', message, seq });
			break;
		}
		case 'agent_run.cancelled': {
			const reason = typeof data.reason === 'string' ? data.reason : 'Run cancelled.';
			updateRunStatus(runId, 'cancelled');
			appendToTranscript(runId, { kind: 'terminal', status: 'cancelled', message: reason, seq });
			break;
		}
		case 'agent_run.status_changed': {
			// Parse status change data with safe fallbacks
			const nextStatus = (data.nextStatus as AgentRun['status']) ?? 'running';
			const previousStatus = (data.previousStatus as AgentRun['status']) ?? 'running';

			// Idempotent: if status already matches nextStatus, no-op
			const existing = runs[runId];
			if (existing && existing.status === nextStatus) {
				break;
			}

			// If run doesn't exist yet, create a minimal entry
			// (handles case where status_changed arrives before spawned event)
			if (!existing) {
				upsertRun({
					runId,
					sessionId: envelope.sessionId,
					projectId: envelope.projectId,
					parentRunId: envelope.parentRunId,
					agentType: envelope.agentType,
					title: envelope.title,
					status: nextStatus,
					contextMode: 'none',
					createdAt: envelope.ts,
					startedAt: previousStatus === 'running' ? envelope.ts : null,
					endedAt: ['done', 'error', 'cancelled'].includes(nextStatus) ? envelope.ts : null,
					errorMessage: null,
				});
			} else {
				// Update existing run status
				runs = {
					...runs,
					[runId]: {
						...existing,
						status: nextStatus,
						startedAt: existing.startedAt ?? (nextStatus === 'running' ? envelope.ts : null),
						endedAt: existing.endedAt ?? (['done', 'error', 'cancelled'].includes(nextStatus) ? envelope.ts : null),
					},
				};
			}
			// Note: NO transcript entry appended — status_changed is metadata only
			break;
		}
		default:
			// Unknown agent_run.* type — ignore gracefully.
			break;
	}
}

// ─── SSE subscription ───────────────────────────────────────────────────────

const AGENT_RUN_EVENT_TYPES = [
	'agent_run.spawned',
	'agent_run.token',
	'agent_run.tool_call',
	'agent_run.tool_result',
	'agent_run.tool_call_metadata',
	'agent_run.question',
	'agent_run.status_changed',
	'agent_run.done',
	'agent_run.completed', // Alias for done (MH5 contract)
	'agent_run.error',
	'agent_run.cancelled',
] as const;

/**
 * Subscribe to a project's SSE stream if not already subscribed to that
 * project. Safe to call repeatedly — calling with the same projectId is
 * a no-op; calling with a different projectId tears down the old
 * subscription first.
 *
 * `lastEventId` is passed as a query parameter so the daemon can replay
 * missed events after reconnects (browser EventSource cannot set a
 * `Last-Event-ID` header directly).
 */
function subscribeToProject(projectId: string): void {
	if (sseSubscription && sseSubscription.projectId === projectId) return;
	unsubscribe();

	const base = `${DAEMON_URL}/api/projects/${encodeURIComponent(projectId)}/events`;
	const url = sseSubscription?.lastEventId
		? `${base}?lastEventId=${encodeURIComponent(sseSubscription.lastEventId)}`
		: base;

	const es = new EventSource(url);

	const subscription = {
		projectId,
		eventSource: es,
		lastEventId: null as string | null,
		reconnectTimer: null as ReturnType<typeof setTimeout> | null,
	};
	sseSubscription = subscription;

	const handle = (e: MessageEvent): void => {
		try {
			const envelope = JSON.parse(e.data) as AgentRunEventEnvelope;
			applyRunEvent(envelope);
			if (e.lastEventId) {
				subscription.lastEventId = e.lastEventId;
			}
		} catch {
			// Malformed payload — skip without poisoning the stream.
		}
	};

	for (const type of AGENT_RUN_EVENT_TYPES) {
		es.addEventListener(type, handle as EventListener);
	}

	es.onerror = () => {
		// EventSource auto-reconnects. If the connection is permanently
		// closed (readyState === CLOSED) we back off and try again with
		// the last cursor so the daemon can replay.
		if (es.readyState === EventSource.CLOSED && sseSubscription === subscription) {
			subscription.reconnectTimer = setTimeout(() => {
				if (sseSubscription === subscription) {
					sseSubscription = null;
					subscribeToProject(projectId);
				}
			}, 1000);
		}
	};
}

function unsubscribe(): void {
	if (!sseSubscription) return;
	const { eventSource, reconnectTimer } = sseSubscription;
	if (reconnectTimer) clearTimeout(reconnectTimer);
	try {
		eventSource.close();
	} catch {
		// already closed
	}
	sseSubscription = null;
}

// ─── Actions ────────────────────────────────────────────────────────────────

async function refreshSession(sessionId: string): Promise<void> {
	isLoading = true;
	clearError();
	try {
		const response = await fetch(
			`${DAEMON_URL}/api/sessions/${encodeURIComponent(sessionId)}/agent-runs`,
			{ headers: { Accept: 'application/json' } },
		);
		if (!response.ok) {
			throw new Error(
				`GET /api/sessions/${sessionId}/agent-runs failed: HTTP ${response.status}`,
			);
		}
		const parsed = (await response.json()) as DaemonResult<AgentRunRow[]>;
		if (!parsed.ok) {
			throw new Error(
				typeof parsed.error === 'string' ? parsed.error : 'Daemon returned ok=false',
			);
		}
		for (const row of parsed.data) {
			upsertRun(agentRunFromRow(row));
		}
	} catch (err) {
		setError(err instanceof Error ? err.message : 'Failed to load agent runs');
	} finally {
		isLoading = false;
	}
}

interface SpawnOptions {
	agentType: string;
	title: string;
	prompt: string;
	contextMode?: AgentRunContextMode;
	parentRunId?: string;
}

async function spawn(
	projectId: string,
	sessionId: string,
	opts: SpawnOptions,
): Promise<string | null> {
	clearError();
	subscribeToProject(projectId);
	try {
		const response = await fetch(
			`${DAEMON_URL}/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/agent-runs`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					agentType: opts.agentType,
					title: opts.title,
					prompt: opts.prompt,
					contextMode: opts.contextMode ?? 'inherit_session',
					...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
				}),
			},
		);
		if (!response.ok) {
			throw new Error(
				`POST /api/projects/${projectId}/sessions/${sessionId}/agent-runs failed: HTTP ${response.status}`,
			);
		}
		const parsed = (await response.json()) as DaemonResult<{ runId: string }>;
		if (!parsed.ok) {
			throw new Error(
				typeof parsed.error === 'string' ? parsed.error : 'Daemon returned ok=false',
			);
		}
		// Synthesize the run row from what we know; the spawned event will
		// overwrite with the canonical values, and `refreshSession` will
		// fill the rest.
		const now = new Date().toISOString();
		upsertRun({
			runId: parsed.data.runId,
			sessionId,
			projectId,
			parentRunId: opts.parentRunId ?? null,
			agentType: opts.agentType,
			title: opts.title,
			status: 'running',
			contextMode: opts.contextMode ?? 'inherit_session',
			createdAt: now,
			startedAt: now,
			endedAt: null,
			errorMessage: null,
		});
		openRun(parsed.data.runId);
		setActiveRun(parsed.data.runId);
		return parsed.data.runId;
	} catch (err) {
		setError(err instanceof Error ? err.message : 'Failed to spawn agent run');
		return null;
	}
}

async function cancel(runId: string): Promise<boolean> {
	clearError();
	try {
		const response = await fetch(
			`${DAEMON_URL}/api/agent-runs/${encodeURIComponent(runId)}/cancel`,
			{ method: 'POST' },
		);
		if (!response.ok) {
			throw new Error(`POST /api/agent-runs/${runId}/cancel failed: HTTP ${response.status}`);
		}
		const parsed = (await response.json()) as DaemonResult<unknown>;
		if (!parsed.ok) {
			throw new Error(
				typeof parsed.error === 'string' ? parsed.error : 'Daemon returned ok=false',
			);
		}
		// Optimistically reflect the cancel until the SSE event lands.
		updateRunStatus(runId, 'cancelled');
		return true;
	} catch (err) {
		setError(err instanceof Error ? err.message : 'Failed to cancel run');
		return false;
	}
}

function setActiveRun(runId: string | null): void {
	activeRunId = runId;
	// Clear unseen flag when user navigates to this run (MH3 blue dot)
	if (runId && unseenRunIds.has(runId)) {
		const next = new Set(unseenRunIds);
		next.delete(runId);
		unseenRunIds = next;
	}
}

function openRun(runId: string): void {
	if (!openRunIds.includes(runId)) {
		openRunIds = [...openRunIds, runId];
	}
}

function closeRun(runId: string): void {
	openRunIds = openRunIds.filter((id) => id !== runId);
	if (activeRunId === runId) {
		activeRunId = openRunIds[openRunIds.length - 1] ?? null;
	}
}

// ─── Test helpers (not part of the public contract) ─────────────────────────

/** Reset every piece of store state. */
export function resetAgentRunsStore(): void {
	unsubscribe();
	runs = {};
	transcripts = {};
	activeRunId = null;
	openRunIds = [];
	lastError = null;
	isLoading = false;
	childrenByParent = {};
	unseenRunIds = new Set();
	awaitingQuestionIds = new Set();
}

/** Seed a run row without hitting the daemon. */
export function _seedRun(run: AgentRun): void {
	upsertRun(run);
}

/** Seed the transcript list for a runId directly. */
export function _seedTranscript(runId: string, entries: AgentRunTranscriptEntry[]): void {
	transcripts = { ...transcripts, [runId]: entries };
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const agentRunsStore = {
	get runs() {
		return runs;
	},
	get transcripts() {
		return transcripts;
	},
	get activeRunId() {
		return activeRunId;
	},
	get openRunIds() {
		return openRunIds;
	},
	get lastError() {
		return lastError;
	},
	get isLoading() {
		return isLoading;
	},
	runsForSession,
	runTree,
	childRunsForRun,
	activeChildPath,
	isUnseen,
	isAwaitingQuestion,
	refreshSession,
	spawn,
	cancel,
	setActiveRun,
	openRun,
	closeRun,
	subscribeToProject,
	unsubscribe,
	applyRunEvent,
};
