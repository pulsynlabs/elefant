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
export type { TabId, PanelTabDescriptor } from './PanelTabs.svelte';
