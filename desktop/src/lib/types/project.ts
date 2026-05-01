// Project and Session types for the desktop UI layer.
// These mirror the daemon response shapes — do not import from src/db/ directly.

export interface Project {
	id: string;
	name: string;
	path: string;
	description: string | null;
	createdAt: string;
	updatedAt: string;
}

/**
 * Session mode selected at creation time.
 *
 *  - `spec`  — full structured workflow with phase gates and `wf_*` tools
 *  - `quick` — free-form conversation; the lower-friction default
 *
 * Mode is fixed for the lifetime of a session — switching modes
 * mid-session would invalidate the workflow contract.
 */
export type SessionMode = 'spec' | 'quick';

export interface Session {
	id: string;
	projectId: string;
	workflowId: string | null;
	mode: SessionMode;
	phase: string;
	status: string;
	startedAt: string;
	completedAt: string | null;
	updatedAt: string;
}
