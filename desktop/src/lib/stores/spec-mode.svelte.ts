// Spec Mode store (Svelte 5 runes)
//
// Mirrors `desktop/src/lib/api/workflow.ts` as the reactive UI source of truth
// for the Spec Mode panel. Components never call the API client directly — they
// read from getters and call action methods. SSE event subscription keeps state
// fresh in real time as the daemon emits spec lifecycle events.
//
// Convention notes:
//   - All async actions surface their failure as `error` and never throw to UI.
//   - The store does NOT cache aggressively; reactive components call
//     loadActiveWorkflow() once per workflow switch and rely on SSE updates
//     for live changes (mirrors agent-runs.svelte.ts pattern).
//   - File extension `.svelte.ts` is required for runes.

import { DAEMON_URL } from '$lib/daemon/client.js';
import { specModeApi, type SpecWorkflowSummary } from '$lib/api/workflow.js';

export interface SpecModeTask {
	id: string;
	taskId: string;
	waveId: string;
	name: string;
	executor: string;
	status: string;
	files?: string[];
	action?: string;
	done?: string;
	verify?: string;
	agentRunId?: string | null;
	ordinal?: number;
}

let workflows = $state<SpecWorkflowSummary[]>([]);
let activeWorkflowId = $state<string | null>(null);
let currentSpec = $state<{ contentMd: string; mustHaves: unknown[] } | null>(null);
let currentBlueprint = $state<{ contentMd: string } | null>(null);
let renderedDocs = $state<Record<string, string>>({});
let tasks = $state<SpecModeTask[]>([]);
let loading = $state(false);
let error = $state<string | null>(null);

// Track current SSE subscription so a project switch tears the old one down.
let sseSubscription: { projectId: string; eventSource: EventSource } | null = null;

const activeWorkflow = $derived<SpecWorkflowSummary | null>(
	activeWorkflowId
		? workflows.find((w) => w.id === activeWorkflowId || w.workflowId === activeWorkflowId) ?? null
		: null,
);

function setError(message: string): void {
	error = message;
	console.error('[spec-mode]', message);
}

function clearError(): void {
	error = null;
}

async function loadWorkflows(projectId: string): Promise<void> {
	loading = true;
	clearError();
	try {
		const data = await specModeApi.listWorkflows(projectId);
		workflows = data;
		// Preserve active selection if still present; otherwise pick the active one
		const stillPresent =
			activeWorkflowId && data.some((w) => w.id === activeWorkflowId || w.workflowId === activeWorkflowId);
		if (!stillPresent) {
			const activeRow = data.find((w) => w.isActive);
			activeWorkflowId = activeRow?.workflowId ?? activeRow?.id ?? data[0]?.workflowId ?? null;
		}
	} catch (err) {
		setError(err instanceof Error ? err.message : 'Failed to load workflows');
	} finally {
		loading = false;
	}
}

async function createWorkflow(
	projectId: string,
	input: { workflowId: string; mode?: string },
): Promise<SpecWorkflowSummary | null> {
	clearError();
	try {
		const created = await specModeApi.createWorkflow(projectId, input);
		// Upsert
		const existing = workflows.findIndex((w) => w.id === created.id);
		workflows = existing >= 0
			? workflows.map((w, i) => (i === existing ? created : w))
			: [created, ...workflows];
		activeWorkflowId = created.workflowId ?? created.id;
		return created;
	} catch (err) {
		setError(err instanceof Error ? err.message : 'Failed to create workflow');
		return null;
	}
}

function setActiveWorkflow(workflowId: string): void {
	activeWorkflowId = workflowId;
	// Reset doc caches; they'll be re-fetched as tabs are visited
	currentSpec = null;
	currentBlueprint = null;
	renderedDocs = {};
	tasks = [];
}

async function transitionPhase(workflowId: string, to: string, force?: boolean): Promise<void> {
	clearError();
	try {
		const updated = await specModeApi.transitionPhase(workflowId, to, force);
		workflows = workflows.map((w) => (w.id === updated.id ? updated : w));
	} catch (err) {
		setError(err instanceof Error ? err.message : 'Failed to transition phase');
	}
}

async function lock(workflowId: string): Promise<void> {
	clearError();
	try {
		await specModeApi.lock(workflowId);
		// Optimistic update: reflect lock immediately, then reload the row
		workflows = workflows.map((w) =>
			w.id === workflowId || w.workflowId === workflowId ? { ...w, specLocked: true } : w,
		);
		try {
			const fresh = await specModeApi.getWorkflow(workflowId);
			workflows = workflows.map((w) => (w.id === fresh.id ? fresh : w));
		} catch {
			// optimistic value already applied
		}
	} catch (err) {
		setError(err instanceof Error ? err.message : 'Failed to lock spec');
	}
}

