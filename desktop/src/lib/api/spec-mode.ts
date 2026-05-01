import { DAEMON_URL } from '$lib/daemon/client';

/**
 * Typed client for Spec Mode daemon routes.
 *
 * Wave 7 GUI stores consume this thin wrapper instead of reaching into daemon
 * URLs directly. It intentionally contains no business logic: methods mirror
 * route request/response shapes and unwrap the daemon's `{ data }` envelope.
 */

export interface SpecWorkflowSummary {
	id: string;
	projectId: string;
	workflowId: string;
	phase: string;
	mode: string;
	depth: string;
	status: string;
	specLocked: boolean;
	acceptanceConfirmed: boolean;
	interviewComplete: boolean;
	currentWave: number;
	totalWaves: number;
	isActive: boolean;
	lastActivity: string;
	createdAt: string;
	updatedAt: string;
}

export interface SpecDocumentResponse {
	id: string;
	workflowId: string;
	docType: string;
	contentMd: string;
	version: number;
	locked: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface StructuredSpecResponse {
	document: SpecDocumentResponse | null;
	mustHaves: unknown[];
	acceptanceCriteria: unknown[];
	validationContracts: unknown[];
	outOfScope: unknown[];
}

type ApiEnvelope<T> = { data: T } | { error: { code: string; message: string } };

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
	const url = new URL(path, DAEMON_URL);
	for (const [key, value] of Object.entries(query ?? {})) {
		if (value !== undefined) url.searchParams.set(key, String(value));
	}
	return url.toString();
}

async function request<T>(
	path: string,
	options?: RequestInit & { query?: Record<string, string | number | undefined> },
): Promise<T> {
	const response = await fetch(buildUrl(path, options?.query), {
		...options,
		headers: {
			Accept: 'application/json',
			...(options?.body ? { 'Content-Type': 'application/json' } : {}),
			...options?.headers,
		},
	});

	const payload = (await response.json()) as ApiEnvelope<T>;
	if (!response.ok || 'error' in payload) {
		const message = 'error' in payload ? payload.error.message : `HTTP ${response.status}`;
		throw new Error(message);
	}

	return payload.data;
}

export const specModeApi = {
	async listWorkflows(projectId: string): Promise<SpecWorkflowSummary[]> {
		return request(`/api/wf/projects/${encodeURIComponent(projectId)}/workflows`);
	},

	async createWorkflow(
		projectId: string,
		input: { workflowId: string; mode?: string },
	): Promise<SpecWorkflowSummary> {
		return request(`/api/wf/projects/${encodeURIComponent(projectId)}/workflows`, {
			method: 'POST',
			body: JSON.stringify(input),
		});
	},

	async getWorkflow(workflowId: string): Promise<SpecWorkflowSummary> {
		return request(`/api/wf/workflows/${encodeURIComponent(workflowId)}`);
	},

	async transitionPhase(workflowId: string, to: string, force?: boolean): Promise<SpecWorkflowSummary> {
		return request(`/api/wf/workflows/${encodeURIComponent(workflowId)}/phase`, {
			method: 'PATCH',
			body: JSON.stringify({ to, force }),
		});
	},

	async lock(workflowId: string): Promise<void> {
		await request<SpecWorkflowSummary>(`/api/wf/workflows/${encodeURIComponent(workflowId)}/lock`, {
			method: 'POST',
		});
	},

	async getSpec(workflowId: string): Promise<{ contentMd: string; mustHaves: unknown[] }> {
		const spec = await request<StructuredSpecResponse>(`/api/wf/workflows/${encodeURIComponent(workflowId)}/spec`);
		return { contentMd: spec.document?.contentMd ?? '', mustHaves: spec.mustHaves };
	},

	async getRendererd(workflowId: string, docType: string): Promise<{ content: string }> {
		return request(`/api/wf/workflows/${encodeURIComponent(workflowId)}/render/${encodeURIComponent(docType)}`);
	},

	async listTasks(workflowId: string, opts?: { status?: string; wave?: number }): Promise<unknown[]> {
		return request(`/api/wf/workflows/${encodeURIComponent(workflowId)}/tasks`, { query: opts });
	},

	async assignTask(taskId: string, agentRunId: string): Promise<void> {
		await request(`/api/wf/tasks/${encodeURIComponent(taskId)}/assign`, {
			method: 'POST',
			body: JSON.stringify({ agentRunId }),
		});
	},

	async completeTask(taskId: string): Promise<void> {
		await request(`/api/wf/tasks/${encodeURIComponent(taskId)}/complete`, {
			method: 'POST',
			body: JSON.stringify({}),
		});
	},

	async startWave(workflowId: string, waveNumber: number): Promise<void> {
		await request(`/api/wf/workflows/${encodeURIComponent(workflowId)}/waves/${waveNumber}/start`, {
			method: 'POST',
		});
	},

	async completeWave(workflowId: string, waveNumber: number): Promise<void> {
		await request(`/api/wf/workflows/${encodeURIComponent(workflowId)}/waves/${waveNumber}/complete`, {
			method: 'POST',
		});
	},
};
