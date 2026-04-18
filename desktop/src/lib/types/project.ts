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

export interface Session {
	id: string;
	projectId: string;
	workflowId: string | null;
	phase: string;
	status: string;
	startedAt: string;
	completedAt: string | null;
	updatedAt: string;
}