async function loadSpec(workflowId: string): Promise<void> {
	clearError();
	try {
		currentSpec = await specModeApi.getSpec(workflowId);
	} catch (err) {
		setError(err instanceof Error ? err.message : 'Failed to load spec');
	}
}

async function loadRendered(workflowId: string, docType: string): Promise<void> {
	clearError();
	try {
		const result = await specModeApi.getRendererd(workflowId, docType);
		renderedDocs = { ...renderedDocs, [docType]: result.content };
	} catch (err) {
		setError(err instanceof Error ? err.message : `Failed to load ${docType}`);
	}
}

async function loadTasks(workflowId: string): Promise<void> {
	clearError();
	try {
		const data = await specModeApi.listTasks(workflowId);
		// Cast through unknown to local type — the daemon returns Task rows
		tasks = data as SpecModeTask[];
	} catch (err) {
		setError(err instanceof Error ? err.message : 'Failed to load tasks');
	}
}

async function startWave(workflowId: string, waveNumber: number): Promise<void> {
	clearError();
	try {
		await specModeApi.startWave(workflowId, waveNumber);
		await loadTasks(workflowId);
	} catch (err) {
		setError(err instanceof Error ? err.message : 'Failed to start wave');
	}
}

async function completeWave(workflowId: string, waveNumber: number): Promise<void> {
	clearError();
	try {
		await specModeApi.completeWave(workflowId, waveNumber);
		await loadTasks(workflowId);
	} catch (err) {
		setError(err instanceof Error ? err.message : 'Failed to complete wave');
	}
}

/**
 * Subscribe to the project's SSE event stream and react to spec-mode events.
 * Calls back into the store's reload methods so reactive components see live
 * updates within ~250ms of daemon emit.
 */
function subscribeToSpecEvents(projectId: string): () => void {
	if (sseSubscription && sseSubscription.projectId === projectId) {
		return () => unsubscribeFromSpecEvents();
	}
	unsubscribeFromSpecEvents();

	const url = `${DAEMON_URL}/api/projects/${encodeURIComponent(projectId)}/events`;
	const es = new EventSource(url);
	sseSubscription = { projectId, eventSource: es };

	const handler = (event: MessageEvent): void => {
		try {
			const envelope = JSON.parse(event.data) as {
				type?: string;
				event?: string;
				workflowId?: string;
			};
			if (!envelope.workflowId) return;
			// Phase / lock / amend events change the workflow row — reload list
			if (
				envelope.event === 'wf:locked' ||
				envelope.event === 'wf:unlocked' ||
				envelope.event === 'wf:amended' ||
				envelope.event === 'wf:phase_transitioned' ||
				envelope.event === 'blueprint:created'
			) {
				void loadWorkflows(projectId);
			}
			// Wave / task events affect the active workflow's tasks
			if (
				activeWorkflowId &&
				(envelope.workflowId === activeWorkflowId) &&
				(envelope.event === 'wave:started' ||
					envelope.event === 'wave:completed' ||
					envelope.event === 'task:assigned' ||
					envelope.event === 'task:completed')
			) {
				void loadTasks(activeWorkflowId);
			}
		} catch {
			// Malformed envelope — ignore
		}
	};

	// The daemon publishes via sseManager.publish(...., 'spec-mode:event', envelope)
	es.addEventListener('spec-mode:event', handler as EventListener);
	es.onmessage = handler;

	return () => unsubscribeFromSpecEvents();
}

function unsubscribeFromSpecEvents(): void {
	if (!sseSubscription) return;
	try {
		sseSubscription.eventSource.close();
	} catch {
		// already closed
	}
	sseSubscription = null;
}

/** Reset state for tests. */
export function resetSpecModeStore(): void {
	workflows = [];
	activeWorkflowId = null;
	currentSpec = null;
	currentBlueprint = null;
	renderedDocs = {};
	tasks = [];
	loading = false;
	error = null;
	unsubscribeFromSpecEvents();
}

export const specModeStore = {
	get workflows() {
		return workflows;
	},
	get activeWorkflowId() {
		return activeWorkflowId;
	},
	get activeWorkflow() {
		return activeWorkflow;
	},
	get currentSpec() {
		return currentSpec;
	},
	get currentBlueprint() {
		return currentBlueprint;
	},
	get renderedDocs() {
		return renderedDocs;
	},
	get tasks() {
		return tasks;
	},
	get loading() {
		return loading;
	},
	get error() {
		return error;
	},
	loadWorkflows,
	createWorkflow,
	setActiveWorkflow,
	transitionPhase,
	lock,
	loadSpec,
	loadRendered,
	loadTasks,
	startWave,
	completeWave,
	subscribeToSpecEvents,
	unsubscribeFromSpecEvents,
};
