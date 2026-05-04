/**
 * Public surface of the right-panel feature.
 *
 * Consumers (App.svelte, ChatView.svelte, future mobile sheet) import
 * components and types from here — never reach into individual files.
 * Keeps the feature boundary explicit and lets internal modules be
 * refactored without breaking call-sites.
 */

export { default as RightPanel } from './RightPanel.svelte';
export { default as PanelTabs } from './PanelTabs.svelte';
export { default as TokenBar } from './TokenBar.svelte';
export { default as TerminalTab } from './tabs/TerminalTab.svelte';
export { default as TodosTab } from './tabs/TodosTab.svelte';
export { rightPanelStore } from './right-panel.svelte.js';
export { sessionTodosStore } from '$lib/stores/session-todos.svelte.js';
export type { TabId, PanelTabDescriptor } from './PanelTabs.svelte';
export type { TodoItem, TodoStatus } from '$lib/stores/session-todos.svelte.js';
