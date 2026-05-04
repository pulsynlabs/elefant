/**
 * Right sidebar panel store — global open/closed state and per-session active
 * tab selection. Backed by the runtime-appropriate KV store (Tauri plugin-store
 * on desktop, localStorage in browser/serve mode) with synchronous localStorage
 * hydration to avoid flash-of-wrong-state on initial render.
 *
 * Persistence keys:
 *   - `elefant.rightPanel.open`  → boolean (global)
 *   - `elefant.rightPanel.tabs`  → Record<sessionId, TabId> (FIFO, max 50)
 *
 * Spec: feat-right-sidebar-panel — MH1 (panel persistence), MH2 (per-session tab).
 */

import { createKVStore, readLocalStorageSync } from '$lib/utils/kv-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TabId = 'mcp' | 'terminal' | 'files' | 'todos';

const TAB_IDS: readonly TabId[] = ['mcp', 'terminal', 'files', 'todos'];
const DEFAULT_TAB: TabId = 'mcp';
const DEFAULT_OPEN = false;
const MAX_TAB_ENTRIES = 50;

const KEY_PANEL_OPEN = 'elefant.rightPanel.open';
const KEY_TABS = 'elefant.rightPanel.tabs';

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isTabId(value: unknown): value is TabId {
	return typeof value === 'string' && (TAB_IDS as readonly string[]).includes(value);
}

function isTabsMap(value: unknown): value is Record<string, TabId> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	for (const v of Object.values(value as Record<string, unknown>)) {
		if (!isTabId(v)) return false;
	}
	return true;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

class RightPanelStore {
	/** Global open/closed flag — shared across all sessions. */
	panelOpen = $state<boolean>(DEFAULT_OPEN);

	/**
	 * Per-session tab selection. Insertion order is preserved by JS object
	 * semantics (string keys are iterated in insertion order), which is what
	 * the FIFO eviction below relies on.
	 */
	#tabs = $state<Record<string, TabId>>({});

	#kv = createKVStore();
	#hydrated = false;

	constructor() {
		// Synchronous seed from localStorage so the first render uses the
		// correct value. Async hydration below will overwrite if the Tauri
		// Store has a more recent value.
		const seedOpen = readLocalStorageSync<boolean>(KEY_PANEL_OPEN);
		if (typeof seedOpen === 'boolean') {
			this.panelOpen = seedOpen;
		}

		const seedTabs = readLocalStorageSync<unknown>(KEY_TABS);
		if (isTabsMap(seedTabs)) {
			this.#tabs = { ...seedTabs };
		}

		// Only wire async hydration + reactive persistence in the browser.
		// Module evaluation in SSR or test environments without `window`
		// must not touch storage or open `$effect.root`.
		if (typeof window !== 'undefined') {
			void this.#hydrate();
			this.#installPersistence();
		} else {
			this.#hydrated = true;
		}
	}

	// -----------------------------------------------------------------------
	// Public API
	// -----------------------------------------------------------------------

	/**
	 * Returns the active tab for `sessionId`, defaulting to {@link DEFAULT_TAB}
	 * when the session has not yet selected one.
	 */
	activeTab(sessionId: string): TabId {
		return this.#tabs[sessionId] ?? DEFAULT_TAB;
	}

	/**
	 * Sets the active tab for `sessionId`, evicting the oldest entry if the
	 * map already holds {@link MAX_TAB_ENTRIES} distinct sessions. Re-setting
	 * an existing session refreshes its position to the most-recent slot.
	 */
	setActiveTab(sessionId: string, tab: TabId): void {
		// Re-insertion to refresh FIFO position: delete then set so the
		// session moves to the end of the iteration order.
		const next: Record<string, TabId> = {};
		for (const [id, t] of Object.entries(this.#tabs)) {
			if (id !== sessionId) next[id] = t;
		}
		next[sessionId] = tab;

		// Evict from the front (oldest) until under the cap.
		const keys = Object.keys(next);
		if (keys.length > MAX_TAB_ENTRIES) {
			const overflow = keys.length - MAX_TAB_ENTRIES;
			for (let i = 0; i < overflow; i++) {
				delete next[keys[i]];
			}
		}

		this.#tabs = next;
	}

	togglePanel(): void {
		this.panelOpen = !this.panelOpen;
	}

	openPanel(): void {
		this.panelOpen = true;
	}

	closePanel(): void {
		this.panelOpen = false;
	}

	// -----------------------------------------------------------------------
	// Hydration + persistence
	// -----------------------------------------------------------------------

	async #hydrate(): Promise<void> {
		try {
			const [openValue, tabsValue] = await Promise.all([
				this.#kv.get<boolean>(KEY_PANEL_OPEN),
				this.#kv.get<unknown>(KEY_TABS),
			]);

			if (typeof openValue === 'boolean') {
				this.panelOpen = openValue;
			}
			if (isTabsMap(tabsValue)) {
				this.#tabs = { ...tabsValue };
			}
		} finally {
			this.#hydrated = true;
		}
	}

	#installPersistence(): void {
		// Detached effect root — the store is a module-level singleton, so
		// these effects live for the lifetime of the page. Persistence is
		// gated on `#hydrated` so the synchronous seed value from
		// localStorage doesn't immediately race the async hydration.
		$effect.root(() => {
			$effect(() => {
				const open = this.panelOpen;
				if (!this.#hydrated) return;
				void this.#kv.set(KEY_PANEL_OPEN, open);
			});

			$effect(() => {
				const tabs = this.#tabs;
				if (!this.#hydrated) return;
				void this.#kv.set(KEY_TABS, tabs);
			});
		});
	}
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const rightPanelStore = new RightPanelStore();
