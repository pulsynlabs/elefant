/**
 * Public surface of the right-panel feature.
 *
 * Consumers (App.svelte, ChatView.svelte, future mobile sheet) import
 * components and types from here — never reach into individual files.
 * Keeps the feature boundary explicit and lets internal modules be
 * refactored without breaking call-sites.
 */

// Main components
export { default as RightPanel } from './RightPanel.svelte';
export { default as RightPanelMobile } from './RightPanelMobile.svelte';
export { default as PanelTabs } from './PanelTabs.svelte';

// Token bar and formatter
export { default as TokenBar, formatTokens } from './TokenBar.svelte';

// Tab components
export { default as McpTab } from './tabs/McpTab.svelte';
export { default as McpServerCard } from './tabs/McpServerCard.svelte';
export { default as FileChangesTab } from './tabs/FileChangesTab.svelte';
export { default as TodosTab } from './tabs/TodosTab.svelte';
export { default as TerminalTab } from './tabs/TerminalTab.svelte';

// Visualizer components
export { default as ContextVisualizer } from './visualizer/ContextVisualizer.svelte';
export { default as Treemap } from './visualizer/Treemap.svelte';

// Stores and types
export { rightPanelStore, type TabId } from './right-panel.svelte.js';
export { tokenCounterStore, type TokenSegment, type TokenBreakdownCategory } from '$lib/stores/token-counter.svelte.js';
export { fileChangesStore, type FileChange, type FileChangeType } from '$lib/stores/file-changes.svelte.js';
export { sessionTodosStore, type TodoItem, type TodoStatus } from '$lib/stores/session-todos.svelte.js';
