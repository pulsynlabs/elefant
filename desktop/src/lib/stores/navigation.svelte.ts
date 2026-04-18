type View = "chat" | "settings" | "models" | "about" | "projects";

let currentView = $state<View>("projects");

// Injected getter to avoid circular import with projects.svelte.ts.
// Call initNavigation({ getActiveProjectId }) from App.svelte at startup.
let _getActiveProjectId: (() => string | null) | null = null;

export function initNavigation(opts: { getActiveProjectId: () => string | null }): void {
	_getActiveProjectId = opts.getActiveProjectId;
}

export const navigationStore = {
	get current() {
		return currentView;
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
};

export function goToProjectPicker(): void {
	currentView = "projects";
}
