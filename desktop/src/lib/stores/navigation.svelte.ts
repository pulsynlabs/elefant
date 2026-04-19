type View = "chat" | "settings" | "models" | "about" | "projects" | "agent-config" | "agent-runs" | "worktrees" | "child-run";

let currentView = $state<View>("projects");

// Child-run navigation stack (MH2): append-to-end; last element is current
let childRunStack = $state<string[]>([]);

// Derived: current child run ID is the last element of the stack (or null)
const currentChildRunId = $derived<string | null>(
	childRunStack.length > 0 ? childRunStack[childRunStack.length - 1] : null
);

// Injected getter to avoid circular import with projects.svelte.ts.
// Call initNavigation({ getActiveProjectId }) from App.svelte at startup.
let _getActiveProjectId: (() => string | null) | null = null;

export function initNavigation(opts: { getActiveProjectId: () => string | null }): void {
	_getActiveProjectId = opts.getActiveProjectId;
}

/**
 * Clear the child run stack. Called when session changes.
 */
function clearChildRunStack(): void {
	childRunStack = [];
}

/**
 * Open a child run: push onto stack and switch to child-run view.
 */
function openChildRun(runId: string): void {
	childRunStack = [...childRunStack, runId];
	currentView = "child-run";
}

/**
 * Navigate back to parent: pop one from stack.
 * If stack becomes empty, return to chat view.
 */
function backToParent(): void {
	if (childRunStack.length <= 1) {
		// Last item being popped — return to chat view
		clearChildRunStack();
		currentView = "chat";
	} else {
		// Pop the last item, stay in child-run view with previous parent
		childRunStack = childRunStack.slice(0, -1);
	}
}

export const navigationStore = {
	initNavigation(opts: { getActiveProjectId: () => string | null }): void {
		_getActiveProjectId = opts.getActiveProjectId;
	},
	get current() {
		return currentView;
	},
	get currentChildRunId() {
		return currentChildRunId;
	},
	navigate(view: View): void {
		if (view === "chat" && _getActiveProjectId?.() === null) {
			currentView = "projects";
			return;
		}
		currentView = view;
	},
	isActive(view: View): boolean {
		return currentView === view;
	},
	goToProjectPicker(): void {
		currentView = "projects";
	},
	goToAgentConfig(): void {
		currentView = "agent-config";
	},
	goToAgentRuns(): void {
		if (_getActiveProjectId?.() === null) {
			currentView = "projects";
			return;
		}
		currentView = "agent-runs";
	},
	goToWorktrees(): void {
		if (_getActiveProjectId?.() === null) {
			currentView = "projects";
			return;
		}
		currentView = "worktrees";
	},
	/** Open a child run: push onto stack and switch to child-run view (MH2) */
	openChildRun,
	/** Navigate back to parent: pop from stack, return to chat if empty (MH2) */
	backToParent,
	/** Clear the child run stack (internal — called on session change) */
	clearChildRunStack,
};

/** @deprecated Use `navigationStore.goToProjectPicker()` instead. */
export function goToProjectPicker(): void {
	currentView = "projects";
}
